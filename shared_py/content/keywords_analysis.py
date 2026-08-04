from selenium import webdriver
from selenium.webdriver.common.by import By
import time
import pandas as pd
import os
from datetime import datetime
import subprocess
import platform
import urllib.request
import urllib.parse
import json
from dotenv import load_dotenv
import hmac
import hashlib
import base64
import re
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from utils import wait_and_find_element

# .env 파일에서 환경 변수 로드
load_dotenv()

# 네이버 검색 API 인증 정보
client_id = os.getenv("NAVER_CLIENT_ID")
client_secret = os.getenv("NAVER_CLIENT_SECRET")

# 네이버 검색광고 API 인증 정보
access_license_key = os.getenv("NAVER_SEARCH_ACCESS_LICENSE_KEY")
secret_key = os.getenv("NAVER_SEARCH_SECRET_KEY")
customer_id = os.getenv("NAVER_SEARCH_CUSTOMER_ID")

def crawl_blog_keywords(driver, url):
    """블로그 상세 페이지에서 키워드를 수집하는 함수"""
    try:
        # 새 탭 열기
        driver.execute_script("window.open('');")
        driver.switch_to.window(driver.window_handles[-1])
        driver.get(url)
        time.sleep(7)  # 페이지 로딩 대기 시간 증가
        
        # 키워드 수집
        keywords = []
        try:
            # 페이지 소스 확인
            print("\n페이지 소스 확인 중...")
            page_source = driver.page_source
            print(f"페이지 소스 길이: {len(page_source)}")
            
            # iframe 확인
            iframes = driver.find_elements(By.TAG_NAME, "iframe")
            if iframes:
                print(f"발견된 iframe 수: {len(iframes)}")
                for iframe in iframes:
                    try:
                        driver.switch_to.frame(iframe)
                        print("iframe 내부로 전환")
                        time.sleep(2)  # iframe 로딩 대기
                    except:
                        print("iframe 전환 실패")
                        continue
            
            # 다양한 선택자로 시도
            selectors = [
                '.wrap_tag a.item.pcol2.itemTagfont._setTop span.ell',  # 블로그 태그
                'a.tag.__search_tag',  # 검색 태그
                '.tag_list a.tag',  # 태그 목록
                '.tag_list span.tag',  # 태그 목록 (span)
                '.tag_list a',  # 태그 목록 (a)
                '.tag_list span',  # 태그 목록 (span)
                '.tag_list .tag',  # 태그 목록 (tag 클래스)
                '.tag_list .item',  # 태그 목록 (item 클래스)
                '.tag_list .itemTagfont'  # 태그 목록 (itemTagfont 클래스)
            ]
            
            for selector in selectors:
                print(f"\n선택자 시도: {selector}")
                try:
                    tag_elements = driver.find_elements(By.CSS_SELECTOR, selector)
                    if tag_elements:
                        print(f"찾은 태그 요소 수: {len(tag_elements)}")
                        
                        if selector == 'a.tag.__search_tag':
                            # tag __search_tag 클래스의 경우 data-tagname 속성에서 키워드 추출
                            new_keywords = [element.get_attribute('data-tagname') for element in tag_elements]
                        else:
                            # 다른 선택자의 경우 텍스트에서 # 제거
                            new_keywords = []
                            for element in tag_elements:
                                text = element.text.strip()
                                if text.startswith('#'):
                                    text = text[1:]  # # 제거
                                if text:  # 빈 문자열이 아닌 경우만 추가
                                    new_keywords.append(text)
                        
                        print(f"수집된 키워드: {new_keywords}")
                        keywords.extend(new_keywords)  # 기존 키워드에 추가
                        if new_keywords:
                            break
                except Exception as e:
                    print(f"선택자 {selector} 실패: {str(e)}")
            
            # 중복 제거
            keywords = list(set(keywords))
            
            if not keywords:
                print("모든 선택자로 키워드를 찾지 못했습니다.")
                
        except Exception as e:
            print(f"키워드 수집 중 에러 발생: {str(e)}")
            print("페이지 소스 확인 중...")
            page_source = driver.page_source
            print(f"페이지 소스 길이: {len(page_source)}")
        
        finally:
            # 새 탭 닫기
            try:
                driver.close()
                driver.switch_to.window(driver.window_handles[0])
            except:
                print("탭 전환 중 에러 발생")
        
        return keywords
    except Exception as e:
        print(f"키워드 수집 중 에러 발생: {str(e)}")
        return []

