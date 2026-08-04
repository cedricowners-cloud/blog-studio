/**
 * Supabase 에 생성 결과·공리 로그를 저장. 저장 실패는 생성 플로우를 막지 않음.
 * Python db_client.py 1:1 포팅 + user_id 명시적 저장 (RLS 호환).
 *
 * 호출자가 인증된 SupabaseClient를 넘김. 클라이언트의 auth context = user_id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SaveGenerationArgs {
  userId: string;
  inp: {
    method_id: number;
    topic: string;
    main_keyword: string;
    sub_keywords?: string[];
    target_awareness_level?: string;
    persona?: string;
    /** Ontology v2 — 도메인 ID (없으면 NULL) */
    domain_id?: string | null;
    /** Ontology B v2 축2 */
    search_intent?: string | null;
    /** Ontology B v2 축3 */
    jtbd_type?: string | null;
    /** Ontology D — 차별편익 (안전/신속/심층/동반/독창) */
    positioning_attribute?: string | null;
  };
  result: {
    titles?: Array<Record<string, unknown>>;
    body?: string;
    axiom_check?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  };
  provider: string;
  /** 실제 호출에 사용된 모델 이름 */
  model?: string | null;
  /** 모든 재시도 합계 토큰 수 + USD 비용 */
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  durationMs: number;
  finalAttempt: number;
  needsHumanReview: boolean;
}

export async function saveGeneration(
  client: SupabaseClient,
  args: SaveGenerationArgs,
): Promise<string | null> {
  const {
    userId,
    inp,
    result,
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd,
    durationMs,
    finalAttempt,
    needsHumanReview,
  } = args;
  const axiom = (result.axiom_check ?? {}) as Record<string, unknown>;
  const titles = result.titles ?? [];
  const meta = (result.meta ?? {}) as Record<string, unknown>;

  const row = {
    user_id: userId,
    method_id: inp.method_id,
    topic: inp.topic,
    main_keyword: inp.main_keyword,
    sub_keywords: inp.sub_keywords ?? [],
    target_awareness_level: inp.target_awareness_level ?? null,
    persona: inp.persona ?? null,
    title: (titles[0] as { title?: string } | undefined)?.title ?? null,
    body: result.body ?? null,
    body_char_count: (result.body ?? "").length,
    content_type: (meta.content_type as string | undefined) ?? null,
    axiom_total: (axiom.total as number | undefined) ?? null,
    axiom_passed: (axiom.passed as number | undefined) ?? null,
    axiom_failed: (axiom.failed as number | undefined) ?? null,
    axiom_pass_rate: (axiom.pass_rate as string | undefined) ?? null,
    axiom_failed_list: (axiom.failed_rules as unknown[] | undefined) ?? [],
    final_attempt: finalAttempt,
    needs_human_review: needsHumanReview,
    llm_provider: provider,
    llm_model: model ?? null,
    input_tokens: inputTokens ?? null,
    output_tokens: outputTokens ?? null,
    cost_usd: costUsd ?? null,
    generation_duration_ms: durationMs,
    meta,
    // Ontology v2 — 도메인·3축·포지셔닝
    domain_id: inp.domain_id ?? null,
    search_intent: inp.search_intent ?? null,
    jtbd_type: inp.jtbd_type ?? null,
    positioning_attribute: inp.positioning_attribute ?? null,
  };

  const { data, error } = await client.from("blog_posts").insert(row).select("id").single();
  if (error) {
    console.error("blog_posts insert 실패:", error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

export interface SaveAxiomAttemptsArgs {
  postId: string;
  methodId: number;
  domainId?: string | null; // Ontology v2 — 도메인 매핑
  attempts: Array<{
    attempt: number;
    axiom_check: Record<string, unknown>;
  }>;
}

function classifyAxiom(it: { number?: number; rule?: string; category?: string }): string {
  if (it.category === "4c" || it.category === "brand_voice" || it.category === "algorithm") {
    return it.category;
  }
  if (typeof it.number === "number" && it.number >= 11 && it.number <= 14) return "4c";
  if (it.rule && /(BV\d|Brand Voice|브랜드 보이스)/i.test(it.rule)) return "brand_voice";
  return "algorithm";
}

export async function saveAxiomAttempts(
  client: SupabaseClient,
  args: SaveAxiomAttemptsArgs,
): Promise<void> {
  const { postId, methodId, domainId, attempts } = args;
  if (!postId) return;

  const rows: Array<Record<string, unknown>> = [];
  for (const a of attempts) {
    const items = (a.axiom_check?.items as unknown[] | undefined) ?? [];
    for (const itRaw of items) {
      const it = itRaw as {
        number?: number;
        rule?: string;
        passed?: boolean;
        evidence?: string;
        category?: string;
      };
      rows.push({
        post_id: postId,
        method_id: methodId,
        axiom_number: it.number ?? null,
        axiom_rule: it.rule ?? "",
        passed: !!it.passed,
        evidence: it.evidence ?? null,
        attempt_number: a.attempt,
        // Ontology v2 — 카테고리·도메인 분리
        axiom_category: classifyAxiom(it),
        domain_id: domainId ?? null,
      });
    }
  }
  if (rows.length === 0) return;

  const { error } = await client.from("axiom_stats").insert(rows);
  if (error) {
    console.error("axiom_stats insert 실패:", error.message);
  }
}
