// AI 호출: Gemini, OpenAI(GPT), Anthropic(Claude). 내 키로 브라우저에서 직접 부른다.
// 웹의 web/lib/llm.ts 와 같은 일을 하지만, 확장에 맞게 다르게 만든 곳이 있다.
//   - 키를 인자로만 받는다. 키는 요청 헤더에만 넣고, 주소나 오류 글에 넣지 않는다.
//   - 모델 이름을 코드에 적어 두지 않는다. 쓸 수 있는 모델 목록을 받아 와서 고른다.
//   - 답을 조금씩 받는다 (스트리밍). 글 하나에 몇 분이 걸려도 연결이 끊기지 않고, 진행 상황을 보여 줄 수 있다.
//   - temperature 는 받는 곳에만 보낸다. Claude 에는 보내지 않는다 (최신 모델은 이 값을 보내면 오류가 난다).
//   - 한도 초과나 일시 오류는 잠시 기다렸다가 다시 시도한다.

export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

export const PROVIDERS: LLMProvider[] = ['gemini', 'openai', 'anthropic'];

/** AI에 글과 함께 보내는 사진 */
export interface LLMImage {
  /** 'image/jpeg' 같은 종류 */
  mime: string;
  /** base64 로 바꾼 사진. 앞의 "data:...;base64," 는 뺀 것 */
  data: string;
  /** 사진 바로 앞에 붙이는 이름 ("사진 1"). AI가 글에서 사진을 가리킬 때 쓴다 */
  label?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 이 말에 붙여 보내는 사진. 사진을 먼저, 글을 나중에 보낸다 */
  images?: LLMImage[];
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
}

/** end: 끝까지 씀 · length: 길이 한도에 걸려 잘림 · blocked: AI가 거절함 · other: 그 밖 */
export type StopReason = 'end' | 'length' | 'blocked' | 'other';

export interface LLMResult {
  text: string;
  usage: LLMUsage;
  model: string;
  stopReason: StopReason;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** 한 번에 쓸 수 있는 최대 길이(토큰). 모르면 없다 */
  maxOutput?: number;
}

export type LLMErrorKind = 'auth' | 'rate' | 'overloaded' | 'bad-request' | 'network' | 'timeout' | 'stopped' | 'other';

export class LLMError extends Error {
  kind: LLMErrorKind;
  status: number | null;
  constructor(kind: LLMErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.status = status;
  }
}