def analyze_keywords(search_results):
    """검색 결과에서 키워드를 분석하는 함수"""
    if not search_results:
        return {}
    
    # 모든 키워드 수집
    all_keywords = []
    for result in search_results:
        all_keywords.extend(result['keywords'])
    
    # 키워드 빈도수 계산
    keyword_freq = {}
    for keyword in all_keywords:
        if keyword in keyword_freq:
            keyword_freq[keyword] += 1
        else:
            keyword_freq[keyword] = 1
    
    # 빈도수 기준으로 정렬
    return dict(sorted(keyword_freq.items(), key=lambda x: x[1], reverse=True))

def analyze_search_results(search_results):
    """검색 결과를 분석하여 텍스트로 반환하는 함수"""
    if not search_results:
        return ""
        
    # 검색 결과 분석을 위한 텍스트 생성
    analysis_text = "다음은 네이버 블로그 검색 상위 결과들의 특징입니다:\n\n"
    
    # 제목 패턴 분석
    titles = [result['title'] for result in search_results]
    analysis_text += "1. 제목 패턴:\n"
    analysis_text += "- " + "\n- ".join(titles) + "\n\n"
    
    # 설명 패턴 분석
    descriptions = [result['description'] for result in search_results]
    analysis_text += "2. 설명 패턴:\n"
    analysis_text += "- " + "\n- ".join(descriptions) + "\n\n"
    
    # 키워드 분석
    keyword_analysis = analyze_keywords(search_results)
    
    analysis_text += "3. 자주 사용된 키워드:\n"
    for keyword, freq in list(keyword_analysis.items())[:10]:  # 상위 10개 키워드만 표시
        analysis_text += f"- {keyword} ({freq}회)\n"
    
    return analysis_text

def save_to_excel(search_results, keyword_analysis):
    """검색 결과와 키워드 분석 결과를 엑셀 파일로 저장하는 함수"""
    try:
        # data 폴더가 없으면 생성
        if not os.path.exists('data'):
            os.makedirs('data')
        
        # 현재 시간을 파일명에 추가
        current_time = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Sheet1: 블로그별 키워드 데이터
        blog_data = []
        for result in search_results:
            blog_data.append({
                '블로그 제목': result['title'],
                '블로그 주소': result['url'],
                '키워드': ', '.join(result['keywords'])
            })
        df_blogs = pd.DataFrame(blog_data)
        
        # Sheet2: 전체 키워드 분석 데이터
        keyword_data = []
        for keyword, freq in keyword_analysis.items():
            keyword_data.append({
                '키워드': keyword,
                '빈도수': freq
            })
        df_keywords = pd.DataFrame(keyword_data)
        
        # Excel 파일로 저장
        excel_filename = f'data/keyword_analysis_{current_time}.xlsx'
        with pd.ExcelWriter(excel_filename) as writer:
            df_blogs.to_excel(writer, sheet_name='블로그별 키워드', index=False)
            df_keywords.to_excel(writer, sheet_name='전체 키워드 분석', index=False)
        
        print(f"\n키워드 분석 결과가 {excel_filename} 파일에 저장되었습니다.")
        
    except Exception as e:
        print(f"엑셀 파일 저장 중 오류 발생: {e}")

def get_timestamp():
    return str(int(time.time() * 1000))

def get_signature(timestamp, method, resource):
    message = f"{timestamp}.{method}.{resource}"
    signature = hmac.HMAC(
        secret_key.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).digest()
    return base64.b64encode(signature).decode('utf-8')

