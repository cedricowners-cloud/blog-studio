/**
 * 정부지원사업 공고 페이지 본문 스크래퍼.
 *
 * 한국 정부지원사업 사이트는 사이트마다 HTML 구조가 다른데,
 * 공통적으로 본문이 .contents / .view_cont / article 같은 컨테이너에 들어있음.
 * 셀렉터 폴백 체인으로 처리.
 *
 * 한계:
 * - PDF/HWP 첨부가 본체인 공고는 본문 추출 불가 (별도 PDF 파싱 필요 — 추후)
 * - 사이트별 anti-scraping은 회피 안 함
 */
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 10_000;
const BODY_MAX_CHARS = 5000; // 공고는 보통 길어서 블로그보다 더 큰 limit

const CONTENT_SELECTORS = [
  ".board_view",
  ".view_cont",
  ".view_contents",
  ".cont_area",
  ".contents",
  ".bbs_view",
  ".board-view",
  ".post-content",
  "article",
  "main",
  "#content",
  "#contents",
];

function looksLikePdf(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url) || /\.hwp(\?|$)/i.test(url);
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
      },
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface AnnouncementScrapeResult {
  url: string;
  ok: boolean;
  body: string | null;
  reason?: string; // 실패 사유
}

/**
 * 공고 URL 한 개 → 본문 텍스트.
 * 실패 시 reason 채워서 반환 (throw 안 함 — 호출자가 결정).
 */
export async function scrapeAnnouncement(url: string): Promise<AnnouncementScrapeResult> {
  const trimmed = url.trim();
  if (!trimmed) return { url, ok: false, body: null, reason: "URL이 비어있음" };
  if (!/^https?:\/\//i.test(trimmed))
    return { url, ok: false, body: null, reason: "http(s) URL이 아님" };
  if (looksLikePdf(trimmed))
    return {
      url,
      ok: false,
      body: null,
      reason: "PDF/HWP 파일은 현재 지원 안 됨 (본문을 직접 메모에 붙여넣기 권장)",
    };

  let res: Response;
  try {
    res = await fetchWithTimeout(trimmed);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { url, ok: false, body: null, reason: "타임아웃 (10초)" };
    }
    return { url, ok: false, body: null, reason: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) {
    return { url, ok: false, body: null, reason: `HTTP ${res.status}` };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return { url, ok: false, body: null, reason: `HTML 아님 (content-type: ${contentType})` };
  }

  let html: string;
  try {
    html = await res.text();
  } catch (e) {
    return { url, ok: false, body: null, reason: e instanceof Error ? e.message : String(e) };
  }

  const $ = cheerio.load(html);

  // 노이즈 요소 제거
  $("script, style, noscript, nav, header, footer, .gnb, .lnb, .snb, .navi, .top, .bottom, .util, .footer, .header").remove();

  // 셀렉터 폴백 체인
  let text = "";
  for (const sel of CONTENT_SELECTORS) {
    const node = $(sel).first();
    if (node.length > 0) {
      text = node.text().trim();
      if (text.length >= 100) break; // 너무 짧으면 다음 셀렉터로
    }
  }

  // 마지막 폴백 — body 전체
  if (text.length < 100) {
    text = $("body").text().trim();
  }

  // 공백 정리
  text = text.replace(/[\t 　]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  if (text.length < 50) {
    return {
      url,
      ok: false,
      body: null,
      reason: "본문 추출 실패 (사이트 구조 인식 못함). PDF 첨부에 본문이 있을 가능성.",
    };
  }

  if (text.length > BODY_MAX_CHARS) {
    text = text.slice(0, BODY_MAX_CHARS) + "\n\n[...본문이 길어 일부만 포함됨]";
  }

  return { url, ok: true, body: text };
}

/**
 * domain_info 객체에서 공고링크를 찾아 자동 페치.
 * 성공하면 `공고원문` 필드에 본문 추가, 실패하면 `공고원문_에러` 필드에 사유 기록.
 * 원본 객체를 mutate 하지 않고 새 객체 반환.
 */
export async function injectAnnouncementBody(
  domainInfo: Record<string, unknown> | undefined | null,
): Promise<Record<string, unknown> | undefined | null> {
  if (!domainInfo || typeof domainInfo !== "object") return domainInfo;

  // 가능한 키 이름들 (사용자가 다른 표현 쓸 수도 있음)
  const linkKeys = ["공고링크", "공고링크URL", "공고URL", "공고_url", "announcement_url", "url", "링크"];
  let linkValue: string | null = null;
  for (const key of linkKeys) {
    const v = (domainInfo as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) {
      linkValue = v.trim();
      break;
    }
  }
  if (!linkValue) return domainInfo;

  const result = await scrapeAnnouncement(linkValue);
  if (result.ok && result.body) {
    return { ...domainInfo, 공고원문: result.body };
  } else {
    return { ...domainInfo, 공고원문_에러: result.reason ?? "알 수 없는 오류" };
  }
}
