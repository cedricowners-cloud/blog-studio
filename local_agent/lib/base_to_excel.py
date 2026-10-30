import ast
import json
import logging
import re
from seleniumbase import Driver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
import time
import os
import platform
import pyperclip
from .utils import wait_and_find_element, find_recent_file

logger = logging.getLogger(__name__)

COOKIE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'cookies')
os.makedirs(COOKIE_DIR, exist_ok=True)


def _cookie_path(account_name="기본"):
    """계정별 쿠키 파일 경로"""
    safe_name = account_name.replace('/', '_').replace('\\', '_')
    return os.path.join(COOKIE_DIR, f'naver_{safe_name}.json')


# 하위 호환: 기존 단일 파일 참조용
COOKIE_FILE = _cookie_path("기본")


def _detect_chrome_version():
    """설치된 Chrome 브라우저의 메이저 버전을 자동 감지"""
    import subprocess
    import re
    try:
        if platform.system() == "Darwin":
            result = subprocess.run(
                ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--version'],
                capture_output=True, text=True, timeout=5
            )
        elif platform.system() == "Windows":
            result = subprocess.run(
                ['reg', 'query', r'HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon', '/v', 'version'],
                capture_output=True, text=True, timeout=5
            )
        else:
            result = subprocess.run(['google-chrome', '--version'], capture_output=True, text=True, timeout=5)

        match = re.search(r'(\d+)\.\d+\.\d+', result.stdout)
        if match:
            return int(match.group(1))
    except Exception:
        pass
    return None


def _uc_cache_dir():
    """플랫폼별 UC 드라이버 캐시 디렉토리"""
    system = platform.system()
    if system == "Windows":
        return os.path.expanduser("~/appdata/roaming/undetected_chromedriver")
    if system == "Linux":
        return os.path.expanduser("~/.local/share/undetected_chromedriver")
    if system == "Darwin":
        return os.path.expanduser("~/Library/Application Support/undetected_chromedriver")
    return os.path.expanduser("~/.undetected_chromedriver")


def _purge_uc_cache():
    """UC 캐시 디렉토리 비우기 — 버전 불일치 시 재다운로드 유도"""
    import shutil
    cache = _uc_cache_dir()
    if os.path.exists(cache):
        try:
            shutil.rmtree(cache)
            logger.info(f"UC 드라이버 캐시 삭제 완료: {cache}")
        except Exception as e:
            logger.warning(f"UC 캐시 삭제 실패: {e}")


def _create_driver(headless=False, mobile=False):
    """seleniumbase UC 모드 드라이버 생성 (최대 3회 재시도)

    Args:
        headless: 헤드리스 모드
        mobile: 모바일 User-Agent 사용 (좋아요/댓글/서로이웃)
    """
    chrome_ver = _detect_chrome_version()
    if chrome_ver:
        logger.info(f"감지된 Chrome 메이저 버전: {chrome_ver}")
    else:
        logger.warning("Chrome 버전 감지 실패 — seleniumbase auto-detect에 위임")

    mobile_ua = (
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) '
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    ) if mobile else None

    for attempt in range(3):
        driver = None
        try:
            driver = Driver(
                uc=True,
                headless=headless,
                agent=mobile_ua,
            )
            time.sleep(3)
            # 브라우저가 살아있는지 확인
            driver.current_url
            if not headless and not mobile:
                try:
                    driver.maximize_window()
                except Exception:
                    pass
            return driver
        except Exception as e:
            err_text = str(e).lower()
            logger.warning(f"드라이버 생성 실패 ({attempt + 1}/3): {e}")
            try:
                if driver is not None:
                    driver.quit()
            except Exception:
                pass

            # 실제 버전 불일치 문구에만 매치 — 광범위한 키워드는 오탐 유발
            version_mismatch = any(k in err_text for k in (
                'this version of chromedriver only supports',
                'session not created: this version',
                'chrome version must be between',
                'unsupported chrome version',
            ))
            if version_mismatch and attempt < 2:
                logger.info("버전 불일치 감지 — UC 캐시 삭제 후 재시도")
                _purge_uc_cache()

            time.sleep(2)

    raise Exception("브라우저 실행에 3회 연속 실패했습니다.")


