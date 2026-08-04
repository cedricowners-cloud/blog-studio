"""키워드 기반 무료 이미지 수집 모듈 (Unsplash / Pixabay)"""
import os
import logging
import urllib.request
import urllib.parse
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY", "")
PIXABAY_API_KEY = os.getenv("PIXABAY_API_KEY", "")

IMAGE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'images')
os.makedirs(IMAGE_DIR, exist_ok=True)


def search_unsplash(keyword, count=3):
    """Unsplash API로 이미지 검색"""
    if not UNSPLASH_ACCESS_KEY:
        logger.warning("Unsplash API 키가 설정되지 않았습니다.")
        return []

    try:
        query = urllib.parse.quote(keyword)
        url = f"https://api.unsplash.com/search/photos?query={query}&per_page={count}&orientation=landscape"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Client-ID {UNSPLASH_ACCESS_KEY}")

        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        images = []
        for item in data.get('results', []):
            images.append({
                'url': item['urls']['regular'],
                'thumb': item['urls']['thumb'],
                'alt': item.get('alt_description', keyword),
                'credit': item['user']['name'],
                'source': 'Unsplash',
                'link': item['links']['html'],
            })
        return images

    except Exception as e:
        logger.error(f"Unsplash 검색 실패: {e}")
        return []


def search_pixabay(keyword, count=3):
    """Pixabay API로 이미지 검색"""
    if not PIXABAY_API_KEY:
        logger.warning("Pixabay API 키가 설정되지 않았습니다.")
        return []

    try:
        query = urllib.parse.quote(keyword)
        url = (
            f"https://pixabay.com/api/?key={PIXABAY_API_KEY}"
            f"&q={query}&per_page={count}&image_type=photo"
            f"&orientation=horizontal&lang=ko"
        )

        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

        images = []
        for item in data.get('hits', []):
            images.append({
                'url': item['largeImageURL'],
                'thumb': item['previewURL'],
                'alt': item.get('tags', keyword),
                'credit': item['user'],
                'source': 'Pixabay',
                'link': item['pageURL'],
            })
        return images

    except Exception as e:
        logger.error(f"Pixabay 검색 실패: {e}")
        return []


def search_images(keyword, count=3):
    """여러 소스에서 이미지 검색 (Unsplash 우선, Pixabay 보조)"""
    images = search_unsplash(keyword, count)
    if len(images) < count:
        remaining = count - len(images)
        images.extend(search_pixabay(keyword, remaining))
    return images[:count]


def download_image(image_url, filename=None):
    """이미지를 로컬에 다운로드"""
    try:
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            ext = image_url.split('?')[0].split('.')[-1][:4]
            if ext not in ('jpg', 'jpeg', 'png', 'webp'):
                ext = 'jpg'
            filename = f"img_{timestamp}.{ext}"

        filepath = os.path.join(IMAGE_DIR, filename)
        urllib.request.urlretrieve(image_url, filepath)
        logger.info(f"이미지 다운로드: {filepath}")
        return filepath

    except Exception as e:
        logger.error(f"이미지 다운로드 실패: {e}")
        return None


def download_images(images):
    """이미지 목록을 일괄 다운로드"""
    paths = []
    for i, img in enumerate(images):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"img_{timestamp}_{i}.jpg"
        path = download_image(img['url'], filename)
        if path:
            paths.append({'path': path, **img})
    return paths


# ──────────────────────────────────────────────
# AI 이미지 생성
# ──────────────────────────────────────────────

def generate_image_pollinations(prompt, width=1024, height=768, seed=None, max_retries=3):
    """Pollinations.ai 무료 이미지 생성 (API 키 불필요)

    Args:
        prompt: 이미지 설명 프롬프트
        width, height: 이미지 크기
        seed: 랜덤 시드 (None이면 랜덤)
        max_retries: 재시도 횟수

    Returns:
        str: 저장된 이미지 경로 또는 None
    """
    import random
    import time

    # 프롬프트 길이 제한 (너무 길면 500 에러)
    if len(prompt) > 300:
        prompt = prompt[:300]

    for attempt in range(max_retries):
        try:
            current_seed = seed if seed is not None else random.randint(1, 1000000)
            encoded_prompt = urllib.parse.quote(prompt)
            url = (
                f"https://image.pollinations.ai/prompt/{encoded_prompt}"
                f"?width={width}&height={height}&seed={current_seed}"
            )

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"ai_poll_{timestamp}_{current_seed}.jpg"
            filepath = os.path.join(IMAGE_DIR, filename)

            logger.info(f"[Pollinations] 이미지 생성 시도 {attempt + 1}/{max_retries}: {prompt[:50]}...")

            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                                  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/*,*/*',
                    'Referer': 'https://pollinations.ai/',
                }
            )
            with urllib.request.urlopen(req, timeout=90) as response:
                with open(filepath, 'wb') as f:
                    f.write(response.read())

            # 파일이 정상인지 확인 (빈 파일 방지)
            if os.path.getsize(filepath) > 1000:
                logger.info(f"[Pollinations] 생성 완료: {filepath}")
                return filepath
            else:
                os.remove(filepath)
                logger.warning(f"[Pollinations] 빈 파일 수신, 재시도...")

        except urllib.error.HTTPError as e:
            logger.warning(f"[Pollinations] HTTP 에러 {e.code}, 재시도 {attempt + 1}/{max_retries}")
            if attempt < max_retries - 1:
                time.sleep(3)  # 서버 부하 방지
        except Exception as e:
            logger.error(f"[Pollinations] 이미지 생성 실패: {e}")
            if attempt < max_retries - 1:
                time.sleep(3)

    logger.error(f"[Pollinations] {max_retries}회 재시도 모두 실패")
    return None


