"""공통 유틸리티 함수"""
import os
import logging
import time
from datetime import datetime
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

logger = logging.getLogger(__name__)


def find_recent_file(prefix, extension='.xlsx', data_dir=None):
    """가장 최근에 생성된 파일을 찾는 함수

    Args:
        prefix: 파일명 접두사 (e.g. 'data', 'search_topic')
        extension: 파일 확장자 (e.g. '.xlsx', '.txt')
        data_dir: 검색 디렉토리 (기본값: ./data)
    """
    if data_dir is None:
        data_dir = os.path.join(os.getcwd(), 'data')
    os.makedirs(data_dir, exist_ok=True)

    files = []
    for file in os.listdir(data_dir):
        if file.startswith(prefix) and file.endswith(extension):
            files.append(os.path.join(data_dir, file))

    if not files:
        return None

    files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    return files[0]


def wait_and_find_element(driver, selector, timeout=10):
    """Selenium WebDriver에서 CSS 선택자로 요소를 찾는 함수"""
    try:
        element = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, selector))
        )
        return element
    except TimeoutException:
        logger.warning(f"요소를 찾을 수 없습니다: {selector}")
        return None


def find_clickable_by_text(driver, texts, root=None, timeout=5):
    """버튼/링크를 **표시 텍스트**로 찾는다.

    네이버 에디터의 클래스는 빌드마다 바뀌는 해시(`.save_btn__bzc5B`)라서
    라벨로 찾는 쪽이 오래 견딘다. 정확히 일치하는 것을 먼저 보고, 없으면
    포함 관계로 완화한다.

    Args:
        texts: 후보 라벨 목록. 앞쪽 우선.
        root: 탐색 범위를 제한할 요소 (예: 발행 레이어). None이면 문서 전체.
    Returns:
        화면에 보이고 활성화된 첫 요소, 없으면 None
    """
    scope = root if root is not None else driver
    deadline = time.time() + timeout
    while True:
        for text in texts:
            for xpath in (
                f'.//*[self::button or self::a or @role="button"]'
                f'[normalize-space(text())="{text}"]',
                f'.//*[self::button or self::a or @role="button"]'
                f'[contains(normalize-space(.), "{text}")]',
            ):
                try:
                    for el in scope.find_elements(By.XPATH, xpath):
                        if el.is_displayed() and el.is_enabled():
                            return el
                except Exception:
                    continue
        if time.time() >= deadline:
            logger.warning(f"텍스트로 요소를 찾지 못했습니다: {texts}")
            return None
        time.sleep(0.3)


def describe_clickables(driver, root=None, limit=25):
    """현재 화면의 버튼 라벨·클래스를 수집한다 (진단용).

    해시 클래스의 실제 라벨을 모르는 상태에서 DOM 구조를 파악하기 위한 것.
    """
    scope = root if root is not None else driver
    out = []
    try:
        els = scope.find_elements(
            By.XPATH, './/*[self::button or self::a or @role="button"]'
        )
    except Exception:
        return out
    for el in els:
        try:
            if not el.is_displayed():
                continue
            label = (el.text or el.get_attribute("aria-label") or "").strip()
            cls = (el.get_attribute("class") or "").strip()
            if not label and not cls:
                continue
            out.append(f"{label[:20]!r}·{cls[:38]}")
            if len(out) >= limit:
                break
        except Exception:
            continue
    return out