def search_blog_api(query, display=10):
    """네이버 검색 API를 사용하여 블로그 검색"""
    # API 키 확인
    if not client_id or not client_secret:
        print("⚠️ 네이버 검색 API 키가 설정되지 않았습니다.")
        print("📝 기본 키워드로 진행합니다.")
        # 기본 더미 데이터 반환
        return [{
            'title': f'{query} 관련 정보',
            'link': 'https://blog.naver.com',
            'description': f'{query}에 대한 유용한 정보를 제공합니다.',
            'bloggername': '샘플 블로그',
            'postdate': '20250119'
        }]

    encText = urllib.parse.quote(query)
    url = f"https://openapi.naver.com/v1/search/blog?query={encText}&display={display}&sort=sim"

    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", client_id)
    request.add_header("X-Naver-Client-Secret", client_secret)

    try:
        response = urllib.request.urlopen(request)
        rescode = response.getcode()

        if rescode == 200:
            response_body = response.read()
            result = json.loads(response_body.decode('utf-8'))
            return result.get('items', [])
        else:
            print(f"Error Code: {rescode}")
            return []

    except Exception as e:
        print(f"Error occurred: {str(e)}")
        return []

def search_keyword_volume(keywords):
    """네이버 검색광고 API를 사용하여 키워드 검색량 조회"""
    # 매번 .env 다시 로드 (앱 실행 중 키 추가 대응)
    load_dotenv(override=True)
    access_license = os.getenv("NAVER_SEARCH_ACCESS_LICENSE_KEY")
    secret = os.getenv("NAVER_SEARCH_SECRET_KEY")
    customer = os.getenv("NAVER_SEARCH_CUSTOMER_ID")

    if not access_license or not secret or not customer:
        print("⚠️ 네이버 검색광고 API 키가 설정되지 않았습니다.")
        return None

    timestamp = get_timestamp()
    method = "GET"
    resource = "/keywordstool"

    base_url = "https://api.searchad.naver.com"
    params = {
        "siteId": "naver",
        "hintKeywords": keywords,
        "showDetail": "1"
    }
    query_string = urllib.parse.urlencode(params)
    url = f"{base_url}{resource}?{query_string}"

    # 서명 생성에 secret 사용
    message = f"{timestamp}.{method}.{resource}"
    import hmac as _hmac
    signature = _hmac.HMAC(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).digest()
    signature_b64 = base64.b64encode(signature).decode('utf-8')

    headers = {
        "X-Timestamp": timestamp,
        "X-API-KEY": access_license,
        "X-Customer": customer,
        "X-Signature": signature_b64
    }

    try:
        request = urllib.request.Request(url, headers=headers)
        response = urllib.request.urlopen(request)
        rescode = response.getcode()

        if rescode == 200:
            response_body = response.read()
            return json.loads(response_body.decode('utf-8'))
        else:
            print(f"검색광고 API 에러 코드: {rescode}")
            return None

    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8') if e.fp else ''
        print(f"검색광고 API HTTP 에러: {e.code} - {body}")
        return None
    except Exception as e:
        print(f"검색광고 API 호출 실패: {str(e)}")
        return None

def search_news_api(query, display=10):
    """네이버 뉴스 검색 API"""
    load_dotenv(override=True)
    cid = os.getenv("NAVER_CLIENT_ID")
    csec = os.getenv("NAVER_CLIENT_SECRET")
    if not cid or not csec:
        return []

    encText = urllib.parse.quote(query)
    url = f"https://openapi.naver.com/v1/search/news?query={encText}&display={display}&sort=date"
    req = urllib.request.Request(url)
    req.add_header("X-Naver-Client-Id", cid)
    req.add_header("X-Naver-Client-Secret", csec)

    try:
        response = urllib.request.urlopen(req)
        if response.getcode() == 200:
            data = json.loads(response.read().decode('utf-8'))
            news_list = []
            for item in data.get('items', []):
                # HTML 태그 제거
                title = re.sub(r'<[^>]+>', '', item.get('title', ''))
                desc = re.sub(r'<[^>]+>', '', item.get('description', ''))
                news_list.append({
                    'title': title,
                    'description': desc,
                    'link': item.get('link', ''),
                    'pubDate': item.get('pubDate', ''),
                })
            return news_list
    except Exception as e:
        print(f"뉴스 검색 실패: {e}")
    return []


