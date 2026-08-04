/**
 * GET /api/keywords/trend?q=<키워드>&months=12
 *
 * Naver DataLab 통합검색 트렌드. 단일 키워드의 월별 비율(0~100) 시계열.
 * 사용자 키 우선, 없으면 process.env fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { searchTrend } from "@/lib/naver";
import { getServerSupabase } from "@/lib/supabase-server";
import { loadUserApiKeys } from "@/lib/user-api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ detail: "q (키워드) 파라미터는 필수입니다." }, { status: 400 });
  }
  const monthsRaw = req.nextUrl.searchParams.get("months");
  const months = monthsRaw ? Math.max(2, Math.min(60, parseInt(monthsRaw, 10) || 12)) : 12;

  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userKeys = user ? await loadUserApiKeys(supabase, user.id) : null;

  try {
    const trend = await searchTrend(q, months, userKeys);
    return NextResponse.json(trend);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: msg }, { status: 502 });
  }
}
