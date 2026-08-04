/**
 * 도메인 순위 추적 — 주어진 키워드로 Naver 검색했을 때 대상 도메인이 몇 위에 있는지.
 *
 * 한계: Naver Open API 의 blog/webkr 결과는 통합검색 SERP와 100% 일치하진 않음.
 * 그래도 "이 도메인이 이 키워드에서 노출되는가"는 신뢰성 있게 판단 가능.
 */
import { searchBlog, searchWebkr, type UserNaverKeys } from "./naver";

export type SearchType = "blog" | "web";

export interface RankResult {
  keyword: string;
  search_type: SearchType;
  /** 1-based 순위. topN 안에 없으면 null. */
  rank: number | null;
  matched_url: string | null;
  matched_title: string | null;
  /** Naver가 보고한 전체 결과 개수 (경쟁도 가늠용) */
  total_results: number;
  /** API 호출 자체가 실패하면 메시지 (예: 토큰 만료) */
  error?: string;
}

/**
 * 사용자 입력을 정규화. "https://www.savetax.kr/path" → "savetax.kr"
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  // path 제거
  d = d.split("/")[0];
  // 포트 제거
  d = d.split(":")[0];
  return d;
}

/**
 * URL 의 호스트명이 target 과 일치하는지 (서브도메인 포함).
 *  - target = "savetax.kr"
 *  - "https://savetax.kr/x" ✓
 *  - "https://www.savetax.kr/x" ✓
 *  - "https://blog.savetax.kr/x" ✓
 *  - "https://savetaxkr.com/x" ✗
 */
export function urlMatchesDomain(url: string, target: string): boolean {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host === target || host.endsWith("." + target);
  } catch {
    return false;
  }
}

/**
 * 단일 키워드 × 단일 검색타입 순위 조회.
 *  - topN: 1~100 (Naver Open API 제한)
 */
export async function checkRank(
  keyword: string,
  domain: string,
  type: SearchType,
  topN = 30,
  userKeys?: UserNaverKeys | null,
): Promise<RankResult> {
  try {
    const response =
      type === "blog"
        ? await searchBlog(keyword, topN, "sim", userKeys)
        : await searchWebkr(keyword, topN, userKeys);

    const items = response.items;
    for (let i = 0; i < items.length; i++) {
      if (urlMatchesDomain(items[i].link, domain)) {
        return {
          keyword,
          search_type: type,
          rank: i + 1,
          matched_url: items[i].link,
          matched_title: items[i].title,
          total_results: response.total,
        };
      }
    }
    return {
      keyword,
      search_type: type,
      rank: null,
      matched_url: null,
      matched_title: null,
      total_results: response.total,
    };
  } catch (e) {
    return {
      keyword,
      search_type: type,
      rank: null,
      matched_url: null,
      matched_title: null,
      total_results: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