def get_datalab_trend(keyword, period_months=6):
    """네이버 데이터랩으로 키워드 검색 트렌드 조회 (월별 비율)

    Returns:
        list of dict: [{'period': '2025-10-01', 'ratio': 75.3}, ...]
    """
    load_dotenv(override=True)
    cid = os.getenv("NAVER_CLIENT_ID")
    csec = os.getenv("NAVER_CLIENT_SECRET")
    if not cid or not csec:
        return []

    from datetime import datetime, timedelta
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30 * period_months)

    body = {
        "startDate": start_date.strftime("%Y-%m-%d"),
        "endDate": end_date.strftime("%Y-%m-%d"),
        "timeUnit": "month",
        "keywordGroups": [
            {"groupName": keyword, "keywords": [keyword]}
        ]
    }

    url = "https://openapi.naver.com/v1/datalab/search"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode('utf-8'),
        method='POST'
    )
    req.add_header("X-Naver-Client-Id", cid)
    req.add_header("X-Naver-Client-Secret", csec)
    req.add_header("Content-Type", "application/json")

    try:
        response = urllib.request.urlopen(req)
        if response.getcode() == 200:
            data = json.loads(response.read().decode('utf-8'))
            results = data.get('results', [])
            if results:
                return results[0].get('data', [])
    except Exception as e:
        print(f"데이터랩 트렌드 조회 실패: {e}")
    return []


def collect_research_data(keywords):
    """선택한 키워드 목록으로 통합 자료 수집

    Args:
        keywords: 선택된 키워드 리스트

    Returns:
        dict: {
            'blogs': [...],     # 상위 블로그 (각 키워드 5개씩)
            'news': [...],      # 최신 뉴스 (각 키워드 5개씩)
            'trends': {...},    # 키워드별 트렌드 데이터
        }
    """
    print(f"[자료 수집] 시작: {len(keywords)}개 키워드")

    all_blogs = []
    all_news = []
    trends = {}

    for kw in keywords:
        print(f"[자료 수집] '{kw}' 처리 중...")
        # 블로그
        blogs = search_blog_api(kw, display=5)
        for b in blogs:
            title = re.sub(r'<[^>]+>', '', b.get('title', ''))
            desc = re.sub(r'<[^>]+>', '', b.get('description', ''))
            all_blogs.append({
                'keyword': kw,
                'title': title,
                'description': desc,
                'link': b.get('link', ''),
                'bloggername': b.get('bloggername', ''),
                'postdate': b.get('postdate', ''),
            })

        # 뉴스
        news = search_news_api(kw, display=5)
        for n in news:
            n['keyword'] = kw
            all_news.append(n)

        # 트렌드
        trend = get_datalab_trend(kw, period_months=6)
        if trend:
            trends[kw] = trend

    print(f"[자료 수집] 완료: 블로그 {len(all_blogs)}개, 뉴스 {len(all_news)}개, 트렌드 {len(trends)}개")

    return {
        'blogs': all_blogs,
        'news': all_news,
        'trends': trends,
    }


def analyze_keyword_with_volume(keyword):
    """키워드 분석: 연관 키워드 + 검색량 조회 (빠른 버전)

    Returns:
        list of dict: [
            {'keyword': '...', 'pc': 1000, 'mobile': 5000, 'total': 6000,
             'comp_idx': '높음'},
            ...
        ]
    """
    print(f"[키워드 분석] '{keyword}' 시작...")
    keyword_results = search_keyword_volume(keyword)

    if not keyword_results or 'keywordList' not in keyword_results:
        print("[키워드 분석] API 응답 없음")
        return []

    analysis = []
    for item in keyword_results.get('keywordList', []):
        kw = item.get('relKeyword', '')
        if not kw:
            continue

        pc_cnt = parse_search_count(item.get('monthlyPcQcCnt', 0))
        mobile_cnt = parse_search_count(item.get('monthlyMobileQcCnt', 0))
        total_cnt = pc_cnt + mobile_cnt

        analysis.append({
            'keyword': kw,
            'pc': pc_cnt,
            'mobile': mobile_cnt,
            'total': total_cnt,
            'blog_count': 0,        # 빠른 표시를 위해 생략
            'competition': 0,        # 빠른 표시를 위해 생략
            'comp_idx': item.get('compIdx', ''),
        })

    # 검색량 높은 순으로 정렬
    analysis.sort(key=lambda x: x['total'], reverse=True)
    print(f"[키워드 분석] 완료: {len(analysis)}개")
    return analysis


