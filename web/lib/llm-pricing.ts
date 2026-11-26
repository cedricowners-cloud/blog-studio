/**
 * LLM 모델별 단가표 (USD per 1M tokens).
 *
 * ⚠️ 단가는 자주 바뀝니다. 6개월에 한 번씩 공식 가격표 확인 후 갱신:
 *   - OpenAI:    https://openai.com/api/pricing
 *   - Anthropic: https://www.anthropic.com/pricing#api
 *   - Gemini:    https://ai.google.dev/pricing
 *
 * 입력 토큰(input)과 출력 토큰(output)이 단가가 다른게 일반적.
 * 캐시·배치 등 할인은 무시 (보수적 추정).
 */

export interface ModelPrice {
  /** USD per 1M input tokens */
  input_per_1m: number;
  /** USD per 1M output tokens */
  output_per_1m: number;
}

/**
 * 키: lib/llm.ts DEFAULT_MODELS 와 settings 페이지 select 옵션 value 와 일치해야 함.
 * 매핑되지 않은 모델은 unknown 으로 처리되고 비용은 null 반환.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // 2026-11-18 에 각 회사의 요금 문서를 보고 새 모델을 더했다 (USD, 100만 토큰당, 기본 요금).
  // 예전 모델은 지우지 않는다. 전에 만든 글의 비용을 계산할 때 쓴다.

  // ── OpenAI ─────────────────────────────────────────
  "gpt-6.2-astra": { input_per_1m: 8.0, output_per_1m: 40.0 },
  "gpt-6.2-sol": { input_per_1m: 2.0, output_per_1m: 10.0 },
  "gpt-6.1-terra": { input_per_1m: 1.0, output_per_1m: 5.0 },
  "gpt-6-luna": { input_per_1m: 0.1, output_per_1m: 0.5 },
  // 구버전 (2027-01-14 종료)
  "gpt-4.1": { input_per_1m: 2.0, output_per_1m: 8.0 },
  "gpt-4.1-mini": { input_per_1m: 0.4, output_per_1m: 1.6 },
  "gpt-4o": { input_per_1m: 2.5, output_per_1m: 10.0 },
  "gpt-4o-mini": { input_per_1m: 0.15, output_per_1m: 0.6 },

  // ── Anthropic ──────────────────────────────────────
  "claude-fable-5-2": { input_per_1m: 8.0, output_per_1m: 40.0 },
  "claude-opus-5-5": { input_per_1m: 4.0, output_per_1m: 20.0 },
  "claude-sonnet-5-5": { input_per_1m: 2.0, output_per_1m: 10.0 },
  // haiku-5-5 는 프롬프트가 10만 토큰 이하일 때의 단가 (넘으면 0.5 / 2.5)
  "claude-haiku-5-5": { input_per_1m: 0.1, output_per_1m: 0.5 },
  // 구버전. opus-4-5 는 예전에 15/75 로 적혀 있었는데, 요금 문서의 값은 5/25 다.
  "claude-opus-4-5": { input_per_1m: 5.0, output_per_1m: 25.0 },
  "claude-opus-4-5-20251101": { input_per_1m: 5.0, output_per_1m: 25.0 },
  "claude-sonnet-4-5-20250929": { input_per_1m: 3.0, output_per_1m: 15.0 },
  "claude-haiku-4-5-20251001": { input_per_1m: 1.0, output_per_1m: 5.0 },
  "claude-3-5-sonnet-20241022": { input_per_1m: 3.0, output_per_1m: 15.0 },

  // ── Google Gemini ──────────────────────────────────
  // carbon / argon 은 2026-12-01 부터 4.0 / 20.0 으로 오른다. 그날 이후에는 아래 값을 고친다.
  "gemini-4-carbon": { input_per_1m: 2.0, output_per_1m: 10.0 },
  "gemini-4-argon": { input_per_1m: 2.0, output_per_1m: 10.0 },
  "gemini-4-hydrogen": { input_per_1m: 1.5, output_per_1m: 7.5 },
  // 3.8-flash 는 2027-01-01 부터 1.5 / 7.5 로 오른다.
  "gemini-3.8-flash": { input_per_1m: 0.75, output_per_1m: 3.75 },
  "gemini-3.5-flash-lite": { input_per_1m: 0.3, output_per_1m: 2.5 },
  // 구버전. 2.5-pro 는 200k 이하 컨텍스트 단가 (장문 입력시 더 비쌈)
  "gemini-2.5-pro": { input_per_1m: 1.25, output_per_1m: 10.0 },
  "gemini-2.5-flash": { input_per_1m: 0.3, output_per_1m: 2.5 },
  "gemini-2.5-flash-lite": { input_per_1m: 0.1, output_per_1m: 0.4 },
  "gemini-2.0-flash": { input_per_1m: 0.1, output_per_1m: 0.4 },
};

/** USD → KRW 변환용 고정 환율. 정확한 값이 필요하면 한국은행 API 등으로 갱신. */
export const USD_TO_KRW = 1400;

export interface UsageCost {
  input_tokens: number;
  output_tokens: number;
  /** 단가표에 없는 모델이면 null */
  cost_usd: number | null;
  cost_krw: number | null;
  /** 단가 매핑 여부 (UI 경고용) */
  pricing_known: boolean;
}

/**
 * 토큰 수 + 모델 이름 → 비용 계산.
 * 모델이 단가표에 없으면 cost_usd/krw = null, pricing_known = false.
 */
export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): UsageCost {
  const price = MODEL_PRICING[model];
  if (!price) {
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: null,
      cost_krw: null,
      pricing_known: false,
    };
  }
  const usd =
    (inputTokens / 1_000_000) * price.input_per_1m +
    (outputTokens / 1_000_000) * price.output_per_1m;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: round6(usd),
    cost_krw: Math.round(usd * USD_TO_KRW),
    pricing_known: true,
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function formatUsd(usd: number | null): string {
  if (usd === null) return "?";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatKrw(krw: number | null): string {
  if (krw === null) return "?";
  return `₩${krw.toLocaleString("ko-KR")}`;
}
