/**
 * GET /api/keywords?q=<키워드들>&include_blog_count=true&include_autocomplete=true
 *
 * 다중 키워드 지원: q 를 콤마(,) 로 구분하면 각각을 hint 로 전달.
 *   예: q=세무,절세,종합소득세 → 3개 키워드 모두 조회 + 각자의 연관 키워드 병합
 *   최대 10개까지 (Naver API는 한 번에 5개씩만 받으므로 자동 청크)
 *
 * 1. 검색광고 keywordstool — 각 청크(5개 hint) 호출 → 메트릭 + 연관 키워드
 * 2. (옵션) 자동완성 — 입력 키워드 각각에 대해 (최대 3개까지만, 노이즈 방지)
 * 3. (옵션) 블로그 발행수 → 포화도 계산
 * 4. 키워드별 의도 분류 (질문/비교/거래/정보)
 *
 * 사용자 키 우선, 없으면 process.env fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { searchKeywordVolume, searchBlogTotal, getAutocomplete, type KeywordToolItem } from "@/lib/naver";
import { getServerSupabase } from "@/lib/supabase-server";
import { loadUserApiKeys } from "@/lib/user-api-keys";
import { classifyKeyword, type KeywordIntent } from "@/lib/keyword-classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface KeywordMetric {
  keyword: string;
  monthly_pc_qc: number;
  monthly_mobile_qc: number;
  total_qc: number;
  blog_monthly_count: number | null;
  blog_saturation: number | null;
  shopping_category: string | null;
  monthly_ave_pc_clk: number | null;
  monthly_ave_mobile_clk: number | null;
  monthly_ave_pc_ctr: number | null;
  monthly_ave_mobile_ctr: number | null;
  comp_idx: string | null;
  pl_avg_depth: number | null;
  intent: KeywordIntent;
  /** 자동완성에서만 발견된 키워드 (검색광고 응답엔 없었음) — UI 배지용 */
  from_autocomplete: boolean;
}

interface KeywordLookupResponse {
  query: string;
  /** 입력에서 파싱된 키워드 목록 (콤마 구분) */
  queried_keywords: string[];
  results: KeywordMetric[];
  source: "live" | "cache";
  /** 자동완성으로 추가된 키워드 수 */
  autocomplete_added: number;
}

/** 입력 문자열을 콤마로 split → trim → dedup (case-insensitive) → 최대 10개 */
function parseQueries(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const k = raw.trim();
    if (!k) continue;
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(k);
    if (out.length >= 10) break;
  }
  return out;
}

function asInt(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") {
    const s = v.trim().replace(/^</, "").trim().replace(/,/g, "");
    if (/^\d+$/.test(s)) return parseInt(s, 10);
  }
  return 0;
}

function asFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const rawQ = req.nextUrl.searchParams.get("q")?.trim();
  if (!rawQ) {
    return NextResponse.json({ detail: "q (키워드) 파라미터는 필수입니다." }, { status: 400 });
  }
  const queries = parseQueries(rawQ);
  if (queries.length === 0) {
    return NextResponse.json({ detail: "유효한 키워드가 없습니다." }, { status: 400 });
  }
  const includeBlogCount = req.nextUrl.searchParams.get("include_blog_count") !== "false";
  const includeAutocomplete = req.nextUrl.searchParams.get("include_autocomplete") !== "false";

  // 사용자 Naver 키 로드 (인증 필수 — RLS 통과해야 함)
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userKeys = user ? await loadUserApiKeys(supabase, user.id) : null;

  // 1) 검색광고 keywordstool — Naver API는 한 번에 hint 5개까지 → 청크
  const items: KeywordToolItem[] = [];
  const existing = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < queries.length; i += 5) chunks.push(queries.slice(i, i + 5));

  // 청크 병렬 호출 — 단, 첫 청크 실패 시 전체 실패 처리 (키 잘못된 경우 빠르게 알리려고)
  let firstError: Error | null = null;
  const chunkResults = await Promise.all(
    chunks.map(async (chunk, idx) => {
      try {
        return await searchKeywordVolume(chunk.join(","), userKeys);
      } catch (e) {
        if (idx === 0) firstError = e instanceof Error ? e : new Error(String(e));
        return null;
      }
    }),
  );
  if (firstError) {
    return NextResponse.json({ detail: (firstError as Error).message }, { status: 502 });
  }
  for (const res of chunkResults) {
    for (const it of res?.keywordList ?? []) {
      const kw = it.relKeyword?.trim();
      if (!kw) continue;
      const lower = kw.toLowerCase();
      if (existing.has(lower)) continue;
      existing.add(lower);
      items.push(it);
    }
  }

  if (items.length === 0) {
    return NextResponse.json(
      { detail: "네이버 검색광고 API 응답이 비어있습니다. 키워드 또는 API 키를 확인해주세요." },
      { status: 502 },
    );
  }

  // 2) 자동완성 보충 — 입력 키워드별로 (최대 3개까지만, 노이즈 방지)
  const autocompleteOnly = new Set<string>();
  if (includeAutocomplete) {
    const acQueryTargets = queries.slice(0, 3);
    const acResults = await Promise.all(acQueryTargets.map((kw) => getAutocomplete(kw)));
    const acAll = new Set<string>();
    for (const list of acResults) {
      for (const t of list) acAll.add(t);
    }
    const newTerms = Array.from(acAll).filter((t) => !existing.has(t.toLowerCase())).slice(0, 10);
    if (newTerms.length > 0) {
      const acChunks: string[][] = [];
      for (let i = 0; i < newTerms.length; i += 5) acChunks.push(newTerms.slice(i, i + 5));
      for (const chunk of acChunks) {
        try {
          const r = await searchKeywordVolume(chunk.join(","), userKeys);
          for (const it of r?.keywordList ?? []) {
            const kw = it.relKeyword?.trim();
            if (!kw) continue;
            const lower = kw.toLowerCase();
            if (newTerms.some((t) => t.toLowerCase() === lower) && !existing.has(lower)) {
              items.push(it);
              existing.add(lower);
              autocompleteOnly.add(lower);
            }
          }
        } catch {
          /* 자동완성 보충 실패해도 메인 결과는 반환 */
        }
      }
    }
  }

  // 3) 블로그 발행수 — 키워드별 병렬 호출
  const blogCounts: (number | null)[] = includeBlogCount
    ? await Promise.all(items.map((it) => searchBlogTotal(it.relKeyword.trim(), userKeys)))
    : items.map(() => null);

  const results: KeywordMetric[] = items.map((it, i) => {
    const kw = it.relKeyword.trim();
    const pc = asInt(it.monthlyPcQcCnt);
    const mob = asInt(it.monthlyMobileQcCnt);
    const total = pc + mob;
    const blogCount = blogCounts[i];
    const saturation = blogCount !== null && total > 0 ? Math.round((blogCount / total) * 10000) / 100 : null;

    return {
      keyword: kw,
      monthly_pc_qc: pc,
      monthly_mobile_qc: mob,
      total_qc: total,
      blog_monthly_count: blogCount,
      blog_saturation: saturation,
      shopping_category: null,
      monthly_ave_pc_clk: asFloat(it.monthlyAvePcClkCnt),
      monthly_ave_mobile_clk: asFloat(it.monthlyAveMobileClkCnt),
      monthly_ave_pc_ctr: asFloat(it.monthlyAvePcCtr),
      monthly_ave_mobile_ctr: asFloat(it.monthlyAveMobileCtr),
      comp_idx: it.compIdx ?? null,
      pl_avg_depth: asFloat(it.plAvgDepth),
      intent: classifyKeyword(kw),
      from_autocomplete: autocompleteOnly.has(kw.toLowerCase()),
    };
  });

  results.sort((a, b) => b.total_qc - a.total_qc);

  const response: KeywordLookupResponse = {
    query: rawQ,
    queried_keywords: queries,
    results,
    source: "live",
    autocomplete_added: autocompleteOnly.size,
  };
  return NextResponse.json(response);
}
