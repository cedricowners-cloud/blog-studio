/**
 * GET    /api/seo-write/runs/[id] — run + 모든 step results 조회 (재개용)
 * PATCH  /api/seo-write/runs/[id] — selected_title 업데이트, status 변경
 * DELETE /api/seo-write/runs/[id] — abandon (soft delete)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });

  const { data: run, error: runErr } = await supabase
    .from("seo_workflow_runs")
    .select("*")
    .eq("id", params.id)
    .single();
  if (runErr) return NextResponse.json({ detail: runErr.message }, { status: 404 });

  const { data: steps, error: stepsErr } = await supabase
    .from("seo_workflow_step_results")
    .select("*")
    .eq("run_id", params.id)
    .order("step_id");
  if (stepsErr) return NextResponse.json({ detail: stepsErr.message }, { status: 500 });

  return NextResponse.json({ run, step_results: steps ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });

  let body: {
    selected_title?: string;
    status?: "in_progress" | "completed" | "abandoned";
    current_step_index?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.selected_title !== undefined) patch.selected_title = body.selected_title;
  if (body.status !== undefined) patch.status = body.status;
  if (body.current_step_index !== undefined) patch.current_step_index = body.current_step_index;
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ detail: "변경할 필드가 없습니다." }, { status: 400 });

  const { error } = await supabase
    .from("seo_workflow_runs")
    .update(patch)
    .eq("id", params.id);
  if (error) return NextResponse.json({ detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });

  const { error } = await supabase
    .from("seo_workflow_runs")
    .update({ status: "abandoned" })
    .eq("id", params.id);
  if (error) return NextResponse.json({ detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
