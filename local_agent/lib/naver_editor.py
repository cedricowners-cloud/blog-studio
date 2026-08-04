"""네이버 SmartEditor 서식 제어 모듈

콘텐츠에 마크업 기호를 넣으면 업로드 시 자동으로 서식을 적용합니다.

마크업 문법:
    [h2]소제목 텍스트[/h2]         → 글자 크기 24 + 볼드
    [h3]소제목 텍스트[/h3]         → 글자 크기 19 + 볼드
    [bold]텍스트[/bold]            → 볼드
    [italic]텍스트[/italic]        → 이탤릭
    [underline]텍스트[/underline]  → 밑줄
    [quote]텍스트[/quote]          → 인용구 1 (기본)
    [quote2]텍스트[/quote2]        → 인용구 2 (라인)
    [quote3]텍스트[/quote3]        → 인용구 3 (말풍선)
    [hr]                           → 구분선 1 (기본)
    [hr2]                          → 구분선 2
    [hr3]                          → 구분선 3
    [center]텍스트[/center]        → 가운데 정렬
    [right]텍스트[/right]          → 오른쪽 정렬
    [img]/path/to/image.jpg[/img]  → 이미지 삽입
"""
import re
import time
import logging
import platform
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from utils import wait_and_find_element

logger = logging.getLogger(__name__)


def _get_mod_key():
    """OS에 따른 Ctrl/Cmd 키 반환"""
    if platform.system() == "Darwin":
        return Keys.COMMAND
    return Keys.CONTROL


def _dismiss_all_popups(driver):
    """네이버 에디터의 모든 팝업/오버레이 닫기"""
    popup_selectors = [
        '.se-popup-button-confirm',      # 확인 버튼
        '.se-popup-button-cancel',       # 취소 버튼
        '.se-popup-close-button',        # 팝업 닫기
        '.se-help-panel-close-button',   # 도움말 닫기
    ]
    for selector in popup_selectors:
        try:
            btn = driver.find_element(By.CSS_SELECTOR, selector)
            if btn.is_displayed():
                btn.click()
                time.sleep(0.5)
                logger.info(f"팝업 닫기: {selector}")
        except Exception:
            pass

    # 오버레이 딤(dim) 레이어 제거
    try:
        driver.execute_script("""
            var dims = document.querySelectorAll('.se-popup-dim, .se-popup-dim-white');
            dims.forEach(function(d) { d.remove(); });
        """)
    except Exception:
        pass

    time.sleep(0.5)


# ──────────────────────────────────────────────
# 에디터 서식 조작 함수들
# ──────────────────────────────────────────────

def _click_toolbar_dropdown(driver, dropdown_name, option_value):
    """드롭다운 메뉴에서 옵션 선택 (인용구, 구분선, 정렬 등)"""
    try:
        # 드롭다운 열기
        dropdown_btn = driver.find_element(
            By.CSS_SELECTOR,
            f'.se-toolbar-select-option-button[data-name="{dropdown_name}"], '
            f'.se-property-toolbar-drop-down-button[data-name="{dropdown_name}"]'
        )
        dropdown_btn.click()
        time.sleep(0.5)

        # 옵션 선택
        option_btn = driver.find_element(
            By.CSS_SELECTOR,
            f'[data-name="{dropdown_name}"][data-role="option"][data-value="{option_value}"]'
        )
        option_btn.click()
        time.sleep(0.5)
        return True
    except Exception as e:
        logger.warning(f"드롭다운 조작 실패 ({dropdown_name}/{option_value}): {e}")
        return False


