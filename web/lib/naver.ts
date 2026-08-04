/**
 * 네이버 API 헬퍼 — 검색광고 (HMAC-SHA256 서명) + 블로그/뉴스 검색 + DataLab + 자동완성.
 * 서버 사이드 전용.
 *
 * 인증 방식:
 *  - getXxxCreds() : process.env 폴백 (기존 호출처용)
 *  - resolveXxxCreds(userKeys) : 사용자 키 우선 + env 폴백 (route handler용)
 */
import { createHmac } from "node:crypto";

const SEARCHAD_BASE = "https://api.searchad.naver.com";
const OPENAPI_BASE = "https://openapi.naver.com";
const AUTOCOMPLETE_BASE = "https://ac.search.naver.com/nx/ac";

export interface SearchAdCreds {
  accessLicense: string;
  secretKey: string;
  customerId: string;
}

export interface SearchCreds {
  clientId: string;
  clientSecret: string;
}

export interface UserNaverKeys {
  naver_client_id?: string | null;
  naver_client_secret?: string | null;
  naver_search_access_license_key?: string | null;
  naver_search_secret_key?: string | null;
  naver_search_customer_id?: string | null;
}

function pick(userVal: string | null | undefined, envVal: string | undefined): string | undefined {
  const u = (userVal ?? "").trim();
  if (u) return u;
  const e = (envVal ?? "").trim();
  return e || undefined;
}

export function resolveSearchAdCreds(userKeys?: UserNaverKeys | null): SearchAdCreds {
  const accessLicense = pick(userKeys?.naver_search_access_license_key, process.env.NAVER_SEARCH_ACCESS_LICENSE_KEY);
  const secretKey = pick(userKeys?.naver_search_secret_key, process.env.NAVER_SEARCH_SECRET_KEY);
  const customerId = pick(userKeys?.naver_search_customer_id, process.env.NAVER_SEARCH_CUSTOMER_ID);
  if (!accessLicense || !secretKey || !customerId) {
    throw new Error("네이버 검색광고 API 키 미설정 (설정 페이지에서 입력하거나 .env.local 에 추가).");
  }
  return { accessLicense, secretKey, customerId };
}

export function resolveSearchCreds(userKeys?: UserNaverKeys | null): SearchCreds {
  const clientId = pick(userKeys?.naver_client_id, process.env.NAVER_CLIENT_ID);
  const clientSecret = pick(userKeys?.naver_client_secret, process.env.NAVER_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error("네이버 Open API 키 미설정 (설정 페이지에서 입력하거나 .env.local 에 추가).");
  }
  return { clientId, clientSecret };
}

function getSearchAdCreds(): SearchAdCreds {
  return resolveSearchAdCreds(null);
}

function getSearchCreds(): SearchCreds {
  return resolveSearchCreds(null);
}

function buildSignature(timestamp: string, method: string, resource: string, secret: string): string {
  const message = `${timestamp}.${method}.${resource}`;
  return createHmac("sha256", secret).update(message).digest("base64");
}

export interface KeywordToolItem {
  relKeyword: string;
  monthlyPcQcCnt: number | string;
  monthlyMobileQcCnt: number | string;
  monthlyAvePcClkCnt?: number;
  monthlyAveMobileClkCnt?: number;
  monthlyAvePcCtr?: number;
  monthlyAveMobileCtr?: number;
  compIdx?: string;
  plAvgDepth?: number;
}

interface KeywordToolResponse {
  keywordList: KeywordToolItem[];
}

/**
 * 검색광고 keywordstool API — 한 키워드로 연관 키워드 + 메트릭 조회.
 */
