/**
 * 공리 검증 실패 시 최대 N회 재시도.
 * Python retry_loop.py 1:1 포팅.
 *
 * 1회차: buildFullPrompt(input)
 * 2~N회차: 실패 공리 번호·규칙을 피드백으로 프롬프트 뒤에 append
 * 임계값 달성 or maxRetries 초과 시 종료. 초과 시 needs_human_review=true.
 */
import { llmGenerate, type LLMProvider, type LLMUsage } from "@/lib/llm";
import { computeCost, type UsageCost } from "@/lib/llm-pricing";
import {
  buildFullPrompt,
  DEFAULT_OPTIONS,
  type BlogGenerationInput,
} from "./prompt-builder";
import { parse, type ParsedResponse } from "./response-parser";
import { validate, type AxiomFailedItem, type AxiomValidation } from "./axiom-validator";

export interface AttemptRecord {
  attempt: number;
  parsed: ParsedResponse;
  axiom: AxiomValidation;
  duration_ms: number;
  usage: LLMUsage;
}

export interface LoopResult {
  final: ParsedResponse;
  final_axiom: AxiomValidation;
  attempts: AttemptRecord[];
  final_attempt_number: number;
  needs_human_review: boolean;
  total_duration_ms: number;
  provider: LLMProvider;
  model: string;
  /** 모든 시도의 토큰 합계 + 비용 */
  cost: UsageCost;
}

function buildFeedback(
  prevPrompt: string,
  failed: AxiomFailedItem[],
  parsed: ParsedResponse,
  bodyTooShort: boolean,
  minBodyChars: number,
): string {
  const lines: string[] = [
    "",
    "═══════════════════════════════════════════════",
    "[재작성 요청] — 직전 응답에 다음 문제가 있습니다",
    "═══════════════════════════════════════════════",
    "",
  ];

  if (bodyTooShort) {
    lines.push(
      `❗ 본문 글자수 부족: 현재 ${parsed.body.length}자, 최소 ${minBodyChars}자 이상 필요.`,
      "  - 섹션을 더 추가하거나 각 섹션에 사례·근거·맥락을 보강해서 길이를 늘리세요.",
      "  - 단, 키워드 무리한 반복으로 채우지 말 것. 의미 있는 정보를 추가.",
      "",
    );
  }

  if (failed.length > 0) {
    lines.push(
      "❗ 다음 공리를 충족하지 못했습니다. 각각에 대해 본문을 **해당 부분만 최소한으로 보강**:",
      "",
    );
    for (const f of failed) {
      lines.push(`- 공리 ${f.number}: ${f.rule}`);
      if (f.evidence) lines.push(`  (이전 근거: ${f.evidence})`);
    }
    lines.push("");
  }

  lines.push(
    "직전 본문:",
    "```",
    parsed.body.slice(0, 4000),
    "```",
    "",
    "요구사항:",
    "- 위 문제를 모두 해결한 전체 JSON 응답을 다시 출력 (줄임표·잘림 금지)",
    "- axiom_check.items 전체를 다시 작성 (누락 없이)",
    "- JSON 스키마 그대로 유지",
  );
  return prevPrompt + lines.join("\n");
}

export interface RunOptions {
  provider: LLMProvider;
  model?: string;
  /** 사용자별 API 키 (없으면 process.env fallback) */
  apiKey?: string | null;
}

export async function run(inp: BlogGenerationInput, opts: RunOptions): Promise<LoopResult> {
  const options = { ...DEFAULT_OPTIONS, ...(inp.generation_options ?? {}) };
  const maxRetries = options.max_retries;
  const passThreshold = options.axiom_pass_threshold;
  const minBodyChars = options.min_body_char_count;

  const provider = opts.provider;
  // 모델 디폴트는 lib/llm.ts 한 곳에서만 결정 — 여기서 중복 fallback 두지 않음
  // (이전 버그: retry-loop의 fallback이 lib/llm.ts의 DEFAULT_MODELS 우회해서 mini가 계속 호출됨)
  let resolvedModel: string | undefined;

  let prompt = await buildFullPrompt(inp);
  const attempts: AttemptRecord[] = [];
  let totalMs = 0;
  let best: AttemptRecord | null = null;
  // 모든 시도의 토큰 누적 (재시도 비용도 포함되어야 정확)
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let actualModel: string | null = null;

  for (let i = 1; i <= maxRetries + 1; i++) {
    const start = Date.now();
    let raw: string;
    let usage: LLMUsage;
    try {
      const result = await llmGenerate(prompt, {
        provider,
        model: opts.model,
        temperature: 0.7,
        maxTokens: 16000,
        apiKey: opts.apiKey,
      });
      raw = result.text;
      usage = result.usage;
      actualModel = result.model;
    } catch (e) {
      throw new Error(`LLM 호출 실패 (시도 ${i}): ${e instanceof Error ? e.message : String(e)}`);
    }
    const duration = Date.now() - start;
    totalMs += duration;
    totalInputTokens += usage.input_tokens;
    totalOutputTokens += usage.output_tokens;

    const parsed = parse(raw);
    // 본문·도메인 패키지를 함께 전달 → 4C 본문 검증 + Brand Voice 검증 활성화
    const axiom = validate(parsed.axiom_check, inp.method_id, parsed.body, inp.domain_pack);
    const record: AttemptRecord = { attempt: i, parsed, axiom, duration_ms: duration, usage };
    attempts.push(record);

    // 모델 정보 기록 (lib/llm.ts에서 실제 사용한 모델 이름 추적)
    if (!resolvedModel) resolvedModel = actualModel ?? opts.model ?? `(default for ${provider})`;

    if (best === null || axiom.pass_rate > best.axiom.pass_rate) {
      best = record;
    }

    const bodyTooShort = parsed.body.length > 0 && parsed.body.length < minBodyChars;

    if (axiom.pass_rate >= passThreshold && axiom.valid_structure && !bodyTooShort) {
      return {
        final: parsed,
        final_axiom: axiom,
        attempts,
        final_attempt_number: i,
        needs_human_review: false,
        total_duration_ms: totalMs,
        provider,
        model: resolvedModel,
        cost: computeCost(actualModel ?? resolvedModel, totalInputTokens, totalOutputTokens),
      };
    }

    // 재시도: 공리 실패 OR 본문 너무 짧음
    if (i <= maxRetries) {
      const basePrompt = await buildFullPrompt(inp);
      prompt = buildFeedback(basePrompt, axiom.failed_items, parsed, bodyTooShort, minBodyChars);
    }
  }

  // 임계값 미달 — 가장 좋은 시도를 반환하되 review 플래그
  const finalRecord = best!;
  const finalModel = resolvedModel ?? actualModel ?? `(default for ${provider})`;
  return {
    final: finalRecord.parsed,
    final_axiom: finalRecord.axiom,
    attempts,
    final_attempt_number: finalRecord.attempt,
    needs_human_review: true,
    total_duration_ms: totalMs,
    provider,
    model: finalModel,
    cost: computeCost(actualModel ?? finalModel, totalInputTokens, totalOutputTokens),
  };
}
