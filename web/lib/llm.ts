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
  // 글 생성은 사실성·구조·길이가 중요하므로 mini 대신 큰 모델을 디폴트로.
  // 환경변수로 override 가능.
  gemini: process.env.GEMINI_DEFAULT_MODEL || "gemini-2.5-pro",
  openai: process.env.OPENAI_DEFAULT_MODEL || "gpt-4.1",
  anthropic: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-4-5-20250929",
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

  switch (provider) {
    case "gemini":
      return callGemini(prompt, model, temperature, maxTokens, apiKey);
    case "openai":
      return callOpenAI(prompt, model, temperature, maxTokens, apiKey);
    case "anthropic":
      return callAnthropic(prompt, model, temperature, maxTokens, apiKey);
    default:
      throw new Error(`알 수 없는 provider: ${provider}`);
  }
}

async function callGemini(
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const usage: LLMUsage = {
    input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
  return { text, usage, model };
}

async function callOpenAI(
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const usage: LLMUsage = {
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
  };
  return { text, usage, model };
}

async function callAnthropic(
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
  const usage: LLMUsage = {
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
  };
  return { text, usage, model };
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
      return chatGemini(messages, model, temperature, maxTokens, apiKey);
    case "openai":
      return chatOpenAI(messages, model, temperature, maxTokens, apiKey);
    case "anthropic":
      return chatAnthropic(messages, model, temperature, maxTokens, apiKey);
    default:
      throw new Error(`알 수 없는 provider: ${provider}`);
  }
}

async function chatGemini(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  // Gemini는 role="model" 을 사용 (assistant 매핑 필요)
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return {
    text,
    usage: {
      input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
    model,
  };
}

async function chatOpenAI(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
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

async function chatAnthropic(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  userApiKey: string | null,
): Promise<LLMResult> {
  const apiKey = userApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 미설정 (설정 페이지에서 입력하거나 .env.local에 추가)");

  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text:
      data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "",
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
    model,
  };
}
