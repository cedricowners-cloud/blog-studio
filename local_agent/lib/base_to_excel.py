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
from .utils import (
    describe_clickables,
    find_clickable_by_text,
    find_recent_file,
    wait_and_find_element,
)

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
    """설치된 Chrome 브라우저의 메이저 버전을 자동 감지 (로그용).

    반환값은 로깅에만 쓰이며 드라이버 선택에는 영향이 없다 — seleniumbase 가
    자체적으로 auto-detect 한다.

    timeout 이 15초인 이유: 5초였을 때 콜드 스타트(Gatekeeper 검증 등)로
    실제 타임아웃이 발생했고, 그 경고가 "버전 불일치" 로 오진을 유도했다.
    """
    import subprocess
    import re
    timeout = 15
    try:
        if platform.system() == "Darwin":
            result = subprocess.run(
                ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--version'],
                capture_output=True, text=True, timeout=timeout
            )
        elif platform.system() == "Windows":
            result = subprocess.run(
                ['reg', 'query', r'HKEY_CURRENT_USER\Software\Google\Chrome\BLBeacon', '/v', 'version'],
                capture_output=True, text=True, timeout=timeout
            )
        else:
            result = subprocess.run(
                ['google-chrome', '--version'],
                capture_output=True, text=True, timeout=timeout
            )

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
        # 드라이버 선택에는 영향 없다. 실패 원인으로 오해하지 않도록 info 로 둔다.
        logger.info("Chrome 버전 감지 생략 (로그용 값) — seleniumbase auto-detect 사용")

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



# 브라우저 창/세션이 죽었을 때의 메시지들. UC 모드에서 드라이버를 막
# 내려받은 직후 등 첫 네비게이션이 통째로 실패하는 경우가 있다.
_DEAD_WINDOW_MARKERS = (
    'no such window',
    'web view not found',
    'target window already closed',
    'invalid session id',
    'disconnected',
)


def _create_driver_and_open(url, headless=False, mobile=False, attempts=2):
    """드라이버 생성 + 첫 페이지 열기를 한 단위로 재시도한다.

    _create_driver 자체에도 재시도가 있지만, 생성은 성공하고 바로 다음
    driver.get() 에서 창이 죽는 경우를 못 잡는다(최초 uc_driver 다운로드
    직후에 관측됨). 사용자 상호작용 전 단계라 재시도가 안전하다.
    """
    last_err = None
    for i in range(attempts):
        driver = _create_driver(headless=headless, mobile=mobile)
        try:
            driver.get(url)
            return driver
        except Exception as e:
            last_err = e
            try:
                driver.quit()
            except Exception:
                pass
            if not any(m in str(e).lower() for m in _DEAD_WINDOW_MARKERS):
                raise
            logger.warning(
                "첫 페이지 열기 실패 — 브라우저 창이 닫혔습니다 (%d/%d): %s",
                i + 1, attempts, str(e).splitlines()[0],
            )
            time.sleep(2)
    raise RuntimeError(f"브라우저 창이 반복해서 닫힙니다: {last_err}")


def login_naver_manual(account_name="기본"):
    """수동 로그인: 브라우저를 열고 사용자가 직접 로그인 → 계정별 쿠키 저장

    Returns:
        driver: 로그인된 드라이버, 실패 시 None
    """
    # 수동 로그인은 항상 화면 표시
    driver = _create_driver_and_open(
        'https://nid.naver.com/nidlogin.login', headless=False
    )

    try:
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

def write_blog_post(driver, title, content, keywords, template_index=None,
                    stay_minutes=15, save_as_draft=True, on_log=None):
    """블로그 글 작성 (서식 마크업 + 템플릿 지원)

    Args:
        driver: 로그인된 WebDriver
        title: 글 제목
        content: 본문 (마크업 태그 포함 가능)
        keywords: 태그 키워드 리스트 (발행 모드에서만 적용됨)
        template_index: 내 템플릿 적용 (0부터 시작, None이면 미적용)
        stay_minutes: 에디터 최소 체류 시간 (차단 회피)
        save_as_draft: True면 임시저장(비공개), False면 실제 발행.
            기본값을 임시저장으로 둔 이유 — 실수로 공개 발행되는 쪽이
            되돌리기 어렵다. 공개는 호출자가 명시해야 한다.
        on_log: (level, message) 콜백. job_logs 로 진행 상황을 흘려보낸다.
    """
    from .naver_editor import write_formatted_content, apply_my_template

    def log(level, message):
        getattr(logger, 'warning' if level == 'warn' else 'info')(message)
        if on_log:
            try:
                on_log(level, message)
            except Exception:
                pass

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

        if save_as_draft:
            _save_draft(driver, log)
        else:
            _publish(driver, keywords, log)

    except Exception as e:
        logger.error(f"블로그 작성 중 에러: {str(e)}")
        return False

    return True


# 네이버 에디터 클래스는 `save_btn__FuUyN` 처럼 접미 해시가 붙고 빌드마다
# 바뀐다. 실측으로 확인된 변화:
#   .save_btn__bzc5B    → save_btn__FuUyN
#   .publish_btn__m9KHH → publish_btn__v_kS9
# 그래서 정확 일치 대신 접두 부분일치로 찾는다. 해시가 또 바뀌어도 견딘다.
# (`save_count_btn__` 은 `save_btn__` 을 포함하지 않으므로 오탐 없음)
SEL_SAVE_BTN = '[class*="save_btn__"]'
SEL_PUBLISH_BTN = '[class*="publish_btn__"]'
SEL_TAG_INPUT = '[class*="tag_input__"]'
SEL_LAYER = '[class*="layer_popup__"]'