def _set_font_size(driver, size):
    """글자 크기 변경 (11,13,15,16,19,24,28,30,34,38)"""
    try:
        # 드롭다운 열기 (현재 커서 위치 유지)
        size_btn = wait_and_find_element(driver, '.se-font-size-code-toolbar-button', timeout=5)
        if not size_btn:
            logger.warning(f"글자 크기 버튼을 찾을 수 없습니다 ({size})")
            return False
        size_btn.click()
        time.sleep(0.5)

        # 크기 선택
        option = wait_and_find_element(
            driver,
            f'[data-name="font-size"][data-role="option"][data-value="fs{size}"]',
            timeout=3
        )
        if not option:
            logger.warning(f"글자 크기 옵션을 찾을 수 없습니다 (fs{size})")
            # 드롭다운 닫기
            size_btn.click()
            time.sleep(0.3)
            return False
        option.click()
        time.sleep(0.3)
        return True
    except Exception as e:
        logger.warning(f"글자 크기 변경 실패 ({size}): {e}")
        return False


def _toggle_style(driver, style):
    """볼드/이탤릭/밑줄 토글 (단축키 사용)"""
    mod = _get_mod_key()
    key_map = {'bold': 'b', 'italic': 'i', 'underline': 'u'}
    key = key_map.get(style)
    if not key:
        return False
    ActionChains(driver).key_down(mod).send_keys(key).key_up(mod).perform()
    time.sleep(0.3)
    return True


def _insert_quotation(driver, style="default"):
    """인용구 삽입"""
    value_map = {
        "1": "default", "default": "default",
        "2": "quotation_line", "line": "quotation_line",
        "3": "quotation_bubble", "bubble": "quotation_bubble",
        "4": "quotation_underline",
        "5": "quotation_postit",
        "6": "quotation_corner",
    }
    value = value_map.get(str(style), "default")

    try:
        if value == "default":
            # 기본 인용구는 바로 삽입
            btn = driver.find_element(By.CSS_SELECTOR, '.se-insert-quotation-default-toolbar-button')
            btn.click()
            time.sleep(0.5)
            return True
        else:
            # 드롭다운 열기 (선택 옵션 버튼)
            dropdown = driver.find_element(
                By.CSS_SELECTOR,
                '.se-document-toolbar-select-option-button[data-name="quotation"]'
            )
            dropdown.click()
            time.sleep(0.5)
            # 옵션 선택
            option = driver.find_element(
                By.CSS_SELECTOR,
                f'.se-toolbar-option-insert-quotation [data-value="{value}"]'
            )
            option.click()
            time.sleep(0.5)
            return True
    except Exception as e:
        logger.warning(f"인용구 삽입 실패 ({style}/{value}): {e}")
        # 폴백: 기본 인용구라도 삽입
        try:
            btn = driver.find_element(By.CSS_SELECTOR, '.se-insert-quotation-default-toolbar-button')
            btn.click()
            time.sleep(0.5)
            return True
        except Exception:
            return False


def _insert_horizontal_line(driver, style="default"):
    """구분선 삽입"""
    value_map = {
        "1": "default", "default": "default",
        "2": "line1", "3": "line2", "4": "line3",
        "5": "line4", "6": "line5", "7": "line6", "8": "line7",
    }
    value = value_map.get(str(style), "default")

    try:
        if value == "default":
            btn = driver.find_element(By.CSS_SELECTOR, '.se-insert-horizontal-line-default-toolbar-button')
            btn.click()
            time.sleep(0.5)
            return True
        else:
            dropdown = driver.find_element(
                By.CSS_SELECTOR,
                '.se-document-toolbar-select-option-button[data-name="horizontal-line"]'
            )
            dropdown.click()
            time.sleep(0.5)
            option = driver.find_element(
                By.CSS_SELECTOR,
                f'.se-toolbar-option-insert-horizontal-line [data-value="{value}"]'
            )
            option.click()
            time.sleep(0.5)
            return True
    except Exception as e:
        logger.warning(f"구분선 삽입 실패 ({style}/{value}): {e}")
        try:
            btn = driver.find_element(By.CSS_SELECTOR, '.se-insert-horizontal-line-default-toolbar-button')
            btn.click()
            time.sleep(0.5)
            return True
        except Exception:
            return False


