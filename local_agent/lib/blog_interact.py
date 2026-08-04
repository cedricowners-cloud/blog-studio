"""블로그 좋아요 + 댓글 자동 입력 모듈

이웃 블로그의 최신글에 좋아요와 댓글을 자동으로 작성합니다.
driver(쿠키 로그인된)를 재사용합니다.
"""
import time
import random
import re
import json
import logging
import requests
from typing import Optional, List, Tuple
from bs4 import BeautifulSoup
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

logger = logging.getLogger(__name__)

DEFAULT_COMMENT_TEMPLATES = [
    "좋은 글 잘 읽었습니다. 감사합니다!",
    "유익한 정보 감사합니다. 잘 보고 갑니다!",
    "정말 도움이 되는 글이네요. 공감합니다!",
    "글 잘 읽었습니다. 다음 글도 기대됩니다!",
    "좋은 정보 공유해주셔서 감사합니다!",
]


def _get_session_from_driver(driver):
    """driver의 쿠키를 requests.Session에 복사"""
    session = requests.Session()
    for cookie in driver.get_cookies():
        session.cookies.set(cookie['name'], cookie['value'])
    return session


def _api_headers(referer="https://m.blog.naver.com/PostView.naver"):
    return {
        'accept': '*/*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'referer': referer,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    }


# ──────────────────────────────────────────────
# 이웃 블로그 목록 가져오기
# ──────────────────────────────────────────────

def get_neighbor_blogs(driver, page=1, max_posts=10):
    """이웃새글 목록 가져오기

    Returns:
        list of tuple: [(blog_id, post_id), ...]
    """
    try:
        url = f"https://section.blog.naver.com/BlogHome.naver?directoryNo=0&currentPage={page}&groupId=0"
        driver.get(url)
        time.sleep(5)

        wait = WebDriverWait(driver, 15)
        buddy_section = wait.until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'section.wrap_thumbnail_post_list'))
        )

        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(2)

        posts = buddy_section.find_elements(By.CSS_SELECTOR, 'div.item.multi_pic')
        logger.info(f"[이웃새글] {len(posts)}개 게시물 발견 (페이지 {page})")

        blog_links = []
        seen_urls = set()

        for post in posts:
            try:
                post_link = post.find_element(By.CSS_SELECTOR, 'a.desc_inner')
                href = post_link.get_attribute('href')
                if not href or href in seen_urls:
                    continue

                blog_id_match = re.search(r'blog\.naver\.com/([^/]+)', href)
                post_id_match = re.search(r'/(\d+)(?:\?|$)', href)

                if blog_id_match and post_id_match:
                    blog_links.append((blog_id_match.group(1), post_id_match.group(1)))
                    seen_urls.add(href)
            except Exception:
                continue

        result = blog_links[:max_posts]
        logger.info(f"[이웃새글] {len(result)}개 추출")
        return result

    except Exception as e:
        logger.error(f"[이웃새글] 목록 가져오기 실패: {e}")
        return []


# ──────────────────────────────────────────────
# 좋아요
# ──────────────────────────────────────────────

def like_post(driver, blog_id, post_id):
    """블로그 포스트에 좋아요"""
    try:
        session = _get_session_from_driver(driver)
        headers = _api_headers()

        # 토큰 가져오기
        token_url = "https://apis.naver.com/blogserver/like/v1/search/contents"
        token_params = {
            'suppress_response_codes': 'true',
            'pool': 'blogid',
            'q': f'BLOG[{blog_id}_{post_id}]',
            'isDuplication': 'true',
            'cssIds': 'BASIC_MOBILE,BLOG_MOBILE',
        }
        token_resp = session.get(token_url, params=token_params, headers=headers)
        token_data = token_resp.json()
        timestamp = token_data.get('timestamp')
        guest_token = token_data.get('guestToken')

        if not timestamp or not guest_token:
            logger.warning(f"[좋아요] 토큰 실패: {blog_id}/{post_id}")
            return False

        # 좋아요 요청
        url = f"https://apis.naver.com/blogserver/like/v1/services/BLOG/contents/{blog_id}_{post_id}"
        params = {
            'suppress_response_codes': 'true',
            '_method': 'POST',
            'pool': 'blogid',
            'displayId': 'BLOG',
            'reactionType': 'like',
            'categoryId': 'post',
            'guestToken': guest_token,
            'timestamp': timestamp,
            '_ch': 'mbw',
            'isDuplication': 'true',
            'lang': 'ko',
            'countType': 'DEFAULT',
            'count': '1',
            '_': timestamp,
        }
        resp = session.get(url, params=params, headers=headers)
        result = resp.json()

        if result.get('statusCode') == 200 or result.get('isReacted'):
            logger.info(f"[좋아요] 성공: {blog_id}/{post_id}")
            return True
        elif result.get('statusCode') == 409:
            logger.info(f"[좋아요] 이미 공감: {blog_id}/{post_id}")
            return True
        else:
            logger.warning(f"[좋아요] 실패: {result.get('message', '알 수 없는 오류')}")
            return False

    except Exception as e:
        logger.error(f"[좋아요] 에러 ({blog_id}/{post_id}): {e}")
        return False


# ──────────────────────────────────────────────
# 댓글
# ──────────────────────────────────────────────

def _get_blog_no(blog_id, post_id):
    """블로그 번호 조회"""
    try:
        url = f'https://blog.naver.com/PostView.naver?blogId={blog_id}&logNo={post_id}'
        resp = requests.get(url)
        match = re.search(r"blogNo\s*=\s*'(\d+)'", resp.content.decode('utf-8'))
        return match.group(1) if match else None
    except Exception:
        return None