def _save_cookies(driver, account_name="기본"):
    """현재 브라우저 쿠키를 계정별 파일에 저장"""
    cookies = driver.get_cookies()
    path = _cookie_path(account_name)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(cookies, f, ensure_ascii=False)
    logger.info(f"쿠키 저장 완료: {account_name} ({len(cookies)}개)")


def _load_cookies(driver, account_name="기본"):
    """계정별 저장된 쿠키를 브라우저에 로드"""
    path = _cookie_path(account_name)
    if not os.path.exists(path):
        return False

    try:
        with open(path, 'r', encoding='utf-8') as f:
            cookies = json.load(f)

        driver.get('https://www.naver.com')
        time.sleep(2)

        for cookie in cookies:
            cookie.pop('sameSite', None)
            cookie.pop('httpOnly', None)
            try:
                driver.add_cookie(cookie)
            except Exception:
                pass

        logger.info(f"쿠키 로드 완료: {account_name} ({len(cookies)}개)")
        return True
    except Exception as e:
        logger.warning(f"쿠키 로드 실패 ({account_name}): {e}")
        return False



def login_naver_manual(account_name="기본"):
    """수동 로그인: 브라우저를 열고 사용자가 직접 로그인 → 계정별 쿠키 저장

    Returns:
        driver: 로그인된 드라이버, 실패 시 None
    """
    driver = _create_driver(headless=False)  # 수동 로그인은 항상 화면 표시

    try:
        driver.get('https://nid.naver.com/nidlogin.login')
        logger.info(f"수동 로그인 대기 중 (계정: {account_name})...")

        # 최대 180초 대기하면서 로그인 완료 감지
        for _ in range(180):
            time.sleep(1)
            try:
                current_url = driver.current_url
                if 'nidlogin.login' not in current_url and 'nid.naver.com' not in current_url:
                    time.sleep(3)
                    break
            except Exception:
                pass
        else:
            logger.warning("로그인 시간 초과 (180초)")
            driver.quit()
            return None

        # 네이버 메인 접속해서 쿠키 완전히 생성되도록 대기
        driver.get('https://www.naver.com')
        time.sleep(3)

        # 계정별 쿠키 저장
        _save_cookies(driver, account_name)
        logger.info(f"수동 로그인 성공, 쿠키 저장됨 (계정: {account_name})")

        # driver를 닫고 반환 (이후 쿠키로 재로그인)
        driver.quit()
        return True

    except Exception as e:
        logger.error(f"수동 로그인 중 에러: {e}")
        driver.quit()
        return None


def login_naver(headless=False, account_name="기본", mobile=False):
    """네이버 로그인 (쿠키 → 쿠키 검증 → 실패 시 수동 로그인)

    Args:
        headless: 헤드리스 모드
        account_name: 계정 이름 (계정별 쿠키 관리)
        mobile: 모바일 모드 (좋아요/댓글/서로이웃용)
    """
    cookie_path = _cookie_path(account_name)

    # 1. 쿠키가 있으면 로드 후 실제 접속해서 검증
    if os.path.exists(cookie_path):
        try:
            driver = _create_driver(headless=headless, mobile=mobile)
            logger.info(f"저장된 쿠키로 로그인 시도 (계정: {account_name})...")
            _load_cookies(driver, account_name)

            # 네이버 메인에서 로그인 여부 확인
            driver.get('https://www.naver.com')
            time.sleep(3)
            current_url = driver.current_url

            if 'nidlogin.login' not in current_url:
                logger.info(f"쿠키 로그인 성공 (계정: {account_name})")
                return driver
            else:
                logger.warning(f"쿠키 만료 (계정: {account_name}), 수동 로그인으로 전환...")
                driver.quit()
                # 만료된 쿠키 삭제
                clear_cookies(account_name=account_name)
        except Exception as e:
            logger.warning(f"쿠키 로그인 실패 ({account_name}): {e}")
            try:
                driver.quit()
            except Exception:
                pass

    # 2. 쿠키 없음 또는 만료 → 수동 로그인
    logger.info(f"수동 로그인 시작 (계정: {account_name})...")
    result = login_naver_manual(account_name=account_name)
    if not result:
        return None

    # 3. 수동 로그인 성공 → 새 driver에 쿠키 로드
    try:
        driver = _create_driver(headless=headless, mobile=mobile)
        _load_cookies(driver, account_name)
        logger.info(f"수동 로그인 후 쿠키 로드 완료 (계정: {account_name})")
        return driver
    except Exception as e:
        logger.error(f"로그인 중 에러 ({account_name}): {e}")
        try:
            driver.quit()
        except Exception:
            pass
        return None


