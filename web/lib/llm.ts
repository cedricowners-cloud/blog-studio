/**
 * 통합 LLM 클라이언트 — Gemini / OpenAI / Anthropic.
 * SDK 없이 raw fetch만 사용 (의존성 최소화).
 *
 * 사용 예: const { text, usage } = await llmGenerate("프롬프트", { provider: "gemini" });
 */

export type LLMProvider = "gemini" | "openai" | "anthropic";

export interface LLMOptions {
  provider: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 사용자별 API 키 (없으면 process.env fallback) */
  apiKey?: string | null;
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface LLMResult {
  text: string;
  usage: LLMUsage;
  /** 실제 호출에 사용된 모델 (DEFAULT_MODELS 폴백 결과 추적용) */
  model: string;
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  // 글 생성은 사실성·구조·길이가 중요하므로 mini/lite 대신 큰 모델을 디폴트로.
  // 환경변수로 override 가능.
  //
  // 2026-11-18 에 각 회사 문서를 보고 바꿨다. 예전 기본값은 곧 꺼진다:
  //   gemini-2.5-pro → 2026-12-01 종료 · claude-sonnet-4-5-20250929 → 2026-11-30 종료 · gpt-4.1 → 2027-01-14 종료
  // 새 기본값:
  //   gemini-4-hydrogen  : 무료 한도가 있다 (gemini-4-carbon / argon 은 유료 키에서만 된다)
  //   gpt-6.2-sol        : OpenAI 가 날마다 쓰는 일에 권하는 모델
  //   claude-sonnet-5-5  : Anthropic 이 sonnet-4-5 의 다음 모델로 안내한 것
  // 모델 이름을 바꿀 때는 app/settings/page.tsx 의 목록과 lib/llm-pricing.ts 의 요금 표도 같이 고친다.
  gemini: process.env.GEMINI_DEFAULT_MODEL || "gemini-4-hydrogen",
  openai: process.env.OPENAI_DEFAULT_MODEL || "gpt-6.2-sol",
  anthropic: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5-5",
};

/** 헬퍼 — 호출 함수에서 항상 동일한 빈 usage 객체 만들 때 */
function emptyUsage(): LLMUsage {
  return { input_tokens: 0, output_tokens: 0 };
}

// LLM 호출 fetch timeout (긴 응답에도 무한 대기 방지)
const LLM_TIMEOUT_MS = 180_000; // 3분

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`LLM 호출 타임아웃 (${LLM_TIMEOUT_MS / 1000}초). 더 작은 모델로 시도하거나 참고 자료를 줄여주세요.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function llmGenerate(prompt: string, opts: LLMOptions): Promise<LLMResult> {
  const { provider } = opts;
  const model = opts.model ?? DEFAULT_MODELS[provider];
  const temperature = opts.temperature ?? 0.5;
  const maxTokens = opts.maxTokens ?? 4096;
  const apiKey = opts.apiKey ?? null;

  const messages: ChatMessage[] = [{ role: "user", content: prompt }];

  switch (provider) {
    case "gemini":
      return requestGemini(messages, model, temperature, maxTokens, apiKey);
    case "openai":
      return requestOpenAI(messages, model, temperature, maxTokens, apiKey);
    case "anthropic":
      return requestAnthropic(messages, model, temperature, maxTokens, apiKey);
    default:
      throw new Error(`알 수 없는 provider: ${provider}`);
  }
}


// ============================================================
// 모델이 받지 않는 값 다루기
// ============================================================
// 새 모델은 예전 모델이 받던 값을 받지 않기도 한다.
//   - GPT-5 이후: max_tokens 대신 max_completion_tokens. GPT-6.2 는 temperature 를 받지 않는다.
//   - Claude 의 최신 모델: temperature 를 보내면 오류가 난다.
// 모델 이름으로 가르면 새 모델이 나올 때마다 고쳐야 한다. 그래서 일단 보내 보고,
// 회사가 "그 값은 못 받는다"고 거절하면(400) 그 값을 빼거나 바꿔서 한 번 더 보낸다.
// 한 번 거절된 값은 기억해 두고 (서버가 살아 있는 동안) 그 모델에는 처음부터 보내지 않는다.

type Body = Record<string, unknown>;

/** `${provider}:${model}:${값 이름}` — 이 모델이 받지 않는다고 알게 된 값 */
const REJECTED = new Set<string>();

function errorDetail(bodyText: string): { param: string; message: string } {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { param?: unknown; message?: unknown } };
    return { param: String(parsed.error?.param ?? ""), message: String(parsed.error?.message ?? bodyText) };
  } catch {
    return { param: "", message: bodyText };
  }
}

/** 오류가 이 값 때문인지. 값 이름이 따옴표로 묶여 나오거나, param 으로 짚어 준 경우다 */
function blames(detail: { param: string; message: string }, name: string): boolean {
  return detail.param === name || detail.message.includes(`'${name}'`) || detail.message.includes(`"${name}"`) || detail.message.includes(`\`${name}\``);
}