def _get_cbox_token(driver, blog_no, post_id):
    """댓글 토큰 조회"""
    try:
        session = _get_session_from_driver(driver)
        url = "https://apis.naver.com/commentBox/cbox/web_naver_token_jsonp.json"
        params = {
            'ticket': 'blog', 'templateId': 'default', 'pool': 'blogid',
            'lang': 'ko', 'objectId': f'{blog_no}_201_{post_id}',
            'groupId': blog_no,
        }
        headers = _api_headers('https://m.blog.naver.com/CommentList.naver')
        resp = session.get(url, params=params, headers=headers)
        return resp.json()['result']['cbox_token']
    except Exception:
        return None


def get_blog_content(blog_id, post_id):
    """블로그 본문 내용 가져오기 (AI 댓글 생성용)"""
    try:
        url = f'https://blog.naver.com/PostView.naver?blogId={blog_id}&logNo={post_id}'
        resp = requests.get(url)
        soup = BeautifulSoup(resp.content, 'html.parser')
        content = soup.find('div', {'class': 'se-main-container'})
        if not content:
            content = soup.find('div', {'id': 'postViewArea'})
        if content:
            return content.get_text(separator=' ', strip=True)[:2000]
    except Exception:
        pass
    return None


def write_comment(driver, blog_id, post_id, comment_text):
    """블로그에 댓글 작성"""
    try:
        blog_no = _get_blog_no(blog_id, post_id)
        if not blog_no:
            logger.warning(f"[댓글] 블로그 번호 조회 실패: {blog_id}")
            return False

        cbox_token = _get_cbox_token(driver, blog_no, post_id)
        if not cbox_token:
            logger.warning(f"[댓글] 토큰 조회 실패: {blog_id}")
            return False

        session = _get_session_from_driver(driver)
        url = "https://apis.naver.com/commentBox/cbox/web_naver_create_json.json"
        params = {'ticket': 'blog', 'templateId': 'default', 'pool': 'blogid',
                  '_cv': str(int(time.time() * 1000))}
        data = {
            'lang': 'ko', 'objectId': f'{blog_no}_201_{post_id}',
            'categoryId': '', 'pageSize': '100', 'indexSize': '10',
            'groupId': blog_no, 'listType': 'OBJECT', 'pageType': 'more',
            'objectUrl': f'https://m.blog.naver.com/CommentList.naver?blogId={blog_id}&logNo={post_id}',
            'contents': comment_text, 'commentType': 'txt',
            'validateBanWords': 'false', 'cbox_token': cbox_token,
        }
        headers = _api_headers(f'https://m.blog.naver.com/CommentList.naver?blogId={blog_id}&logNo={post_id}')
        headers['content-type'] = 'application/x-www-form-urlencoded'
        headers['origin'] = 'https://m.blog.naver.com'

        resp = session.post(url, params=params, headers=headers, data=data)
        result = resp.json()

        if result.get('success'):
            logger.info(f"[댓글] 성공: {blog_id}/{post_id}")
            return True
        else:
            logger.warning(f"[댓글] 실패: {blog_id}/{post_id}")
            return False

    except Exception as e:
        logger.error(f"[댓글] 에러 ({blog_id}/{post_id}): {e}")
        return False


# ──────────────────────────────────────────────
# 통합 실행
# ──────────────────────────────────────────────

def process_neighbor_interaction(driver, max_pages=1, do_like=True, do_comment=True,
                                  comment_mode='template', ai_generator=None,
                                  progress_callback=None):
    """이웃 블로그 방문 + 좋아요 + 댓글

    Args:
        driver: 로그인된 WebDriver
        max_pages: 처리할 페이지 수
        do_like: 좋아요 여부
        do_comment: 댓글 여부
        comment_mode: 'template' 또는 'ai'
        ai_generator: AI 댓글 생성기 (comment_mode='ai'일 때)
        progress_callback: (current, total, status) 콜백

    Returns:
        dict: {'total': N, 'likes': N, 'comments': N}
    """
    total = 0
    likes = 0
    comments = 0
    template_index = 0

    for page in range(1, max_pages + 1):
        blogs = get_neighbor_blogs(driver, page)
        if not blogs:
            break

        for i, (blog_id, post_id) in enumerate(blogs):
            total += 1
            if progress_callback:
                progress_callback(total, len(blogs) * max_pages,
                                  f"[{page}p] {blog_id}/{post_id}")

            # 좋아요
            if do_like:
                if like_post(driver, blog_id, post_id):
                    likes += 1
                time.sleep(random.uniform(2, 4))

            # 댓글
            if do_comment:
                if comment_mode == 'ai' and ai_generator:
                    content = get_blog_content(blog_id, post_id)
                    if content:
                        prompt = (
                            "다음 블로그 글을 읽고 적절한 댓글을 1-2문장으로 작성해주세요. "
                            "긍정적이고 격려하는 톤으로 작성해주세요.\n\n"
                            f"블로그 내용:\n{content}"
                        )
                        comment_text = ai_generator.generate_content(prompt)
                    else:
                        comment_text = DEFAULT_COMMENT_TEMPLATES[template_index % len(DEFAULT_COMMENT_TEMPLATES)]
                        template_index += 1
                else:
                    comment_text = DEFAULT_COMMENT_TEMPLATES[template_index % len(DEFAULT_COMMENT_TEMPLATES)]
                    template_index += 1

                if comment_text and write_comment(driver, blog_id, post_id, comment_text):
                    comments += 1
                time.sleep(random.uniform(3, 5))

    logger.info(f"[이웃 상호작용] 완료: 총 {total}개 / 좋아요 {likes} / 댓글 {comments}")
    return {'total': total, 'likes': likes, 'comments': comments}
