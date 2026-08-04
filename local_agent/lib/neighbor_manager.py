"""네이버 서로이웃 자동 추가 모듈

기존 driver(쿠키 로그인된)를 재사용하여 서로이웃 추가를 진행합니다.
"""
import time
import random
import json
import logging
import urllib.request
import urllib.parse
import os
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

DEFAULT_MESSAGE = "안녕하세요. 관심사가 비슷한 것 같아 서로이웃 신청드립니다. 앞으로 함께 성장해나가면 좋겠습니다."


def search_blogs_for_neighbor(keyword, display=100):
    """네이버 검색 API로 블로그 검색"""
    load_dotenv(override=True)
    client_id = os.getenv('NAVER_CLIENT_ID')
    client_secret = os.getenv('NAVER_CLIENT_SECRET')

    if not client_id or not client_secret:
        logger.error("네이버 검색 API 키가 설정되지 않았습니다.")
        return None

    try:
        encText = urllib.parse.quote(keyword)
        url = f"https://openapi.naver.com/v1/search/blog?query={encText}&display={display}"

        req = urllib.request.Request(url)
        req.add_header("X-Naver-Client-Id", client_id)
        req.add_header("X-Naver-Client-Secret", client_secret)

        response = urllib.request.urlopen(req)
        if response.getcode() == 200:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        logger.error(f"블로그 검색 실패: {e}")
    return None


def is_already_neighbor(driver):
    """이미 이웃 관계인지 확인"""
    try:
        buddy_state = driver.find_elements(By.CLASS_NAME, 'buddy_state')
        if buddy_state and "서로이웃" in buddy_state[0].text:
            return True
    except Exception:
        pass
    return False


def add_neighbor(driver, blog_id, message=DEFAULT_MESSAGE):
    """단일 블로그에 서로이웃 추가

    Returns:
        True: 성공
        False: 실패
        None: 이미 이웃이거나 진행 중인 경우 (스킵)
    """
    try:
        wait = WebDriverWait(driver, 10)

        # 모바일 버전 URL로 접근
        blog_url = (
            f"http://m.blog.naver.com/BuddyAddForm.naver?"
            f"blogId={blog_id}&returnUrl=https%253A%252F%252Fm.blog.naver.com%252F"
        )
        driver.get(blog_url)
        time.sleep(random.uniform(2, 3))

        # 이미 진행 중인 신청 확인
        try:
            exceptional_text = wait.until(
                EC.presence_of_element_located((By.CLASS_NAME, 'dsc'))
            ).text
            if "진행중" in exceptional_text or "제한된" in exceptional_text:
                logger.info(f"[서로이웃] 이미 진행 중: {blog_id}")
                return None
        except Exception:
            pass

        # 서로이웃 체크박스
        try:
            checkbox = wait.until(
                EC.element_to_be_clickable((
                    By.XPATH,
                    '//label[contains(text(), "서로이웃")]/preceding-sibling::input'
                ))
            )
            if not checkbox.is_enabled():
                logger.info(f"[서로이웃] 추가 불가능: {blog_id}")
                return None
            checkbox.click()
            time.sleep(random.uniform(1, 2))
        except Exception as e:
            logger.warning(f"[서로이웃] 체크박스 실패 ({blog_id}): {e}")
            return None

        # 메시지 입력
        try:
            textarea = wait.until(EC.presence_of_element_located((By.TAG_NAME, 'textarea')))
            textarea.clear()
            textarea.send_keys(message)
            time.sleep(random.uniform(1, 2))
        except Exception as e:
            logger.warning(f"[서로이웃] 메시지 입력 실패 ({blog_id}): {e}")
            return False

        # 확인 버튼
        try:
            confirm_button = wait.until(EC.element_to_be_clickable((By.CLASS_NAME, 'btn_ok')))
            confirm_button.click()
            time.sleep(random.uniform(2, 3))
            logger.info(f"[서로이웃] 추가 성공: {blog_id}")
            return True
        except Exception as e:
            logger.warning(f"[서로이웃] 확인 버튼 실패 ({blog_id}): {e}")
            return False

    except Exception as e:
        logger.error(f"[서로이웃] 추가 실패 ({blog_id}): {e}")
        return False


def process_neighbor_keyword(driver, keyword, max_blogs=50, message=DEFAULT_MESSAGE,
                             progress_callback=None):
    """키워드로 블로그 검색 후 일괄 서로이웃 추가

    Args:
        driver: 로그인된 WebDriver
        keyword: 검색 키워드
        max_blogs: 최대 처리 블로그 수
        message: 신청 메시지
        progress_callback: 진행 상황 콜백 (current, total, status_msg)

    Returns:
        dict: {'total': N, 'success': N, 'fail': N, 'skip': N}
    """
    logger.info(f"[서로이웃] 키워드 '{keyword}' 처리 시작 (최대 {max_blogs}개)")

    search_results = search_blogs_for_neighbor(keyword)
    if not search_results:
        return {'total': 0, 'success': 0, 'fail': 0, 'skip': 0}

    items = search_results.get('items', [])
    success = 0
    fail = 0
    skip = 0
    processed = 0

    for item in items:
        if processed >= max_blogs:
            break

        blog_url = item.get('link', '')
        try:
            blog_id = blog_url.split('/')[-2]
        except Exception:
            continue

        if progress_callback:
            progress_callback(processed + 1, max_blogs, f"처리 중: {blog_id}")

        result = add_neighbor(driver, blog_id, message)
        if result is True:
            success += 1
        elif result is False:
            fail += 1
        else:
            skip += 1

        processed += 1
        # 네이버 정책 준수 대기
        time.sleep(random.uniform(5, 10))

    logger.info(f"[서로이웃] 완료: 성공 {success} / 실패 {fail} / 스킵 {skip}")
    return {'total': processed, 'success': success, 'fail': fail, 'skip': skip}
