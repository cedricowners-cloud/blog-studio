/**
 * 네이버 블로그 본문 스크래퍼.
 *
 * 네이버 블로그는 데스크톱 페이지가 iframe 구조라 스크래핑이 까다롭습니다.
 * 모바일 URL (m.blog.naver.com)을 사용하면 iframe 없이 직접 본문을 받을 수 있어
 * cheerio로 깔끔하게 파싱 가능. Selenium 없이 동작.
 */
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

const BODY_MAX_CHARS = 1500; // LLM 컨텍스트 절약 — 너무 길면 모델이 정보를 놓침
                              // (10개 × 3000 = 30K자는 작은 모델에 부담)
const FETCH_TIMEOUT_MS = 8000;

function toMobileUrl(url: string): string {
  return url
    .replace(/^https?:\/\/blog\.naver\.com/, "https://m.blog.naver.com")
    .replace(/^https?:\/\/m\.blog\.naver\.com\/PostView\.naver/, "https://m.blog.naver.com/PostView.naver");
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: "https://m.blog.naver.com/",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractContent($: cheerio.CheerioAPI): string {
  // SmartEditor 3 (현재 주류)
  let text = $(".se-main-container").text();
  // 구버전 / 일부 모바일 변형
  if (!text.trim()) text = $("#postViewArea").text();
  if (!text.trim()) text = $("div.post_ct").text();
  if (!text.trim()) text = $("div.__se_component_area").text();
  // 마지막 폴백 — body 전체에서 noisy 요소 제거
  if (!text.trim()) {
    $("script, style, nav, header, footer, .blog_btn_area, .area_link").remove();
    text = $("body").text();
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 네이버 블로그 URL 한 개 → 본문 텍스트 (실패 시 null).
 */
export async function fetchNaverBlogBody(url: string): Promise<string | null> {
  try {
    const mobileUrl = toMobileUrl(url);
    const res = await fetchWithTimeout(mobileUrl);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const text = extractContent($);
    if (!text || text.length < 50) return null; // 너무 짧으면 파싱 실패로 간주
    return text.length > BODY_MAX_CHARS ? text.slice(0, BODY_MAX_CHARS) + "…" : text;
  } catch {
    return null;
  }
}

/**
 * URL 배열 → 본문 배열 (실패는 null). 병렬 페치.
 */
export async function fetchNaverBlogBodies(urls: string[]): Promise<(string | null)[]> {
  const results = await Promise.allSettled(urls.map((u) => fetchNaverBlogBody(u)));
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}