def generate_image_gemini(prompt, model_name="imagen-3.0-generate-001"):
    """Google Gemini Imagen으로 이미지 생성 (유료)

    Args:
        prompt: 이미지 설명 프롬프트
        model_name: Imagen 모델명

    Returns:
        str: 저장된 이미지 경로 또는 None
    """
    try:
        import google.generativeai as genai
        api_key = os.getenv("GEMINI_API_KEY", "")
        if not api_key:
            logger.warning("Gemini API 키가 없습니다.")
            return None

        genai.configure(api_key=api_key)

        # Gemini는 google.genai 모듈을 사용한 이미지 생성 API 제공
        try:
            from google import genai as google_genai
            client = google_genai.Client(api_key=api_key)
            result = client.models.generate_images(
                model=model_name,
                prompt=prompt,
                config={'number_of_images': 1}
            )

            if result.generated_images:
                image_bytes = result.generated_images[0].image.image_bytes
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"ai_gemini_{timestamp}.png"
                filepath = os.path.join(IMAGE_DIR, filename)
                with open(filepath, 'wb') as f:
                    f.write(image_bytes)
                logger.info(f"[Gemini Imagen] 생성 완료: {filepath}")
                return filepath
        except ImportError:
            logger.error("google.genai 모듈이 필요합니다. pip install google-genai")
            return None
        except Exception as e:
            logger.error(f"[Gemini Imagen] 생성 실패: {e}")
            return None

    except Exception as e:
        logger.error(f"[Gemini Imagen] 초기화 실패: {e}")
        return None


def generate_image_dalle(prompt, size="1792x1024"):
    """OpenAI DALL-E 3로 이미지 생성 (유료)

    Args:
        prompt: 이미지 설명 프롬프트
        size: "1024x1024", "1024x1792", "1792x1024"

    Returns:
        str: 저장된 이미지 경로 또는 None
    """
    try:
        from openai import OpenAI
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("GPT_API_KEY", "")
        if not api_key:
            logger.warning("OpenAI API 키가 없습니다.")
            return None

        client = OpenAI(api_key=api_key)
        response = client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            size=size,
            quality="standard",
            n=1,
        )

        image_url = response.data[0].url
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"ai_dalle_{timestamp}.png"
        filepath = os.path.join(IMAGE_DIR, filename)
        urllib.request.urlretrieve(image_url, filepath)
        logger.info(f"[DALL-E] 생성 완료: {filepath}")
        return filepath

    except Exception as e:
        logger.error(f"[DALL-E] 생성 실패: {e}")
        return None


def generate_ai_image(prompt, provider="pollinations"):
    """AI 이미지 생성 통합 인터페이스

    Args:
        prompt: 이미지 설명 프롬프트
        provider: "pollinations" (무료) / "gemini" / "dalle"

    Returns:
        dict: {'path': ..., 'source': ..., 'prompt': ...} 또는 None
    """
    path = None
    if provider == "pollinations":
        path = generate_image_pollinations(prompt)
    elif provider == "gemini":
        path = generate_image_gemini(prompt)
    elif provider == "dalle":
        path = generate_image_dalle(prompt)
    else:
        logger.error(f"알 수 없는 provider: {provider}")
        return None

    if path:
        return {
            'path': path,
            'source': f'AI ({provider})',
            'prompt': prompt,
            'credit': 'AI Generated',
        }
    return None


def generate_image_prompt_from_content(title, content_snippet, ai_generator):
    """블로그 콘텐츠를 기반으로 이미지 프롬프트를 AI가 생성

    Args:
        title: 블로그 제목
        content_snippet: 본문 일부 (앞 500자)
        ai_generator: AIContentGenerator 인스턴스

    Returns:
        str: 이미지 생성용 영어 프롬프트
    """
    prompt_request = f"""
    다음 블로그 글의 대표 이미지를 만들기 위한 이미지 생성 프롬프트를 작성해주세요.

    제목: {title}
    본문 일부: {content_snippet[:500]}

    요구사항:
    1. 영어로 작성 (Stable Diffusion/DALL-E 호환)
    2. 구체적인 장면 묘사 (피사체, 배경, 분위기, 조명)
    3. 사진 스타일 지정 (professional photography, realistic, cinematic 등)
    4. 한국 비즈니스/블로그 맥락 반영
    5. 100자 이내로 간결하게

    프롬프트만 출력하고 설명은 생략해주세요.
    """
    try:
        result = ai_generator.generate_content(prompt_request)
        if result:
            # 따옴표, 줄바꿈 정리
            return result.strip().strip('"\'').replace('\n', ' ')
    except Exception as e:
        logger.error(f"이미지 프롬프트 생성 실패: {e}")
    return None