/**
 * 요청을 보낸다. 받지 않는 값 때문에 거절되면 adapt 가 본문을 고치고(고쳤으면 true) 다시 보낸다.
 * 많아야 두 번 고친다 (temperature 와 길이 한도 이름).
 */
async function postAdaptive(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: Body,
  adapt: (body: Body, detail: { param: string; message: string }) => boolean,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (res.status === 400 && attempt < 2 && adapt(body, errorDetail(text))) continue;
    throw new Error(`${label} API 에러 ${res.status}: ${text}`);
  }
}

// ============================================================
// 회사별 호출 — 한 번 묻기(llmGenerate)와 대화(llmChat)가 같이 쓴다
// ============================================================

async function requestGemini(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const noTemperature = `gemini:${model}:temperature`;
  const generationConfig: Body = { maxOutputTokens: maxTokens };
  if (!REJECTED.has(noTemperature)) generationConfig.temperature = temperature;

  const data = (await postAdaptive(
    "Gemini",
    // 키는 주소가 아니라 헤더에 싣는다 (주소는 기록에 남기 쉽다).
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      // Gemini는 role="model" 을 사용 (assistant 매핑 필요)
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig,
    },
    (_body, detail) => {
      if ("temperature" in generationConfig && detail.message.toLowerCase().includes("temperature")) {
        delete generationConfig.temperature;
        REJECTED.add(noTemperature);
        return true;
      }
      return false;
    },
  )) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  // 생각하는 과정(thought)은 글에 넣지 않는다.
  const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
  return {
    text,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      // 생각하는 데 쓴 토큰도 받은 양으로 값을 낸다.
      output_tokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
    },
    model,
  };
}

async function requestOpenAI(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const noTemperature = `openai:${model}:temperature`;
  const oldLimitName = `openai:${model}:max_completion_tokens`;
  const body: Body = { model, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  if (!REJECTED.has(noTemperature)) body.temperature = temperature;
  // max_tokens 는 예전 이름이다. 새 모델은 max_completion_tokens 만 받는다 (생각하는 데 쓰는 토큰도 이 안에 든다).
  if (REJECTED.has(oldLimitName)) body.max_tokens = maxTokens;
  else body.max_completion_tokens = maxTokens;

  const data = (await postAdaptive("OpenAI", "https://api.openai.com/v1/chat/completions", { Authorization: `Bearer ${apiKey}` }, body, (b, detail) => {
    if ("temperature" in b && blames(detail, "temperature")) {
      delete b.temperature;
      REJECTED.add(noTemperature);
      return true;
    }
    // 아주 예전 모델은 거꾸로 새 이름을 모른다.
    if ("max_completion_tokens" in b && blames(detail, "max_completion_tokens")) {
      b.max_tokens = b.max_completion_tokens;
      delete b.max_completion_tokens;
      REJECTED.add(oldLimitName);
      return true;
    }
    return false;
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
    model,
  };
}

async function requestAnthropic(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const noTemperature = `anthropic:${model}:temperature`;
  const body: Body = { model, max_tokens: maxTokens, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  if (!REJECTED.has(noTemperature)) body.temperature = temperature;

  const data = (await postAdaptive(
    "Anthropic",
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body,
    (b, detail) => {
      // Anthropic 의 오류 글은 "temperature: ..." 나 "`temperature` is ..." 처럼 값 이름으로 시작한다.
      if ("temperature" in b && detail.message.toLowerCase().includes("temperature")) {
        delete b.temperature;
        REJECTED.add(noTemperature);
        return true;
      }
      return false;
    },
  )) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "",
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
    model,
  };
}

// emptyUsage helper — 향후 호출 함수가 추가될 때 일관된 zero-usage 반환용
export { emptyUsage };

// ============================================================
// 멀티턴 채팅 (SEO 워크플로 — 단계 내 LLM ↔ 사용자 대화)
// ============================================================

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * 메시지 히스토리를 그대로 받아 다음 assistant 응답을 생성.
 * messages 의 마지막은 보통 role="user".
 */
export async function llmChat(messages: ChatMessage[], opts: LLMOptions): Promise<LLMResult> {
  const { provider } = opts;
  const model = opts.model ?? DEFAULT_MODELS[provider];
  const temperature = opts.temperature ?? 0.7;
  const maxTokens = opts.maxTokens ?? 8192;
  const apiKey = opts.apiKey ?? null;

  switch (provider) {
    case "gemini":
      return requestGemini(messages, model, temperature, maxTokens, apiKey);
    case "openai":
      return requestOpenAI(messages, model, temperature, maxTokens, apiKey);
    case "anthropic":
      return requestAnthropic(messages, model, temperature, maxTokens, apiKey);
    default:
      throw new Error(`알 수 없는 provider: ${provider}`);
  }
}