export interface LLMOptions {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature?: number;
  /** 사람이 [멈추기]를 눌렀을 때 */
  signal?: AbortSignal;
  /** 답이 올 때마다 지금까지 받은 글자 수를 알려 준다 */
  onProgress?: (chars: number) => void;
  /** 다시 시도하려고 기다릴 때 알려 준다 */
  onRetry?: (waitMs: number, reason: string) => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const NAMES: Record<LLMProvider, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' };
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const RETRY_WAITS_MS = [3000, 8000];
const MAX_RETRY_WAIT_MS = 20000;

const ANTHROPIC_HEADERS = (apiKey: string): Record<string, string> => ({
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  // 브라우저에서 직접 부를 때 필요한 헤더
  'anthropic-dangerous-direct-browser-access': 'true',
  'content-type': 'application/json',
});

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 오류 글에서 키가 보이지 않게 지운다. */
function scrub(text: string, apiKey: string): string {
  const cut = text.length > 400 ? text.slice(0, 400) + '…' : text;
  return apiKey ? cut.split(apiKey).join('***') : cut;
}

interface ApiErrorInfo {
  message: string;
  param: string | null;
}

function readApiError(bodyText: string): ApiErrorInfo {
  try {
    const data = JSON.parse(bodyText) as { error?: { message?: unknown; param?: unknown } | string };
    const err = data.error;
    if (typeof err === 'string') return { message: err, param: null };
    if (err && typeof err === 'object') {
      return {
        message: typeof err.message === 'string' ? err.message : bodyText,
        param: typeof err.param === 'string' ? err.param : null,
      };
    }
  } catch {
    // JSON 이 아니면 받은 글을 그대로 쓴다
  }
  return { message: bodyText, param: null };
}

function errorFromStatus(provider: LLMProvider, status: number, bodyText: string, apiKey: string): LLMError {
  const detail = scrub(readApiError(bodyText).message, apiKey);
  const name = NAMES[provider];
  if (status === 401 || status === 403) {
    return new LLMError('auth', `${name} 키가 맞지 않거나 쓸 권한이 없어요. 설정에서 키를 확인해 주세요. (${status}: ${detail})`, status);
  }
  if (status === 429) {
    return new LLMError('rate', `${name} 사용 한도에 걸렸어요. 잠시 뒤에 다시 해 주세요. 충전이나 결제 등록이 필요할 수도 있어요. (${detail})`, status);
  }
  if (status >= 500) {
    return new LLMError('overloaded', `${name} 서버가 지금 바빠요. 잠시 뒤에 다시 해 주세요. (${status}: ${detail})`, status);
  }
  if (status === 404) {
    return new LLMError('bad-request', `${name}에서 이 모델을 찾지 못했어요. 설정에서 모델을 다시 골라 주세요. (${detail})`, status);
  }
  return new LLMError('bad-request', `${name}가 요청을 받아 주지 않았어요. (${status}: ${detail})`, status);
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** 서버가 보내는 줄(data: ...)을 하나씩 꺼낸다. */
async function* readEventData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (line: string): string | null => {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    return clean.startsWith('data:') ? clean.slice(5).trim() : null;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const data = take(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (data) yield data;
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  const last = take(buffer);
  if (last) yield last;
}

function parseJson(data: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(data) as unknown;
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface Collected {
  text: string;
  usage: LLMUsage;
  stopReason: StopReason;
}

type Collector = (res: Response, apiKey: string, onProgress?: (chars: number) => void) => Promise<Collected>;

const collectAnthropic: Collector = async (res, apiKey, onProgress) => {
  const out: Collected = { text: '', usage: { input_tokens: 0, output_tokens: 0 }, stopReason: 'other' };
  for await (const data of readEventData(res)) {
    const ev = parseJson(data);
    if (!ev) continue;
    if (ev.type === 'message_start') {
      const usage = (ev.message as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage;
      out.usage.input_tokens = usage?.input_tokens ?? 0;
      out.usage.output_tokens = usage?.output_tokens ?? 0;
    } else if (ev.type === 'content_block_delta') {
      const delta = ev.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        out.text += delta.text;
        onProgress?.(out.text.length);
      }
    } else if (ev.type === 'message_delta') {
      const delta = ev.delta as { stop_reason?: string } | undefined;
      const usage = ev.usage as { output_tokens?: number } | undefined;
      if (typeof usage?.output_tokens === 'number') out.usage.output_tokens = usage.output_tokens;
      const reason = delta?.stop_reason;
      if (reason === 'end_turn' || reason === 'stop_sequence') out.stopReason = 'end';
      else if (reason === 'max_tokens') out.stopReason = 'length';
      else if (reason === 'refusal') out.stopReason = 'blocked';
    } else if (ev.type === 'error') {
      const err = ev.error as { type?: string; message?: string } | undefined;
      const kind: LLMErrorKind = err?.type === 'overloaded_error' ? 'overloaded' : err?.type === 'rate_limit_error' ? 'rate' : 'other';
      throw new LLMError(kind, `Claude가 답을 쓰다가 멈췄어요. (${scrub(err?.message ?? '알 수 없는 오류', apiKey)})`);
    }
  }
  return out;
};

const collectOpenAI: Collector = async (res, _apiKey, onProgress) => {
  const out: Collected = { text: '', usage: { input_tokens: 0, output_tokens: 0 }, stopReason: 'other' };
  for await (const data of readEventData(res)) {
    if (data === '[DONE]') break;
    const ev = parseJson(data);
    if (!ev) continue;
    const choice = (ev.choices as Array<{ delta?: { content?: string | null }; finish_reason?: string | null }> | undefined)?.[0];
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
      out.text += choice.delta.content;
      onProgress?.(out.text.length);
    }
    const reason = choice?.finish_reason;
    if (reason === 'stop') out.stopReason = 'end';
    else if (reason === 'length') out.stopReason = 'length';
    else if (reason === 'content_filter') out.stopReason = 'blocked';
    const usage = ev.usage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
    if (usage) {
      out.usage.input_tokens = usage.prompt_tokens ?? 0;
      out.usage.output_tokens = usage.completion_tokens ?? 0;
    }
  }
  return out;
};

const collectGemini: Collector = async (res, _apiKey, onProgress) => {
  const out: Collected = { text: '', usage: { input_tokens: 0, output_tokens: 0 }, stopReason: 'other' };
  for await (const data of readEventData(res)) {
    const ev = parseJson(data);
    if (!ev) continue;
    const candidate = (ev.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }> | undefined)?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === 'string' && !part.thought) out.text += part.text;
    }
    if (candidate?.content?.parts?.length) onProgress?.(out.text.length);
    const reason = candidate?.finishReason;
    if (reason === 'STOP') out.stopReason = 'end';
    else if (reason === 'MAX_TOKENS') out.stopReason = 'length';
    else if (reason === 'SAFETY' || reason === 'RECITATION' || reason === 'PROHIBITED_CONTENT' || reason === 'BLOCKLIST') out.stopReason = 'blocked';
    if ((ev.promptFeedback as { blockReason?: string } | undefined)?.blockReason) out.stopReason = 'blocked';
    const usage = ev.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
    if (usage) {
      out.usage.input_tokens = usage.promptTokenCount ?? 0;
      out.usage.output_tokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
    }
  }
  return out;
};