def _set_align(driver, align="center"):
    """텍스트 정렬 (left, center, right, justify)"""
    # 정렬 옵션 버튼의 고유 클래스명
    align_class_map = {
        'left': '.se-toolbar-option-align-left-button',
        'center': '.se-toolbar-option-align-center-button',
        'right': '.se-toolbar-option-align-right-button',
        'justify': '.se-toolbar-option-align-justify-button',
    }
    try:
        # 1) 정렬 드롭다운 열기 (propertyToolbar의 정렬 버튼)
        dropdown = driver.find_element(
            By.CSS_SELECTOR,
            '.se-property-toolbar-drop-down-button[data-name="align-drop-down-with-justify"]'
        )
        dropdown.click()
        time.sleep(0.5)

        # 2) 정렬 옵션 직접 클릭 (고유 클래스 사용)
        selector = align_class_map.get(align)
        if selector:
            option = driver.find_element(By.CSS_SELECTOR, selector)
            option.click()
            time.sleep(0.5)
            return True
        return False
    except Exception as e:
        logger.warning(f"정렬 변경 실패 ({align}): {e}")
        return False


def _insert_image(driver, image_path):
    """이미지 파일 삽입"""
    try:
        # 사진 버튼 클릭
        img_btn = driver.find_element(By.CSS_SELECTOR, '.se-image-toolbar-button')
        img_btn.click()
        time.sleep(1)

        # 숨겨진 file input 찾아서 파일 경로 전달
        file_input = driver.find_element(By.CSS_SELECTOR, 'input[type="file"][accept*="image"]')
        file_input.send_keys(image_path)
        time.sleep(3)  # 이미지 업로드 대기
        return True
    except Exception as e:
        logger.warning(f"이미지 삽입 실패 ({image_path}): {e}")
        return False


def apply_my_template(driver, template_index=0):
    """내 템플릿을 적용

    Args:
        driver: Selenium WebDriver (iframe 내부로 전환된 상태)
        template_index: 템플릿 순서 (0부터 시작, 0=첫 번째)

    Returns:
        bool: 성공 여부
    """
    try:
        # 1) 템플릿 사이드바 열기
        template_btn = driver.find_element(By.CSS_SELECTOR, '.se-template-toolbar-button')
        template_btn.click()
        time.sleep(1)

        # 2) "내 템플릿" 탭 클릭
        my_tab = driver.find_element(By.CSS_SELECTOR, '.se-tab-button[value="my"]')
        my_tab.click()
        time.sleep(1)

        # 3) 템플릿 목록에서 선택
        templates = driver.find_elements(
            By.CSS_SELECTOR,
            '.se-tab-content-my-template .se-doc-template-item a.se-doc-template'
        )

        if not templates:
            logger.warning("내 템플릿이 없습니다.")
            # 사이드바 닫기
            close_btn = driver.find_element(By.CSS_SELECTOR, '.se-sidebar-close-button')
            close_btn.click()
            return False

        if template_index >= len(templates):
            logger.warning(f"템플릿 인덱스 초과: {template_index} (총 {len(templates)}개)")
            template_index = 0

        templates[template_index].click()
        time.sleep(2)

        # 4) 확인 팝업 처리 - 여러 셀렉터 시도
        popup_confirm_selectors = [
            '.se-popup-button-confirm',
            '.se-popup-button.se-popup-button-confirm',
            '._confirm',
            '.se-popup-content button:last-child',
            '.se-popup-button-container button:first-child',
        ]
        popup_clicked = False
        for selector in popup_confirm_selectors:
            try:
                btns = driver.find_elements(By.CSS_SELECTOR, selector)
                for btn in btns:
                    if btn.is_displayed():
                        btn.click()
                        popup_clicked = True
                        logger.info(f"템플릿 확인 팝업 클릭: {selector}")
                        time.sleep(2)
                        break
            except Exception:
                pass
            if popup_clicked:
                break

        if not popup_clicked:
            # JavaScript로 팝업 버튼 강제 클릭 시도
            try:
                driver.execute_script("""
                    var buttons = document.querySelectorAll('.se-popup-button');
                    for (var i = 0; i < buttons.length; i++) {
                        if (buttons[i].offsetParent !== null) {
                            buttons[i].click();
                            break;
                        }
                    }
                """)
                time.sleep(2)
                logger.info("템플릿 확인 팝업 JS 클릭")
            except Exception:
                pass

        # 5) 오버레이/사이드바 정리
        _dismiss_all_popups(driver)
        try:
            close_btn = driver.find_element(By.CSS_SELECTOR, '.se-sidebar-close-button')
            if close_btn.is_displayed():
                close_btn.click()
                time.sleep(1)
        except Exception:
            pass

        # 템플릿이 실제로 적용되었는지 확인 (본문에 내용이 있는지)
        time.sleep(2)
        logger.info(f"내 템플릿 적용 완료 (인덱스: {template_index})")
        return True

    except Exception as e:
        logger.warning(f"템플릿 적용 실패: {e}")
        # 사이드바 닫기 시도
        try:
            close_btn = driver.find_element(By.CSS_SELECTOR, '.se-sidebar-close-button')
            close_btn.click()
        except Exception:
            pass
        return False