def clear_cookies(account_name=None):
    """저장된 쿠키 삭제

    Args:
        account_name: 특정 계정 쿠키만 삭제. None이면 전체 삭제
    """
    if account_name:
        path = _cookie_path(account_name)
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"쿠키 삭제: {account_name}")
    else:
        # 전체 삭제
        for f in os.listdir(COOKIE_DIR):
            if f.startswith('naver_') and f.endswith('.json'):
                os.remove(os.path.join(COOKIE_DIR, f))
        logger.info("모든 쿠키 삭제 완료")


def get_cookie_accounts():
    """쿠키가 저장된 계정 목록 반환"""
    accounts = []
    if os.path.exists(COOKIE_DIR):
        for f in os.listdir(COOKIE_DIR):
            if f.startswith('naver_') and f.endswith('.json'):
                name = f.replace('naver_', '').replace('.json', '')
                accounts.append(name)
    return accounts

def check_login_status(driver):
    try:
        # 네이버 메인 페이지로 이동하여 로그인 상태 확인
        driver.get('https://www.naver.com')
        time.sleep(2)
        
        # 로그인 상태 확인 (예: 로그인 버튼이 보이면 로그인 안 된 상태)
        login_button = wait_and_find_element(driver, '.link_login', timeout=3)
        if login_button:
            return False
        return True
    except Exception as e:
        print(f"로그인 상태 확인 중 에러 발생: {str(e)}")
        return False

def get_os_type():
    """OS 타입을 자동 감지하는 함수"""
    return platform.system()  # 'Windows', 'Darwin'(Mac), 'Linux'

def copy_paste_text(driver, element, text):
    """클립보드 복사/붙여넣기로 텍스트 입력"""
    # 텍스트를 클립보드에 복사
    pyperclip.copy(text)
    time.sleep(0.5)
    
    # 요소 클릭
    element.click()
    time.sleep(0.5)
    
    # OS에 따라 다른 단축키 사용
    mod = Keys.COMMAND if platform.system() == "Darwin" else Keys.CONTROL
    actions = ActionChains(driver)
    actions.key_down(mod).send_keys('v').key_up(mod)
    actions.perform()
    
    time.sleep(0.5)