def _save_draft(driver, log):
    """임시저장 — 툴바의 '저장' 을 누른다. 공개되지 않는다.

    태그는 발행 설정 레이어에만 있어서 임시저장으로는 넣을 수 없다.
    (기존 코드는 레이어를 열어 태그를 입력한 뒤 레이어를 닫고 저장을
    눌렀는데, 닫는 순간 입력이 버려질 가능성이 커서 그 경로는 버렸다.)
    """
    log("info", "임시저장 시도 — 툴바의 '저장' 버튼을 찾습니다.")
    _log_clickables(driver, "툴바", log)

    button = wait_and_find_element(driver, SEL_SAVE_BTN, timeout=5)
    found_by = f"선택자 {SEL_SAVE_BTN}"
    if button is None:
        button = find_clickable_by_text(driver, ['저장', '임시저장'])
        found_by = "텍스트 '저장'"
    if button is None:
        raise Exception("임시저장 버튼을 찾을 수 없습니다.")

    label = (button.text or '').strip()
    cls = (button.get_attribute('class') or '')[:60]
    log("info", f"임시저장 버튼 클릭 ({found_by}) — 라벨={label!r} class={cls}")
    button.click()
    time.sleep(3)
    log("info", "임시저장 완료 — 태그는 적용되지 않습니다(발행 시에만 가능).")


def _publish(driver, keywords, log):
    """실제 발행 — 발행 레이어를 열고 태그를 넣은 뒤 확정 버튼을 누른다."""
    log("info", "발행 레이어 열기")
    toolbar_button = wait_and_find_element(driver, SEL_PUBLISH_BTN, timeout=5)
    if toolbar_button is None:
        toolbar_button = find_clickable_by_text(driver, ['발행'])
    if toolbar_button is None:
        raise Exception("발행 버튼을 찾을 수 없습니다.")
    toolbar_button.click()
    time.sleep(3)

    layer = wait_and_find_element(driver, SEL_LAYER, timeout=5)
    if layer is None:
        # 레이어를 못 찾은 채 문서 전체에서 '발행' 을 찾으면 방금 누른
        # 툴바 버튼을 다시 집어 레이어를 토글해버린다. 차라리 멈춘다.
        _log_clickables(driver, "발행 레이어 탐색 실패", log)
        raise Exception(
            f"발행 설정 레이어({SEL_LAYER})를 찾을 수 없습니다. "
            "위 버튼 목록으로 실제 클래스를 확인해 선택자를 갱신하세요."
        )
    _log_clickables(driver, "발행 레이어", log, root=layer)

    # 태그 입력
    tag_input = wait_and_find_element(driver, SEL_TAG_INPUT, timeout=5)
    if tag_input is None:
        log("warn", "태그 입력란을 찾지 못했습니다 — 태그 없이 발행합니다.")
    elif keywords:
        log("info", f"태그 {len(keywords[:30])}개 입력")
        for tag in keywords[:30]:
            clean_tag = re.sub(r'[^\w가-힣]', '', tag)
            if clean_tag:
                tag_input.click()
                time.sleep(0.3)
                tag_input.send_keys(clean_tag)
                time.sleep(0.3)
                tag_input.send_keys(Keys.SPACE)
                time.sleep(0.3)

    # 레이어 안의 발행 확정 버튼. 레이어 범위로 한정해서 찾는다.
    # 레이어를 닫고 툴바 '저장'을 누르면 임시저장이 되어버린다(기존 코드).
    confirm = find_clickable_by_text(
        driver, ['발행', '발행하기'], root=layer, timeout=5
    )
    if confirm is None:
        raise Exception(
            "발행 레이어에서 확정 버튼을 찾을 수 없습니다. "
            "위 '발행 레이어' 버튼 목록을 보고 라벨을 확인하세요."
        )
    if confirm.id == toolbar_button.id:
        # 레이어 안에서 찾았는데 툴바 버튼과 같다면 범위 한정이 깨진 것이다.
        # 그대로 누르면 레이어만 닫히고 발행되지 않는다.
        raise Exception(
            "레이어 안의 확정 버튼이 툴바 버튼과 동일하게 잡혔습니다 — "
            "레이어 선택자를 갱신해야 합니다."
        )
    label = (confirm.text or '').strip()
    cls = (confirm.get_attribute('class') or '')[:60]
    log("info", f"발행 확정 클릭 — 라벨={label!r} class={cls}")
    confirm.click()
    time.sleep(5)
    log("info", "발행 완료")


def _log_clickables(driver, context, log, root=None):
    """버튼 라벨·클래스를 로그에 남긴다.

    해시 클래스의 실제 라벨을 모르는 상태라, 첫 실행 로그가 곧 DOM 조사
    결과가 된다. 확정 후에는 지워도 된다.
    """
    items = describe_clickables(driver, root=root)
    if items:
        log("info", f"[{context}] 버튼 {len(items)}개: " + " | ".join(items))
    else:
        log("warn", f"[{context}] 버튼을 수집하지 못했습니다.")

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