def crawl_naver_blog_search(topic):
    """네이버 블로그 검색 결과를 크롤링하는 함수"""
    try:
        # 블로그 검색 API 호출
        blog_results = search_blog_api(topic, display=5)
        if not blog_results:
            print("검색 결과가 없습니다.")
            # 기본 키워드로 진행
            blog_results = [{
                'title': f'{topic} 관련 정보',
                'link': 'https://blog.naver.com',
                'description': f'{topic}에 대한 유용한 정보',
                'bloggername': '기본',
                'postdate': '20250119'
            }]

        # 키워드 검색량 조회
        keyword_results = search_keyword_volume(topic)

        # 키워드 분석 결과 저장
        keyword_analysis = []
        selected_keywords = [topic]  # 기본값

        if keyword_results and 'keywordList' in keyword_results:
            for item in keyword_results.get('keywordList', []):
                keyword = item.get('relKeyword', '')
                if not keyword:
                    continue

                monthly_pc_cnt = parse_search_count(item.get('monthlyPcQcCnt', 0))
                monthly_mobile_cnt = parse_search_count(item.get('monthlyMobileQcCnt', 0))
                total_cnt = monthly_pc_cnt + monthly_mobile_cnt
                comp_idx = item.get('compIdx', '')

                # 블로그 문서 수 검색
                blog_cnt = search_blog_docs(keyword)
                if isinstance(blog_cnt, str) and blog_cnt.startswith("Error"):
                    blog_cnt = 0

                # 경쟁률 계산 (문서수/검색수)
                competition_rate = 0
                if total_cnt > 0:
                    competition_rate = blog_cnt / total_cnt

                keyword_analysis.append({
                    'keyword': keyword,
                    'total_count': total_cnt,
                    'blog_count': blog_cnt,
                    'competition_rate': competition_rate,
                    'comp_idx': comp_idx
                })

            # 경쟁률 기준으로 정렬 (낮은 순)
            keyword_analysis.sort(key=lambda x: x['competition_rate'])

            # 상위 10개 키워드 선택 (경쟁률이 낮은 순)
            if keyword_analysis:
                selected_keywords = [item['keyword'] for item in keyword_analysis[:10]]
        else:
            # API 키가 없을 때는 AI가 직접 키워드 생성
            print("📝 AI가 검색 결과를 분석하여 키워드를 생성합니다.")
            selected_keywords = None
        
        search_results = []
        print(f"\n'{topic}' 주제로 검색된 상위 블로그 정보:")
        print("=" * 50)
        
        for i, item in enumerate(blog_results, 1):
            try:
                # 블로그 정보 추출
                title = item.get('title', '').replace('<b>', '').replace('</b>', '')
                url = item.get('link', '')
                description = item.get('description', '').replace('<b>', '').replace('</b>', '')
                author = item.get('bloggername', '')
                date = item.get('postdate', '')
                
                # 결과 출력
                print(f"\n{i}. 제목: {title}")
                print(f"   URL: {url}")
                print(f"   작성자: {author}")
                print(f"   작성일: {date}")
                print(f"   설명: {description}")
                if selected_keywords:
                    print(f"   추천 키워드: {', '.join(selected_keywords)}")
                else:
                    print(f"   추천 키워드: AI가 분석하여 생성 예정")
                print("-" * 50)

                search_results.append({
                    'title': title,
                    'url': url,
                    'description': description,
                    'author': author,
                    'date': date,
                    'keywords': selected_keywords if selected_keywords else []  # None이면 빈 리스트
                })
                
            except Exception as e:
                print(f"검색 결과 파싱 중 에러 발생: {str(e)}")
                continue
        
        return search_results
        
    except Exception as e:
        print(f"블로그 검색 중 에러 발생: {str(e)}")
        return None