def write_blog_post(driver, title, content, keywords, template_index=None, stay_minutes=15):
    """블로그 글 작성 (서식 마크업 + 템플릿 지원)

    Args:
        driver: 로그인된 WebDriver
        title: 글 제목
        content: 본문 (마크업 태그 포함 가능)
        keywords: 태그 키워드 리스트
        template_index: 내 템플릿 적용 (0부터 시작, None이면 미적용)
    """
    from .naver_editor import write_formatted_content, apply_my_template

    try:
        # 블로그 글쓰기 페이지로 이동 (이미 글쓰기 페이지면 스킵)
        current_url = driver.current_url
        if 'Write' not in current_url and 'GoBlogWrite' not in current_url:
            driver.get('https://blog.naver.com/GoBlogWrite.naver')
            time.sleep(8)
            current_url = driver.current_url

        logger.info(f"글쓰기 페이지 URL: {current_url}")

        if 'nidlogin.login' in current_url:
            logger.warning("쿠키 세션 만료 - 재로그인 필요")
            raise Exception("로그인 세션이 만료되었습니다. 다시 시도해주세요.")

        # iframe 전환
        iframe = wait_and_find_element(driver, '#mainFrame', timeout=15)
        if iframe:
            driver.switch_to.frame(iframe)
            time.sleep(3)
        else:
            logger.info("iframe 없음 - 직접 에디터 모드 시도")
            time.sleep(3)

        # 팝업 닫기 (있는 경우)
        cancel_button = wait_and_find_element(driver, '.se-popup-button-cancel', timeout=3)
        if cancel_button:
            cancel_button.click()
            time.sleep(1)

        # 도움말 패널 닫기 (있는 경우)
        help_close_button = wait_and_find_element(driver, '.se-help-panel-close-button', timeout=3)
        if help_close_button:
            help_close_button.click()
            time.sleep(1)

        # 1) 내 템플릿 적용 (가장 먼저, 아무것도 입력 전에)
        if template_index is not None:
            from .naver_editor import _dismiss_all_popups
            logger.info(f"내 템플릿 적용 중 (인덱스: {template_index})...")
            apply_my_template(driver, template_index)
            time.sleep(3)
            _dismiss_all_popups(driver)
            time.sleep(1)

        # 2) 제목 입력
        title_element = wait_and_find_element(driver, '.se-section-documentTitle')
        if not title_element:
            raise Exception("제목 입력란을 찾을 수 없습니다.")

        title_element.click()
        time.sleep(1)
        # 기존 제목 전체 선택 후 삭제: Home으로 맨 앞 → Shift+End로 전체 선택 → 삭제
        ActionChains(driver).send_keys(Keys.HOME).perform()
        time.sleep(0.2)
        ActionChains(driver).key_down(Keys.SHIFT).send_keys(Keys.END).key_up(Keys.SHIFT).perform()
        time.sleep(0.2)
        ActionChains(driver).send_keys(Keys.BACKSPACE).perform()
        time.sleep(0.3)
        # 새 제목 입력
        ActionChains(driver).send_keys(title).perform()
        time.sleep(1)

        # 3) 본문으로 이동 (제목 입력 후 Enter로 자연스럽게 이동)
        ActionChains(driver).send_keys(Keys.ENTER).perform()
        time.sleep(1)

        # 자동 목록 변환 비활성화
        try:
            driver.execute_script("""
                // 에디터의 자동 리스트 변환 기능 비활성화
                if (typeof SE !== 'undefined' && SE.Editor) {
                    try { SE.Editor.setAutoList(false); } catch(e) {}
                }
                // 또는 CSS로 목록 리셋 버튼 클릭
                var resetBtn = document.querySelector('.se-toolbar-option-list-reset-button');
                if (resetBtn) { resetBtn.click(); }
            """)
            time.sleep(0.5)
        except Exception:
            pass

        # 4) 본문 입력
        has_markup = any(tag in content for tag in ['[h2]', '[h3]', '[bold]', '[italic]',
                        '[underline]', '[quote', '[hr', '[center]', '[right]', '[img]'])

        if has_markup:
            write_formatted_content(driver, content, stay_minutes=stay_minutes)
        else:
            # 일반 텍스트 입력 (한 글자씩 타이핑)
            import random
            import datetime
            start_time = datetime.datetime.now()

            lines = content.split('\n')
            for i, line in enumerate(lines):
                if line.strip():
                    # 한 글자씩 입력
                    actions = ActionChains(driver)
                    for char in line:
                        actions.send_keys(char)
                        actions.pause(random.uniform(0.03, 0.10))
                    actions.perform()
                    time.sleep(random.uniform(0.5, 1.5))

                    if i < len(lines) - 1:
                        ActionChains(driver).key_down(Keys.SHIFT).send_keys(Keys.ENTER).key_up(Keys.SHIFT).perform()
                        time.sleep(random.uniform(0.3, 0.8))
                else:
                    ActionChains(driver).send_keys(Keys.ENTER).perform()
                    time.sleep(random.uniform(0.5, 1.0))

                # 5줄마다 잠시 쉬기
                if i > 0 and i % 5 == 0:
                    time.sleep(random.uniform(2.0, 5.0))

            # 최소 15분 체류 보장
            elapsed = (datetime.datetime.now() - start_time).total_seconds()
            remaining = stay_minutes * 60 - elapsed
            if remaining > 0:
                logger.info(f"글 작성 완료. 최소 체류 시간까지 {remaining:.0f}초 대기 중...")
                time.sleep(remaining)

        # 발행 버튼 클릭
        publish_button = wait_and_find_element(driver, '.publish_btn__m9KHH')
        if publish_button:
            publish_button.click()
            time.sleep(3)
        else:
            raise Exception("발행 버튼을 찾을 수 없습니다.")

        # 태그 입력
        tag_input = wait_and_find_element(driver, '.tag_input__rvUB5')
        if tag_input and keywords:
            logger.info(f"태그 입력 중... ({len(keywords)}개)")
            for tag in keywords[:30]:
                clean_tag = re.sub(r'[^\w가-힣]', '', tag)
                if clean_tag:
                    tag_input.click()
                    time.sleep(0.3)
                    tag_input.send_keys(clean_tag)
                    time.sleep(0.3)
                    tag_input.send_keys(Keys.SPACE)
                    time.sleep(0.3)

        # 발행 팝업 닫기
        close_button = wait_and_find_element(driver, '.layer_popup__i0QOY .btn_close__YxY9H')
        if close_button:
            close_button.click()
            time.sleep(2)

        # 저장 버튼 클릭
        save_button = wait_and_find_element(driver, '.save_btn__bzc5B')
        if save_button:
            save_button.click()
            time.sleep(3)
        else:
            raise Exception("저장 버튼을 찾을 수 없습니다.")

    except Exception as e:
        logger.error(f"블로그 작성 중 에러: {str(e)}")
        return False

    return True