interface Prepared {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  collect: Collector;
}

// 사진이 붙은 말을 회사마다의 모양으로 바꾼다. 사진마다 이름표(글)를 먼저 놓고, 맨 끝에 글을 놓는다.
// 사진이 없으면 예전과 똑같이 글만 보낸다.

function anthropicContent(m: ChatMessage): unknown {
  if (!m.images?.length) return m.content;
  const parts: unknown[] = [];
  for (const image of m.images) {
    if (image.label) parts.push({ type: 'text', text: image.label });
    parts.push({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } });
  }
  parts.push({ type: 'text', text: m.content });
  return parts;
}

function openaiContent(m: ChatMessage): unknown {
  if (!m.images?.length) return m.content;
  const parts: unknown[] = [];
  for (const image of m.images) {
    if (image.label) parts.push({ type: 'text', text: image.label });
    parts.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } });
  }
  parts.push({ type: 'text', text: m.content });
  return parts;
}

function geminiParts(m: ChatMessage): unknown[] {
  const parts: unknown[] = [];
  for (const image of m.images ?? []) {
    if (image.label) parts.push({ text: image.label });
    parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  }
  parts.push({ text: m.content });
  return parts;
}

function prepare(messages: ChatMessage[], opts: LLMOptions): Prepared {
  const { provider, model, apiKey, maxTokens, temperature } = opts;
  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: ANTHROPIC_HEADERS(apiKey),
      body: { model, max_tokens: maxTokens, stream: true, messages: messages.map((m) => ({ role: m.role, content: anthropicContent(m) })) },
      collect: collectAnthropic,
    };
  }
  if (provider === 'openai') {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: openaiContent(m) })),
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: maxTokens,
    };
    if (temperature !== undefined) body.temperature = temperature;
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      collect: collectOpenAI,
    };
  }
  const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (temperature !== undefined) generationConfig.temperature = temperature;
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: {
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: geminiParts(m) })),
      generationConfig,
    },
    collect: collectGemini,
  };
}

/**
 * 모델이 받지 않는 값을 보냈다는 오류면, 그 값을 빼거나 바꿔서 한 번 더 보낼 수 있게 고친다.
 * 고쳤으면 true.
 */
function adaptBody(provider: LLMProvider, body: Record<string, unknown>, info: ApiErrorInfo): boolean {
  const about = (name: string) => info.param === name || info.message.includes(`'${name}'`) || info.message.includes(`"${name}"`);
  if (provider === 'openai') {
    if ('temperature' in body && about('temperature')) {
      delete body.temperature;
      return true;
    }
    if ('max_completion_tokens' in body && about('max_completion_tokens')) {
      body.max_tokens = body.max_completion_tokens;
      delete body.max_completion_tokens;
      return true;
    }
  }
  if (provider === 'gemini') {
    const config = body.generationConfig as Record<string, unknown> | undefined;
    if (config && 'temperature' in config && info.message.toLowerCase().includes('temperature')) {
      delete config.temperature;
      return true;
    }
  }
  return false;
}