def get_my_template_list(driver):
    """내 템플릿 목록 조회

    Returns:
        list of dict: [{'index': 0, 'title': '기본', 'date': '2025.05.13', 'id': '...'}, ...]
    """
    try:
        template_btn = driver.find_element(By.CSS_SELECTOR, '.se-template-toolbar-button')
        template_btn.click()
        time.sleep(1)

        my_tab = driver.find_element(By.CSS_SELECTOR, '.se-tab-button[value="my"]')
        my_tab.click()
        time.sleep(1)

        items = driver.find_elements(
            By.CSS_SELECTOR,
            '.se-tab-content-my-template .se-doc-template-item'
        )

        templates = []
        for i, item in enumerate(items):
            try:
                title = item.find_element(By.CSS_SELECTOR, '.se-doc-template-title').text
                date = item.find_element(By.CSS_SELECTOR, '.se-doc-template-date').text
                template_id = item.get_attribute('data-templateno')
                templates.append({
                    'index': i,
                    'title': title,
                    'date': date,
                    'id': template_id,
                })
            except Exception:
                pass

        # 사이드바 닫기
        close_btn = driver.find_element(By.CSS_SELECTOR, '.se-sidebar-close-button')
        close_btn.click()
        time.sleep(0.5)

        return templates

    except Exception as e:
        logger.warning(f"템플릿 목록 조회 실패: {e}")
        return []


import random

# 최소 체류 시간 (초)
MIN_STAY_SECONDS = 15 * 60  # 15분


def _type_text(driver, text):
    """텍스트 입력 (자동 목록 방지 + 적당한 속도)"""
    # 자동 목록 트리거 방지: "1. ", "- " 등으로 시작하면 앞에 공백 추가
    if re.match(r'^(\d+[\.\)]\s|[-*]\s)', text):
        text = ' ' + text

    # 짧은 텍스트는 한번에, 긴 텍스트는 단어 단위로 입력
    words = text.split(' ')
    for i, word in enumerate(words):
        chunk = word if i == 0 else ' ' + word
        ActionChains(driver).send_keys(chunk).perform()
        time.sleep(random.uniform(0.05, 0.15))

    time.sleep(0.3)


def _press_enter(driver, shift=False):
    """줄바꿈 (Enter 또는 Shift+Enter)"""
    actions = ActionChains(driver)
    if shift:
        actions.key_down(Keys.SHIFT).send_keys(Keys.ENTER).key_up(Keys.SHIFT)
    else:
        actions.send_keys(Keys.ENTER)
    actions.perform()
    time.sleep(random.uniform(0.5, 1.5))


# ──────────────────────────────────────────────
# 마크업 파서
# ──────────────────────────────────────────────