# find_recent_file은 utils.py에서 import

def main(keywords=None):
    """레거시 Excel 일괄 작성 경로. 에이전트(worker)는 쓰지 않는다.

    pandas/openpyxl 은 이 함수에서만 필요하므로 lazy import 한다 —
    모듈 레벨에 두면 에이전트 전체가 pandas 설치를 강제하게 된다.
    """
    import pandas as pd

    try:
        # 키워드가 전달되지 않은 경우 Excel 파일에서 읽기
        if keywords is None:
            try:
                # 가장 최근의 data 파일 찾기
                data_file = find_recent_file('data')
                if data_file:
                    # 엑셀 파일 읽기
                    df = pd.read_excel(data_file)
                    
                    # 태그 정보가 있는 경우 사용
                    if 'tags' in df.columns:
                        # 첫 번째 행의 태그 정보 사용
                        tags = ast.literal_eval(df['tags'].iloc[0])  # 문자열로 저장된 리스트를 실제 리스트로 변환
                        print(f"\n태그 정보를 {data_file}에서 읽어왔습니다.")
                        print(f"태그: {', '.join(tags)}")
                    else:
                        print("태그 정보를 찾을 수 없습니다.")
                        tags = []
                else:
                    print("data 파일을 찾을 수 없습니다.")
                    return
            except Exception as e:
                print(f"Excel 파일 읽기 중 에러 발생: {str(e)}")
                return
        else:
            # 키워드가 전달된 경우
            tags = keywords
            print(f"\n태그로 사용될 키워드: {', '.join(tags)}")
            
            # 가장 최근의 data 파일 찾기
            data_file = find_recent_file('data')
            if not data_file:
                print("data 파일을 찾을 수 없습니다.")
                return
                
            # 엑셀 파일 읽기
            df = pd.read_excel(data_file)
        
        # 드라이버 초기화
        driver = login_naver()
        if not driver:
            print("로그인 실패")
            return
        
        try:
            # 2행부터 마지막 행까지 반복
            for index, row in df.iloc[1:].iterrows():
                title = str(row['제목'])  # 제목 열
                content = str(row['내용'])  # 내용 열
                
                print(f"\n글 작성 중: {title}")
                success = write_blog_post(driver, title, content, tags)  # 태그 정보 전달
                
                if success:
                    print(f"성공적으로 작성 완료: {title}")
                else:
                    print(f"작성 실패: {title}")
                
                # 다음 글 작성 전 대기
                time.sleep(5)
                
        finally:
            driver.quit()
            
    except Exception as e:
        print(f"프로그램 실행 중 에러 발생: {str(e)}")

if __name__ == "__main__":
    main() 