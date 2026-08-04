/**
 * POST /api/seo-write/runs/[id]/step
 *
 * 단계 진행 — body의 action 으로 분기:
 *  - action="start"        : API 모드 단계 시작 (initial prompt 송신)
 *  - action="send_message" : API 모드 멀티턴 응답
 *  - action="paste_result" : 복사 모드 — 사용자가 외부 LLM 결과 붙여넣기
 *  - action="advance"      : 현재 단계 완료 처리 + current_step_index +1
 *
 * Body:
 *  { action, step_id, message?, paste? }
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { llmChat, type ChatMessage, type LLMProvider } from "@/lib/llm";
import { findStep, getStepsForPlatform, type Platform } from "@/lib/seo-workflow";
import { buildStepInitialMessage, type RunContext } from "@/lib/seo-workflow-engine";
import { loadUserApiKeys, resolveKeys } from "@/lib/user-api-keys";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface StepActionBody {
  action: "start" | "send_message" | "paste_result" | "advance";
  step_id: number;
  message?: string;
  paste?: string;
}

interface RunRow {
  id: string;
  user_id: string;
  platform: Platform;
  mode: "api" | "copy";
  main_keyword: string;
  llm_provider: LLMProvider | null;
  llm_model: string | null;
  include_optional: boolean;
  selected_title: string | null;
  current_step_index: number;
  status: string;
}

interface StepResultRow {
  id?: string;
  run_id: string;
  step_id: number;
  conversation: ChatMessage[];
  user_pasted_result: string | null;
  final_output: string | null;
  completed_at: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });

  let body: StepActionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }
  if (!body.step_id || typeof body.step_id !== "number")
    return NextResponse.json({ detail: "step_id 필수" }, { status: 400 });

  const { data: runRaw, error: runErr } = await supabase
    .from("seo_workflow_runs")
    .select("*")
    .eq("id", params.id)
    .single();
  if (runErr || !runRaw) return NextResponse.json({ detail: "run 없음" }, { status: 404 });
  const run = runRaw as RunRow;

  const step = findStep(body.step_id);
  if (!step) return NextResponse.json({ detail: "step 정의 없음" }, { status: 400 });

  // 직전 단계 final_output 조회 (needs_prev_output 인 단계용)
  let prevOutput: string | null = null;
  if (step.needs_prev_output) {
    const steps = getStepsForPlatform(run.platform, run.include_optional);
    const idx = steps.findIndex((s) => s.id === step.id);
    if (idx > 0) {
      const prevStep = steps[idx - 1];
      const { data: prev } = await supabase
        .from("seo_workflow_step_results")
        .select("final_output")
        .eq("run_id", run.id)
        .eq("step_id", prevStep.id)
        .maybeSingle();
      prevOutput = (prev as { final_output?: string } | null)?.final_output ?? null;
    }
  }

  const ctx: RunContext = {
    main_keyword: run.main_keyword,
    prev_output: prevOutput,
    selected_title: run.selected_title,
  };

  // 현재 step result 조회 (없으면 신규)
  const { data: existing } = await supabase
    .from("seo_workflow_step_results")
    .select("*")
    .eq("run_id", run.id)
    .eq("step_id", step.id)
    .maybeSingle();
  const stepResult: StepResultRow = (existing as StepResultRow | null) ?? {
    run_id: run.id,
    step_id: step.id,
    conversation: [],
    user_pasted_result: null,
    final_output: null,
    completed_at: null,
  };

  // 액션 분기
  try {
    if (body.action === "start") {
      if (run.mode !== "api")
        return NextResponse.json({ detail: "start 는 API 모드에서만 가능합니다." }, { status: 400 });
      if (stepResult.conversation.length > 0)
        return NextResponse.json({ detail: "이미 시작된 단계입니다." }, { status: 400 });

      const initialMsg = buildStepInitialMessage(step, ctx);
      const messages: ChatMessage[] = [{ role: "user", content: initialMsg }];

      const userKeys = await loadUserApiKeys(supabase, user.id);
      const resolved = resolveKeys(userKeys);
      const provider = run.llm_provider ?? "gemini";
      const apiKey =
        provider === "gemini"
          ? resolved.gemini_api_key
          : provider === "openai"
            ? resolved.openai_api_key
            : resolved.anthropic_api_key;
      const userDefaultModel =
        provider === "gemini"
          ? resolved.gemini_default_model
          : provider === "openai"
            ? resolved.openai_default_model
            : resolved.anthropic_default_model;

      const result = await llmChat(messages, {
        provider,
        model: run.llm_model ?? userDefaultModel,
        apiKey: apiKey ?? null,
        temperature: 0.7,
        maxTokens: 8192,
      });
      messages.push({ role: "assistant", content: result.text });
      stepResult.conversation = messages;
      stepResult.final_output = step.has_user_turn ? null : result.text;
    } else if (body.action === "send_message") {
      if (run.mode !== "api")
        return NextResponse.json({ detail: "send_message 는 API 모드 전용" }, { status: 400 });
      if (!body.message?.trim())
        return NextResponse.json({ detail: "message 필수" }, { status: 400 });
      stepResult.conversation.push({ role: "user", content: body.message.trim() });

      const userKeys = await loadUserApiKeys(supabase, user.id);
      const resolved = resolveKeys(userKeys);
      const provider = run.llm_provider ?? "gemini";
      const apiKey =
        provider === "gemini"
          ? resolved.gemini_api_key
          : provider === "openai"
            ? resolved.openai_api_key
            : resolved.anthropic_api_key;
      const userDefaultModel =
        provider === "gemini"
          ? resolved.gemini_default_model
          : provider === "openai"
            ? resolved.openai_default_model
            : resolved.anthropic_default_model;

      const result = await llmChat(stepResult.conversation, {
        provider,
        model: run.llm_model ?? userDefaultModel,
        apiKey: apiKey ?? null,
        temperature: 0.7,
        maxTokens: 8192,
      });
      stepResult.conversation.push({ role: "assistant", content: result.text });
      // final_output 은 마지막 assistant 메시지로 갱신 (advance 시 확정)
      stepResult.final_output = result.text;
    } else if (body.action === "paste_result") {
      if (run.mode !== "copy")
        return NextResponse.json({ detail: "paste_result 는 복사 모드 전용" }, { status: 400 });
      if (!body.paste?.trim())
        return NextResponse.json({ detail: "paste 필수" }, { status: 400 });
      stepResult.user_pasted_result = body.paste.trim();
      stepResult.final_output = body.paste.trim();
    } else if (body.action === "advance") {
      // 현재 단계 final_output 검증
      // API 모드 + has_user_turn 인 단계는 마지막 assistant 메시지를 final_output 으로 확정
      if (run.mode === "api" && step.has_user_turn) {
        const lastAssistant = [...stepResult.conversation]
          .reverse()
          .find((m) => m.role === "assistant");
        stepResult.final_output = lastAssistant?.content ?? stepResult.final_output;
      }
      if (!stepResult.final_output) {
        return NextResponse.json(
          { detail: "단계 산출물이 비어있어 진행 불가." },
          { status: 400 },
        );
      }
      stepResult.completed_at = new Date().toISOString();

      // current_step_index 증가 (현재 step 의 시퀀스 위치 + 1)
      const steps = getStepsForPlatform(run.platform, run.include_optional);
      const idx = steps.findIndex((s) => s.id === step.id);
      const nextIdx = idx + 1;
      const isLast = nextIdx >= steps.length;

      await supabase
        .from("seo_workflow_runs")
        .update({
          current_step_index: isLast ? idx : nextIdx,
          status: isLast ? "completed" : "in_progress",
        })
        .eq("id", run.id);
    } else {
      return NextResponse.json({ detail: "알 수 없는 action" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: msg }, { status: 502 });
  }

  // step_results upsert
  const upsertRow = {
    run_id: stepResult.run_id,
    step_id: stepResult.step_id,
    conversation: stepResult.conversation,
    user_pasted_result: stepResult.user_pasted_result,
    final_output: stepResult.final_output,
    completed_at: stepResult.completed_at,
  };
  const { error: upErr } = await supabase
    .from("seo_workflow_step_results")
    .upsert(upsertRow, { onConflict: "run_id,step_id" });
  if (upErr) return NextResponse.json({ detail: `저장 실패: ${upErr.message}` }, { status: 500 });

  return NextResponse.json({
    step_id: step.id,
    conversation: stepResult.conversation,
    user_pasted_result: stepResult.user_pasted_result,
    final_output: stepResult.final_output,
    completed: !!stepResult.completed_at,
  });
}
