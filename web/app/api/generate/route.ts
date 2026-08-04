/**
 * POST /api/generate
 * Body: GenerateRequest { input: BlogGenerationInput, provider, model? }
 *
 * Ontology v2 글 생성:
 *  1. prompts/00_common_ontology.md + 0N_method.md 로 시스템 프롬프트 빌드
 *  2. LLM 호출 → JSON 파싱 → 공리 검증 → 임계값 미달 시 재시도
 *  3. blog_posts/axiom_stats 저장 (RLS = 현재 사용자 user_id)
 *
 * 인증된 사용자만 호출 가능 (middleware가 차단).
 */
import { NextRequest, NextResponse } from "next/server";
import { run, type RunOptions } from "@/lib/ontology/retry-loop";
import type { BlogGenerationInput } from "@/lib/ontology/prompt-builder";
import { saveGeneration, saveAxiomAttempts } from "@/lib/ontology/db-client";
import { getServerSupabase } from "@/lib/supabase-server";
import { injectAnnouncementBody } from "@/lib/announcement-scraper";
import { loadDomainPack, DomainNotFoundError } from "@/lib/ontology/domain-loader";
import { recommendStrategy } from "@/lib/ontology/strategy-recommender";
import type { LLMProvider } from "@/lib/llm";
import { loadUserApiKeys, resolveKeys } from "@/lib/user-api-keys";

export const runtime = "nodejs";
export const maxDuration = 300; // 글 생성은 길게 걸릴 수 있음 (fluid compute 기준 Hobby 최대치 300s, Pro 800s — 로컬은 무제한)
export const dynamic = "force-dynamic";

const ALLOWED_PROVIDERS: LLMProvider[] = ["gemini", "openai", "anthropic"];

interface GenerateRequestBody {
  input: BlogGenerationInput;
  provider?: LLMProvider;
  model?: string;
  /** Ontology v2 — 도메인 코드 (선택). 지정하면 도메인 패키지 자동 로드 + 주입. */
  domain_code?: string | null;
}

