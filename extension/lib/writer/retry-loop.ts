// 글을 만들고, 통과 조건을 채우지 못하면 정해진 횟수만큼 다시 쓰게 한다.
// 웹의 web/lib/ontology/retry-loop.ts 를 옮긴 것이다. 다른 점은 두 가지다.
//   - AI 호출을 밖에서 받는다 (확장은 내 키로 직접 부른다).
//   - 비용 계산이 없다. 토큰 수만 모은다.
import { fill, glue, type PromptPack } from '../prompts/pack.ts';
import type { LLMResult, LLMUsage } from '../llm/client.ts';
import { validate, type AxiomFailedItem, type AxiomValidation } from './axiom-validator.ts';
import { buildFullPrompt } from './prompt-builder.ts';
import { parse, type ParsedResponse } from './response-parser.ts';
import { DEFAULT_OPTIONS, type BlogGenerationInput } from './types.ts';

export interface AttemptRecord {
  attempt: number;
  parsed: ParsedResponse;
  axiom: AxiomValidation;
  duration_ms: number;
  usage: LLMUsage;
  /** AI가 길이 한도에 걸려 답을 끝내지 못했는지 */
  truncated: boolean;
}

export interface LoopResult {
  final: ParsedResponse;
  final_axiom: AxiomValidation;
  attempts: AttemptRecord[];
  final_attempt_number: number;
  /** 다 시도해도 통과 조건을 채우지 못했는지. 사람이 꼭 읽어 봐야 한다 */
  needs_human_review: boolean;
  total_duration_ms: number;
  model: string;
  usage: LLMUsage;
}

export interface LoopDeps {
  /** 프롬프트를 보내고 답을 받는다. attempt 는 1부터 */
  generate: (prompt: string, attempt: number) => Promise<LLMResult>;
  /** 시도가 하나 끝날 때마다 알려 준다 */
  onAttempt?: (record: AttemptRecord, willRetry: boolean) => void;
  now?: () => number;
}

/** 다시 쓰게 할 때 프롬프트 뒤에 붙이는 글 */
export function buildFeedback(
  pack: PromptPack,
  prevPrompt: string,
  failed: AxiomFailedItem[],
  parsed: ParsedResponse,
  bodyTooShort: boolean,
  minBodyChars: number,
): string {
  const parts: string[] = [glue(pack, 'feedback.head')];

  if (bodyTooShort) {
    parts.push(fill(glue(pack, 'feedback.too_short'), { current: parsed.body.length, min: minBodyChars }));
  }

  if (failed.length > 0) {
    parts.push(glue(pack, 'feedback.failed_head'));
    for (const f of failed) {
      parts.push(fill(glue(pack, 'feedback.failed_item'), { number: String(f.number), rule: f.rule }));
      if (f.evidence) parts.push(fill(glue(pack, 'feedback.failed_evidence'), { evidence: f.evidence }));
    }
    parts.push('');
  }

  parts.push(fill(glue(pack, 'feedback.tail'), { body: parsed.body.slice(0, 4000) }));
  return prevPrompt + parts.join('\n');
}

export async function run(pack: PromptPack, inp: BlogGenerationInput, deps: LoopDeps): Promise<LoopResult> {
  const options = { ...DEFAULT_OPTIONS, ...(inp.generation_options ?? {}) };
  const now = deps.now ?? Date.now;

  let prompt = buildFullPrompt(pack, inp);
  const attempts: AttemptRecord[] = [];
  const usage: LLMUsage = { input_tokens: 0, output_tokens: 0 };
  let totalMs = 0;
  let best: AttemptRecord | null = null;
  let model = '';

  for (let i = 1; i <= options.max_retries + 1; i++) {
    const start = now();
    const result = await deps.generate(prompt, i);
    const duration = now() - start;
    totalMs += duration;
    usage.input_tokens += result.usage.input_tokens;
    usage.output_tokens += result.usage.output_tokens;
    if (!model) model = result.model;

    const parsed = parse(result.text);
    const axiom = validate(parsed.axiom_check, inp.method_id);
    const record: AttemptRecord = {
      attempt: i,
      parsed,
      axiom,
      duration_ms: duration,
      usage: result.usage,
      truncated: result.stopReason === 'length',
    };
    attempts.push(record);

    if (best === null || axiom.pass_rate > best.axiom.pass_rate) best = record;

    const bodyTooShort = parsed.body.length > 0 && parsed.body.length < options.min_body_char_count;
    const passed = axiom.pass_rate >= options.axiom_pass_threshold && axiom.valid_structure && !bodyTooShort;
    const willRetry = !passed && i <= options.max_retries;
    deps.onAttempt?.(record, willRetry);

    if (passed) {
      return {
        final: parsed,
        final_axiom: axiom,
        attempts,
        final_attempt_number: i,
        needs_human_review: false,
        total_duration_ms: totalMs,
        model,
        usage,
      };
    }

    if (willRetry) {
      prompt = buildFeedback(pack, buildFullPrompt(pack, inp), axiom.failed_items, parsed, bodyTooShort, options.min_body_char_count);
    }
  }

  // 통과하지 못했다. 가장 나은 시도를 돌려주고, 사람이 읽어 보게 표시한다.
  const finalRecord = best as AttemptRecord;
  return {
    final: finalRecord.parsed,
    final_axiom: finalRecord.axiom,
    attempts,
    final_attempt_number: finalRecord.attempt,
    needs_human_review: true,
    total_duration_ms: totalMs,
    model,
    usage,
  };
}