def parse_search_count(count_str):
    """검색 수 문자열을 정수로 변환하는 함수"""
    if isinstance(count_str, int):
        return count_str
    if not count_str or count_str == '< 20':
        return 0
    try:
        # 문자열에서 숫자만 추출
        count_str = ''.join(filter(str.isdigit, str(count_str)))
        return int(count_str) if count_str else 0
    except ValueError:
        return 0

def search_blog_docs(keyword):
    """네이버 검색 API를 사용하여 블로그 문서 수를 검색"""
    encText = urllib.parse.quote(keyword)
    url = "https://openapi.naver.com/v1/search/blog?query=" + encText
    
    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", client_id)
    request.add_header("X-Naver-Client-Secret", client_secret)
    
    try:
        response = urllib.request.urlopen(request)
        rescode = response.getcode()
        
        if rescode == 200:
            response_body = response.read()
            result = json.loads(response_body.decode('utf-8'))
            return result.get('total', 0)
        else:
            return f"Error Code: {rescode}"
            
    except Exception as e:
        return f"Error occurred: {str(e)}"

def get_youtube_transcript(url):
    """YouTube URL에서 스크립트 추출"""
    try:
        # URL에서 video_id 추출
        video_id = None
        if 'youtube.com/watch?v=' in url:
            video_id = url.split('watch?v=')[1].split('&')[0]
        elif 'youtu.be/' in url:
            video_id = url.split('youtu.be/')[1].split('?')[0]
        
        if not video_id:
            print("올바른 YouTube URL이 아닙니다.")
            return None
            
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # 우선 ko 또는 en 자막 시도
            transcript = None
            for lang in ['ko', 'en']:
                try:
                    transcript = transcript_list.find_transcript([lang])
                    break
                except NoTranscriptFound:
                    continue
            
            # 위에서 못 찾았으면 모든 자막 중 하나 선택
            if not transcript:
                try:
                    transcript = next(iter(transcript_list._manually_created_transcripts.values()))
                except StopIteration:
                    transcript = next(iter(transcript_list._generated_transcripts.values()))
            
            # 자막 텍스트만 추출하여 하나의 문자열로 결합
            full_text = ' '.join([entry.text for entry in transcript.fetch()])
            return full_text
            
        except TranscriptsDisabled:
            print("자막이 비활성화된 영상입니다.")
            return None
        except NoTranscriptFound:
            print("자막을 찾을 수 없습니다. 자동 생성 자막이 없는 영상일 수 있습니다.")
            return None
            
    except Exception as e:
        print(f"스크립트 추출 중 에러 발생: {str(e)}")
        return None

def main():
    # 사용자로부터 주제 입력 받기
    topic = input("\n분석할 블로그 주제를 입력하세요: ")
    
    # data 폴더가 없으면 생성
    if not os.path.exists('data'):
        os.makedirs('data')
    
    # 블로그 검색 및 분석
    print("\n네이버 블로그 검색 결과를 분석 중입니다...")
    search_results = crawl_naver_blog_search(topic)
    
    if search_results:
        # 검색 결과 분석
        analysis = analyze_search_results(search_results)
        print("\n분석 결과:")
        print(analysis)
        
        # 키워드 분석
        keyword_analysis = analyze_keywords(search_results)
        
        # 엑셀 파일로 저장
        save_to_excel(search_results, keyword_analysis)
        
        # create_contents_sec.py 실행
        print("\n블로그 콘텐츠 생성 시작...")
        subprocess.run(['python', 'create_contents_sec.py'])
    else:
        print("검색 결과가 없습니다.")

if __name__ == "__main__":
    main() 