export async function POST(req: NextRequest) {
  // 인증 확인 (RLS user_id 필요)
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: GenerateRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  const inp = body.input;
  if (!inp || typeof inp !== "object") {
    return NextResponse.json({ detail: "input은 필수" }, { status: 400 });
  }

  // 최소 검증
  const errors: string[] = [];
  if (typeof inp.method_id !== "number" || inp.method_id < 1 || inp.method_id > 6)
    errors.push("method_id (1-6) 필요");
  if (!inp.topic?.trim()) errors.push("topic 필요");
  if (!inp.main_keyword?.trim()) errors.push("main_keyword 필요");
  if (!Array.isArray(inp.sub_keywords) || inp.sub_keywords.length === 0)
    errors.push("sub_keywords (배열, 최소 1개) 필요");
  if (errors.length > 0) {
    return NextResponse.json({ detail: errors.join(", ") }, { status: 400 });
  }

  const provider = body.provider ?? "gemini";
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return NextResponse.json(
      { detail: `provider는 ${ALLOWED_PROVIDERS.join("|")} 중 하나여야 합니다.` },
      { status: 400 },
    );
  }

  // 사용자 API 키·기본 모델 우선 사용 (없으면 process.env fallback)
  const userKeys = await loadUserApiKeys(supabase, user.id);
  const resolved = resolveKeys(userKeys);
  const apiKeyForProvider =
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

  const runOpts: RunOptions = {
    provider,
    model: body.model ?? userDefaultModel,
    apiKey: apiKeyForProvider ?? null,
  };

  // 공고링크가 domain_info에 있으면 본문 자동 페치해서 주입 (실패해도 진행)
  if (inp.domain_info) {
    const enriched = await injectAnnouncementBody(inp.domain_info);
    inp.domain_info = enriched ?? inp.domain_info;
  }

  // 도메인 패키지 로드 (선택) — 지정 시 prompt-builder 에 주입
  let domainId: string | null = null;
  let positioningAttribute: string | null = null;
  if (body.domain_code) {
    try {
      const pack = await loadDomainPack(supabase, body.domain_code);
      inp.domain_pack = pack;
      positioningAttribute = pack.positioning.differentiating_benefit;
      // 도메인 ID도 조회해서 저장에 사용
      const { data: domainRow } = await supabase
        .from("domains")
        .select("id")
        .eq("domain_code", body.domain_code)
        .single();
      domainId = (domainRow as { id?: string } | null)?.id ?? null;
    } catch (e) {
      if (e instanceof DomainNotFoundError) {
        return NextResponse.json({ detail: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  // 메인 파이프라인
  let loop;
  try {
    loop = await run(inp, runOpts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("프롬프트 파일을 읽을 수 없습니다")) {
      return NextResponse.json({ detail: msg }, { status: 500 });
    }
    return NextResponse.json({ detail: `생성 실패: ${msg}` }, { status: 502 });
  }

  const parsed = loop.final;
  if (!parsed.body) {
    return NextResponse.json(
      {
        detail: {
          message: "본문 파싱 실패",
          parse_errors: parsed.parse_errors,
          attempts: loop.attempts.length,
        },
      },
      { status: 502 },
    );
  }

  // DB 저장 (실패해도 응답은 정상 반환)
  let postId: string | null = null;
  try {
    postId = await saveGeneration(supabase, {
      userId: user.id,
      inp: {
        method_id: inp.method_id,
        topic: inp.topic,
        main_keyword: inp.main_keyword,
        sub_keywords: inp.sub_keywords,
        target_awareness_level: inp.target_awareness_level,
        persona: inp.persona,
        // Ontology v2 — 도메인·3축·포지셔닝
        domain_id: domainId,
        search_intent: inp.search_intent ?? null,
        jtbd_type: inp.jtbd_type ?? null,
        positioning_attribute: positioningAttribute,
      },
      result: {
        titles: parsed.titles,
        body: parsed.body,
        axiom_check: parsed.axiom_check,
        meta: parsed.meta,
      },
      provider,
      model: loop.model,
      inputTokens: loop.cost.input_tokens,
      outputTokens: loop.cost.output_tokens,
      costUsd: loop.cost.cost_usd,
      durationMs: loop.total_duration_ms,
      finalAttempt: loop.final_attempt_number,
      needsHumanReview: loop.needs_human_review,
    });
    if (postId) {
      await saveAxiomAttempts(supabase, {
        postId,
        methodId: inp.method_id,
        domainId, // 도메인별 공리 통계 가능
        attempts: loop.attempts.map((a) => ({
          attempt: a.attempt,
          axiom_check: a.parsed.axiom_check,
        })),
      });

      // Strategy Recommender 로깅 (사용자 선택 vs 추천 일치 여부)
      // intent/jtbd 둘 다 미지정이면 추천 의미가 약하므로 로깅 안 함
      if (inp.target_awareness_level && (inp.search_intent || inp.jtbd_type)) {
        try {
          const rec = recommendStrategy({
            level: inp.target_awareness_level,
            intent: inp.search_intent ?? null,
            jtbd: inp.jtbd_type ?? null,
          });
          await supabase.from("strategy_recommendations").insert({
            user_id: user.id,
            post_id: postId,
            domain_id: domainId,
            input_l_level: inp.target_awareness_level,
            input_intent: inp.search_intent ?? "(미지정)",
            input_jtbd: inp.jtbd_type ?? "(미지정)",
            recommended_strategy: rec.recommended_method_id,
            user_selected_strategy: inp.method_id,
            recommendation_score: rec.scores,
            reasoning: rec.reasoning,
          });
        } catch (e) {
          console.error("strategy_recommendations 로깅 실패:", e);
        }
      }
    }
  } catch (e) {
    console.error("DB 저장 중 예외:", e);
  }

  return NextResponse.json({
    provider: loop.provider,
    model: loop.model,
    duration_ms: loop.total_duration_ms,
    final_attempt: loop.final_attempt_number,
    needs_human_review: loop.needs_human_review,
    cost: loop.cost,
    parse_ok: parsed.parse_ok,
    parse_errors: parsed.parse_errors,
    mapping: parsed.mapping,
    titles: parsed.titles,
    body: parsed.body,
    axiom_check: parsed.axiom_check,
    suggestions: parsed.suggestions,
    meta: parsed.meta,
    attempts: loop.attempts.map((a) => ({
      attempt: a.attempt,
      parse_ok: a.parsed.parse_ok,
      axiom_total: a.axiom.total,
      axiom_passed: a.axiom.passed,
      axiom_failed: a.axiom.failed,
      duration_ms: a.duration_ms,
    })),
    post_id: postId,
  });
}