def parse_content(content):
    """마크업이 포함된 콘텐츠를 명령 리스트로 변환

    Returns:
        list of dict: [{'type': 'text', 'text': '...'}, {'type': 'hr', 'style': '1'}, ...]
    """
    commands = []
    lines = content.split('\n')

    for line in lines:
        line_stripped = line.strip()

        if not line_stripped:
            commands.append({'type': 'newline'})
            continue

        # [img_placeholder: ...] 는 이미지 생성 미완료 상태 → 스킵 (본문에 남지 않음)
        if re.match(r'^\[img_placeholder:.*?\]$', line_stripped, re.DOTALL):
            logger.warning(f"이미지 placeholder 스킵 (생성 미완료): {line_stripped[:50]}")
            continue

        # 구분선: [hr], [hr2], [hr3] ...
        hr_match = re.match(r'^\[hr(\d*)\]$', line_stripped)
        if hr_match:
            style = hr_match.group(1) or "1"
            commands.append({'type': 'hr', 'style': style})
            continue

        # 이미지: [img]/path/to/file[/img]
        img_match = re.match(r'^\[img\](.*?)\[/img\]$', line_stripped)
        if img_match:
            commands.append({'type': 'image', 'path': img_match.group(1).strip()})
            continue

        # 소제목 h2: [h2]텍스트[/h2]
        h2_match = re.match(r'^\[h2\](.*?)\[/h2\]$', line_stripped)
        if h2_match:
            commands.append({'type': 'heading', 'level': 2, 'text': h2_match.group(1).strip()})
            continue

        # 소제목 h3: [h3]텍스트[/h3]
        h3_match = re.match(r'^\[h3\](.*?)\[/h3\]$', line_stripped)
        if h3_match:
            commands.append({'type': 'heading', 'level': 3, 'text': h3_match.group(1).strip()})
            continue

        # 가운데 정렬: [center]텍스트[/center] (줄 어디에든)
        center_match = re.search(r'\[center\](.*?)\[/center\]', line_stripped)
        if center_match:
            before = line_stripped[:center_match.start()].strip()
            after = line_stripped[center_match.end():].strip()
            if before:
                commands.append({'type': 'text', 'text': before})
            commands.append({'type': 'align', 'align': 'center', 'text': center_match.group(1).strip()})
            if after:
                commands.append({'type': 'text', 'text': after})
            continue

        # 오른쪽 정렬: [right]텍스트[/right] (줄 어디에든)
        right_match = re.search(r'\[right\](.*?)\[/right\]', line_stripped)
        if right_match:
            before = line_stripped[:right_match.start()].strip()
            after = line_stripped[right_match.end():].strip()
            if before:
                commands.append({'type': 'text', 'text': before})
            commands.append({'type': 'align', 'align': 'right', 'text': right_match.group(1).strip()})
            if after:
                commands.append({'type': 'text', 'text': after})
            continue

        # 인용구: 줄 어디에든 [quote]...[/quote] 가 있으면 분리 처리
        quote_pattern = re.search(r'\[quote(\d*)\](.*?)\[/quote\d*\]', line_stripped)
        if quote_pattern:
            style = quote_pattern.group(1) or "1"
            quote_text = quote_pattern.group(2).strip()

            # 인용구 앞 텍스트
            before = line_stripped[:quote_pattern.start()].strip()
            # 인용구 뒤 텍스트
            after = line_stripped[quote_pattern.end():].strip()

            if before:
                commands.append({'type': 'text', 'text': before})
            commands.append({'type': 'quote', 'style': style, 'text': quote_text})
            if after:
                commands.append({'type': 'text', 'text': after})
            continue

        # 인라인 서식이 포함된 일반 텍스트
        commands.append({'type': 'text', 'text': line_stripped})

    return commands


def _write_inline_formatted(driver, text):
    """인라인 서식([bold], [italic], [underline])이 포함된 텍스트 처리"""
    # 서식 태그 분리
    parts = re.split(r'(\[/?(?:bold|italic|underline)\])', text)

    active_styles = set()

    for part in parts:
        if not part:
            continue

        # 서식 시작 태그
        if part == '[bold]':
            _toggle_style(driver, 'bold')
            active_styles.add('bold')
        elif part == '[italic]':
            _toggle_style(driver, 'italic')
            active_styles.add('italic')
        elif part == '[underline]':
            _toggle_style(driver, 'underline')
            active_styles.add('underline')
        # 서식 종료 태그
        elif part == '[/bold]':
            _toggle_style(driver, 'bold')
            active_styles.discard('bold')
        elif part == '[/italic]':
            _toggle_style(driver, 'italic')
            active_styles.discard('italic')
        elif part == '[/underline]':
            _toggle_style(driver, 'underline')
            active_styles.discard('underline')
        # 일반 텍스트
        else:
            _type_text(driver, part)