export async function searchKeywordVolume(
  keyword: string,
  userKeys?: UserNaverKeys | null,
): Promise<KeywordToolResponse | null> {
  const { accessLicense, secretKey, customerId } = resolveSearchAdCreds(userKeys);
  const timestamp = Date.now().toString();
  const method = "GET";
  const resource = "/keywordstool";

  const params = new URLSearchParams({
    siteId: "naver",
    hintKeywords: keyword,
    showDetail: "1",
  });
  const url = `${SEARCHAD_BASE}${resource}?${params.toString()}`;
  const signature = buildSignature(timestamp, method, resource, secretKey);

  const res = await fetch(url, {
    method,
    headers: {
      "X-Timestamp": timestamp,
      "X-API-KEY": accessLicense,
      "X-Customer": customerId,
      "X-Signature": signature,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`검색광고 API 에러 ${res.status}: ${body}`);
  }
  return (await res.json()) as KeywordToolResponse;
}

export interface BlogSearchItem {
  title: string;
  link: string;
  description: string;
  bloggername: string;
  bloggerlink: string;
  postdate: string;
}

interface BlogSearchResponse {
  total: number;
  start: number;
  display: number;
  items: BlogSearchItem[];
}

/**
 * 블로그 검색 API — 키워드로 상위 블로그 결과 + 총 발행 수 반환.
 */
export async function searchBlog(
  keyword: string,
  display = 10,
  sort: "sim" | "date" = "sim",
  userKeys?: UserNaverKeys | null,
): Promise<BlogSearchResponse> {
  const { clientId, clientSecret } = resolveSearchCreds(userKeys);
  const params = new URLSearchParams({
    query: keyword,
    display: String(display),
    sort,
  });
  const url = `${OPENAPI_BASE}/v1/search/blog?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`블로그 검색 API 에러 ${res.status}: ${body}`);
  }
  return (await res.json()) as BlogSearchResponse;
}

/**
 * 웹문서 검색 API (/v1/search/webkr) — 블로그 외 일반 웹페이지 (토스, 세이브택스 등 owned media).
 * Naver 통합검색의 "웹사이트" 탭과 유사한 결과.
 */
export interface WebSearchItem {
  title: string;
  link: string;
  description: string;
}

interface WebSearchResponse {
  total: number;
  start: number;
  display: number;
  items: WebSearchItem[];
}

export async function searchWebkr(
  keyword: string,
  display = 30,
  userKeys?: UserNaverKeys | null,
): Promise<WebSearchResponse> {
  const { clientId, clientSecret } = resolveSearchCreds(userKeys);
  const params = new URLSearchParams({
    query: keyword,
    display: String(Math.min(display, 100)),
  });
  const url = `${OPENAPI_BASE}/v1/search/webkr?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`웹검색 API 에러 ${res.status}: ${body}`);
  }
  return (await res.json()) as WebSearchResponse;
}

/**
 * 키워드별 블로그 발행 총 수만 빠르게 조회.
 */
export async function searchBlogTotal(
  keyword: string,
  userKeys?: UserNaverKeys | null,
): Promise<number | null> {
  try {
    const result = await searchBlog(keyword, 1, "sim", userKeys);
    return result.total;
  } catch (e) {
    return null;
  }
}

// ============================================================
// DataLab Trend API — 12개월 검색량 추이 (상대값 0~100)
// ============================================================

export interface TrendPoint {
  period: string; // "2025-04-01" 형식 (timeUnit=month 시 월 첫째날)
  ratio: number;
}

export interface TrendResult {
  keyword: string;
  start_date: string;
  end_date: string;
  time_unit: "date" | "week" | "month";
  data: TrendPoint[];
}

/**
 * DataLab 통합 검색어 트렌드.
 * 단일 키워드의 시계열 비율(0~100) 반환.
 *
 * @param keyword 조회 키워드
 * @param months 몇 개월 (기본 12)
 */
export async function searchTrend(
  keyword: string,
  months = 12,
  userKeys?: UserNaverKeys | null,
): Promise<TrendResult> {
  const { clientId, clientSecret } = resolveSearchCreds(userKeys);

  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - (months - 1));
  start.setDate(1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(start);
  const endDate = fmt(end);

  const body = {
    startDate,
    endDate,
    timeUnit: "month",
    keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
  };

  const res = await fetch(`${OPENAPI_BASE}/v1/datalab/search`, {
    method: "POST",
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`DataLab API 에러 ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as {
    startDate: string;
    endDate: string;
    timeUnit: "date" | "week" | "month";
    results?: Array<{ title: string; keywords: string[]; data: Array<{ period: string; ratio: number }> }>;
  };

  const series = data.results?.[0]?.data ?? [];
  return {
    keyword,
    start_date: data.startDate,
    end_date: data.endDate,
    time_unit: data.timeUnit,
    data: series.map((p) => ({ period: p.period, ratio: p.ratio })),
  };
}

// ============================================================
// 자동완성 (인증 불필요, 공개 endpoint)
// ============================================================

/**
 * 네이버 통합검색 자동완성. 키 불필요.
 * 응답 구조: { items: [[["키워드", ...], ...], ...] } — 첫 그룹이 일반 자동완성.
 */
export async function getAutocomplete(keyword: string): Promise<string[]> {
  const params = new URLSearchParams({
    q: keyword,
    con: "0",
    frm: "nv",
    ans: "2",
    r_format: "json",
    r_enc: "UTF-8",
    r_unicode: "0",
    t_koreng: "1",
    run: "2",
    rev: "4",
    q_enc: "UTF-8",
    st: "100",
  });
  try {
    const res = await fetch(`${AUTOCOMPLETE_BASE}?${params.toString()}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.naver.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<Array<Array<string>>> };
    const out = new Set<string>();
    for (const group of data.items ?? []) {
      for (const item of group) {
        const term = (item?.[0] ?? "").trim();
        if (term && term !== keyword) out.add(term);
      }
    }
    return Array.from(out);
  } catch {
    return [];
  }
}
