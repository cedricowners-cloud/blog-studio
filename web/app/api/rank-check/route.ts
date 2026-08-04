/**
 * POST /api/rank-check
 * Body: { domain: string, keywords: string[], types?: ("blog"|"web")[], top_n?: number }
 *
 * 각 키워드 × 검색타입 조합으로 Naver 검색 호출 → 도메인 순위 확인 → 스냅샷 저장.
 * 사용자 키 우선, 없으면 process.env fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRank, normalizeDomain, type RankResult, type SearchType } from "@/lib/rank-checker";
import { getServerSupabase } from "@/lib/supabase-server";
import { loadUserApiKeys } from "@/lib/user-api-keys";

export const runtime = "nodejs";
export const maxDuration = 120; // 키워드 30개 × 2타입 = 60 호출, 여유 있게
export const dynamic = "force-dynamic";

interface RankCheckRequest {
  domain: string;
  keywords: string[];
  types?: SearchType[];
  top_n?: number;
}

interface RankCheckResponse {
  domain: string;
  top_n: number;
  results: RankResult[];
  /** DB에 저장된 스냅샷 ID 개수 (실패해도 응답은 정상) */
  saved_count: number;
}

const MAX_KEYWORDS = 30;
const VALID_TYPES: SearchType[] = ["blog", "web"];

export async function POST(req: NextRequest) {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: RankCheckRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  const domain = normalizeDomain(body.domain ?? "");
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    return NextResponse.json({ detail: "유효한 도메인이 아닙니다 (예: savetax.kr, toss.im)." }, { status: 400 });
  }

  const keywords = (body.keywords ?? [])
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter(Boolean);
  // 중복 제거 (대소문자 무시)
  const seen = new Set<string>();
  const uniqueKeywords: string[] = [];
  for (const k of keywords) {
    const lower = k.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    uniqueKeywords.push(k);
    if (uniqueKeywords.length >= MAX_KEYWORDS) break;
  }
  if (uniqueKeywords.length === 0) {
    return NextResponse.json({ detail: "키워드를 최소 1개 입력해주세요." }, { status: 400 });
  }

  const types: SearchType[] = (body.types ?? ["blog", "web"]).filter((t) =>
    VALID_TYPES.includes(t),
  );
  if (types.length === 0) {
    return NextResponse.json({ detail: "검색타입은 blog 또는 web 중 하나 이상." }, { status: 400 });
  }

  const topN = Math.max(1, Math.min(100, body.top_n ?? 30));

  const userKeys = await loadUserApiKeys(supabase, user.id);

  // 모든 (키워드 × 타입) 조합 병렬 호출
  // Naver Open API 는 10 req/sec — 20-30개 정도는 burst 가능
  const tasks: Array<Promise<RankResult>> = [];
  for (const kw of uniqueKeywords) {
    for (const t of types) {
      tasks.push(checkRank(kw, domain, t, topN, userKeys));
    }
  }
  const results = await Promise.all(tasks);

  // DB 스냅샷 저장 (실패해도 응답은 정상 반환)
  let savedCount = 0;
  try {
    const rows = results.map((r) => ({
      user_id: user.id,
      target_domain: domain,
      keyword: r.keyword,
      search_type: r.search_type,
      rank: r.rank,
      matched_url: r.matched_url,
      matched_title: r.matched_title,
      total_results: r.total_results,
    }));
    const { error, count } = await supabase
      .from("domain_rank_snapshots")
      .insert(rows, { count: "exact" });
    if (error) {
      console.error("rank snapshots insert 실패:", error.message);
    } else {
      savedCount = count ?? rows.length;
    }
  } catch (e) {
    console.error("rank snapshots 저장 중 예외:", e);
  }

  const response: RankCheckResponse = {
    domain,
    top_n: topN,
    results,
    saved_count: savedCount,
  };
  return NextResponse.json(response);
}