# ──────────────────────────────────────────────
# 메인 실행 함수
# ──────────────────────────────────────────────

def write_formatted_content(driver, content, stay_minutes=15):
    """마크업이 포함된 콘텐츠를 네이버 에디터에 서식 적용하여 입력

    최소 15분 체류를 보장합니다. 글 작성이 15분보다 빨리 끝나면
    남은 시간만큼 대기합니다.

    Args:
        driver: Selenium WebDriver (iframe 내부로 전환된 상태)
        content: 마크업이 포함된 본문 텍스트
    """
    import datetime
    start_time = datetime.datetime.now()

    commands = parse_content(content)
    total = len(commands)

    for i, cmd in enumerate(commands):
        cmd_type = cmd['type']

        # 섹션 사이에 자연스러운 쉬는 시간 (사람처럼)
        if i > 0 and i % 5 == 0:
            pause = random.uniform(2.0, 5.0)
            logger.info(f"작성 중 잠시 대기 ({pause:.1f}초)... [{i}/{total}]")
            time.sleep(pause)

        if cmd_type == 'newline':
            _press_enter(driver)

        elif cmd_type == 'text':
            _write_inline_formatted(driver, cmd['text'])
            _press_enter(driver)

        elif cmd_type == 'heading':
            level = cmd['level']
            size = 24 if level == 2 else 19
            _set_font_size(driver, size)
            _toggle_style(driver, 'bold')
            _type_text(driver, cmd['text'])
            _toggle_style(driver, 'bold')
            _set_font_size(driver, 15)
            _press_enter(driver)

        elif cmd_type == 'quote':
            # 먼저 빈 줄 만들고, 위로 올라가서 인용구 삽입
            ActionChains(driver).send_keys(Keys.ENTER).perform()
            time.sleep(0.3)
            ActionChains(driver).send_keys(Keys.ARROW_UP).perform()
            time.sleep(0.3)
            # 인용구 삽입 + 텍스트 입력
            _insert_quotation(driver, cmd['style'])
            time.sleep(0.5)
            _write_inline_formatted(driver, cmd['text'])
            time.sleep(0.3)
            # 인용구 밖으로: 아래 화살표 2번 (텍스트 → 출처 → 빈 줄)
            ActionChains(driver).send_keys(Keys.ARROW_DOWN).perform()
            time.sleep(0.3)
            ActionChains(driver).send_keys(Keys.ARROW_DOWN).perform()
            time.sleep(0.3)
            # 새 줄 생성 (사진 등 다른 요소 선택 방지)
            ActionChains(driver).send_keys(Keys.ENTER).perform()
            time.sleep(0.3)

        elif cmd_type == 'hr':
            _insert_horizontal_line(driver, cmd['style'])
            time.sleep(1)

        elif cmd_type == 'align':
            _set_align(driver, cmd['align'])
            time.sleep(0.3)
            _write_inline_formatted(driver, cmd['text'])
            _press_enter(driver)
            _set_align(driver, 'left')
            time.sleep(0.3)
            _press_enter(driver)

        elif cmd_type == 'image':
            _insert_image(driver, cmd['path'])

    # 최소 체류 시간 보장
    min_stay = stay_minutes * 60
    elapsed = (datetime.datetime.now() - start_time).total_seconds()
    remaining = min_stay - elapsed

    if remaining > 0:
        logger.info(f"서식 적용 완료. 최소 체류 시간까지 {remaining:.0f}초 대기 중...")
        time.sleep(remaining)

    logger.info(f"서식 적용 완료 ({total}개 명령, 총 {elapsed + max(remaining, 0):.0f}초 체류)")