/** 대화 기록을 주면 AI의 다음 답을 받는다. */
export async function llmChat(messages: ChatMessage[], opts: LLMOptions): Promise<LLMResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? defaultSleep;
  const name = NAMES[opts.provider];
  if (!opts.apiKey) throw new LLMError('auth', `${name} 키가 없어요. 설정에서 키를 넣어 주세요.`);
  if (!opts.model) throw new LLMError('bad-request', `${name} 모델을 고르지 않았어요. 설정에서 [확인]을 눌러 모델을 골라 주세요.`);

  const prepared = prepare(messages, opts);
  let adaptations = 0;
  let retries = 0;

  for (;;) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onStop = () => controller.abort();
    opts.signal?.addEventListener('abort', onStop);

    try {
      if (opts.signal?.aborted) throw new LLMError('stopped', '멈췄어요.');
      let res: Response;
      try {
        res = await doFetch(prepared.url, {
          method: 'POST',
          headers: prepared.headers,
          body: JSON.stringify(prepared.body),
          signal: controller.signal,
        });
      } catch (err) {
        if (opts.signal?.aborted) throw new LLMError('stopped', '멈췄어요.');
        if (timedOut) throw new LLMError('timeout', `${name}의 답이 너무 오래 걸려서 멈췄어요. 다시 해 주세요.`);
        throw new LLMError('network', `${name}에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. (${scrub(String(err instanceof Error ? err.message : err), opts.apiKey)})`);
      }

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        if (res.status === 400 && adaptations < 2 && adaptBody(opts.provider, prepared.body, readApiError(bodyText))) {
          adaptations += 1;
          continue;
        }
        const error = errorFromStatus(opts.provider, res.status, bodyText, opts.apiKey);
        const wait = RETRY_WAITS_MS[retries];
        if ((error.kind === 'rate' || error.kind === 'overloaded') && wait !== undefined) {
          const waitMs = Math.min(retryAfterMs(res) ?? wait, MAX_RETRY_WAIT_MS);
          retries += 1;
          opts.onRetry?.(waitMs, error.kind === 'rate' ? '사용 한도' : '서버가 바쁨');
          await sleep(waitMs);
          if (opts.signal?.aborted) throw new LLMError('stopped', '멈췄어요.');
          continue;
        }
        throw error;
      }

      let collected: Collected;
      try {
        collected = await prepared.collect(res, opts.apiKey, opts.onProgress);
      } catch (err) {
        if (err instanceof LLMError) throw err;
        if (opts.signal?.aborted) throw new LLMError('stopped', '멈췄어요.');
        if (timedOut) throw new LLMError('timeout', `${name}의 답이 너무 오래 걸려서 멈췄어요. 다시 해 주세요.`);
        throw new LLMError('network', `${name}의 답을 받다가 연결이 끊겼어요. 다시 해 주세요.`);
      }
      return { text: collected.text, usage: collected.usage, model: opts.model, stopReason: collected.stopReason };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onStop);
    }
  }
}

/** 프롬프트 하나를 보내고 답을 받는다. 사진을 같이 보낼 수 있다. */
export function llmGenerate(prompt: string, opts: LLMOptions, images?: LLMImage[]): Promise<LLMResult> {
  return llmChat([{ role: 'user', content: prompt, ...(images?.length ? { images } : {}) }], opts);
}

// ───────────────────────── 모델 목록 ─────────────────────────

const OPENAI_NOT_CHAT = /audio|realtime|tts|transcribe|whisper|image|embedding|moderation|search|instruct|dall-e|codex|computer-use/i;
const GEMINI_NOT_CHAT = /embedding|image|tts|live|audio|aqa|robotics|computer-use/i;

/**
 * 이 키로 쓸 수 있는 글쓰기 모델 목록을 받아 온다. 키가 맞는지 확인하는 데도 쓴다 (돈이 들지 않는다).
 */
