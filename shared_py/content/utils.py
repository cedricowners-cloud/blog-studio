"""공통 유틸리티 함수"""
import os
import logging
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
