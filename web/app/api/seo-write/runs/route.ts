/**
 * GET  /api/seo-write/runs       — 사용자 본인의 워크플로 목록 (재개용)
 * POST /api/seo-write/runs       — 새 워크플로 시작
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import type { Mode, Platform } from "@/lib/seo-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  platform: Platform;
  mode: Mode;
  main_keyword: string;
  llm_provider?: "gemini" | "openai" | "anthropic";
  llm_model?: string;
  include_optional?: boolean;
}

const VALID_PLATFORMS: Platform[] = ["naver_blog", "custom_domain"];
const VALID_MODES: Mode[] = ["api", "copy"];

export async function GET() {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });

  const { data, error } = await supabase
    .from("seo_workflow_runs")
    .select("id, main_keyword, platform, mode, current_step_index, status, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ detail: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  if (!VALID_PLATFORMS.includes(body.platform))
    return NextResponse.json({ detail: "platform 은 naver_blog 또는 custom_domain" }, { status: 400 });
  if (!VALID_MODES.includes(body.mode))
    return NextResponse.json({ detail: "mode 는 api 또는 copy" }, { status: 400 });
  if (!body.main_keyword?.trim())
    return NextResponse.json({ detail: "main_keyword 필수" }, { status: 400 });

  const row = {
    user_id: user.id,
    platform: body.platform,
    mode: body.mode,
    main_keyword: body.main_keyword.trim(),
    llm_provider: body.mode === "api" ? body.llm_provider ?? "gemini" : null,
    llm_model: body.mode === "api" ? body.llm_model ?? null : null,
    include_optional: body.include_optional ?? true,
  };

  const { data, error } = await supabase
    .from("seo_workflow_runs")
    .insert(row)
    .select("id")
    .single();
  if (error) return NextResponse.json({ detail: error.message }, { status: 500 });

  return NextResponse.json({ id: (data as { id: string }).id });
}