export async function listModels(provider: LLMProvider, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ModelInfo[]> {
  const name = NAMES[provider];
  if (!apiKey) throw new LLMError('auth', `${name} 키를 넣어 주세요.`);

  const request: { url: string; headers: Record<string, string> } =
    provider === 'anthropic'
      ? { url: 'https://api.anthropic.com/v1/models?limit=1000', headers: ANTHROPIC_HEADERS(apiKey) }
      : provider === 'openai'
        ? { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${apiKey}` } }
        : { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': apiKey } };

  let res: Response;
  try {
    res = await fetchImpl(request.url, { method: 'GET', headers: request.headers });
  } catch (err) {
    throw new LLMError('network', `${name}에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. (${scrub(String(err instanceof Error ? err.message : err), apiKey)})`);
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    // Gemini 는 키가 틀리면 400 을 준다
    if (provider === 'gemini' && res.status === 400) {
      throw new LLMError('auth', `Gemini 키가 맞지 않아요. 다시 복사해서 넣어 주세요. (${scrub(readApiError(bodyText).message, apiKey)})`, 400);
    }
    throw errorFromStatus(provider, res.status, bodyText, apiKey);
  }

  const data = (await res.json()) as Record<string, unknown>;

  if (provider === 'anthropic') {
    const rows = (data.data as Array<{ id?: string; display_name?: string; max_tokens?: number }> | undefined) ?? [];
    return rows
      .filter((r) => typeof r.id === 'string')
      .map((r) => ({ id: r.id as string, label: r.display_name || (r.id as string), maxOutput: typeof r.max_tokens === 'number' ? r.max_tokens : undefined }));
  }

  if (provider === 'openai') {
    const rows = (data.data as Array<{ id?: string; created?: number }> | undefined) ?? [];
    return rows
      .filter((r): r is { id: string; created?: number } => typeof r.id === 'string')
      .filter((r) => /^(gpt-|o\d|chatgpt-)/.test(r.id) && !OPENAI_NOT_CHAT.test(r.id))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map((r) => ({ id: r.id, label: r.id }));
  }

  const rows =
    (data.models as Array<{ name?: string; displayName?: string; outputTokenLimit?: number; supportedGenerationMethods?: string[] }> | undefined) ?? [];
  return rows
    .filter((r) => typeof r.name === 'string' && r.name.startsWith('models/gemini'))
    .filter((r) => (r.supportedGenerationMethods ?? []).includes('generateContent') && !GEMINI_NOT_CHAT.test(r.name as string))
    .map((r) => {
      const id = (r.name as string).replace(/^models\//, '');
      return { id, label: r.displayName || id, maxOutput: typeof r.outputTokenLimit === 'number' ? r.outputTokenLimit : undefined };
    });
}

/** 숫자가 큰 판이 먼저 오게 견준다. 예: gemini-2.5-pro 가 gemini-1.5-pro 보다 앞. */
function versionOf(id: string): number[] {
  return (id.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function byVersionDesc(a: ModelInfo, b: ModelInfo): number {
  const va = versionOf(a.id);
  const vb = versionOf(b.id);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (vb[i] ?? 0) - (va[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 목록에서 처음 골라 둘 모델을 정한다. 글쓰기에는 큰 모델이 낫다.
 * 모델 이름을 적어 두지 않고 이름의 모양으로 고른다. 사람이 언제든 바꿀 수 있다.
 */
export function pickDefaultModel(provider: LLMProvider, models: ModelInfo[]): string {
  if (models.length === 0) return '';
  const first = (list: ModelInfo[]) => list[0]?.id;
  if (provider === 'anthropic') {
    // 목록은 새 모델이 앞에 온다
    return first(models.filter((m) => /opus/.test(m.id))) ?? first(models.filter((m) => /sonnet/.test(m.id))) ?? (models[0] as ModelInfo).id;
  }
  if (provider === 'gemini') {
    const stable = models.filter((m) => /^gemini-[\d.]+-pro$/.test(m.id)).sort(byVersionDesc);
    const anyPro = models.filter((m) => /pro/.test(m.id)).sort(byVersionDesc);
    return first(stable) ?? first(anyPro) ?? (models[0] as ModelInfo).id;
  }
  const plain = models.filter((m) => /^gpt-[\d.]+$/.test(m.id)).sort(byVersionDesc);
  return first(plain) ?? (models[0] as ModelInfo).id;
}

/**
 * 한 번에 쓰게 할 최대 길이를 정한다. 모델의 한도를 알면 그 안에서, 모르면 웹에서 쓰던 값을 쓴다.
 */
export function resolveMaxTokens(wanted: number, fallback: number, model: ModelInfo | undefined): number {
  if (model?.maxOutput && model.maxOutput > 0) return Math.min(wanted, model.maxOutput);
  return fallback;
}
