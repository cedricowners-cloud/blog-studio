// AI 호출 코드를 가짜 서버로 시험한다. 진짜 AI는 부르지 않는다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LLMError,
  listModels,
  llmChat,
  llmGenerate,
  pickDefaultModel,
  resolveMaxTokens,
  type LLMOptions,
} from '../lib/llm/client.ts';

const KEY = 'sk-test-SECRET-1234567890';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** 답을 여러 조각으로 잘라 보내는 가짜 응답. 한글이 조각 사이에서 잘려도 되는지 같이 본다. */
function sse(lines: string[], chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(lines.map((l) => l + '\n').join('\n') + '\n');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function fakeFetch(responses: (Response | Error)[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    const next = responses.shift();
    if (!next) throw new Error('가짜 응답이 모자라요');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const opts = (over: Partial<LLMOptions>): LLMOptions => ({
  provider: 'anthropic',
  model: 'model-x',
  apiKey: KEY,
  maxTokens: 1000,
  sleepImpl: async () => {},
  ...over,
});

const anthropicStream = (text: string[], stop = 'end_turn') => [
  'event: message_start',
  `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 120, output_tokens: 1 } } })}`,
  'event: ping',
  'data: {"type":"ping"}',
  `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '생각 중' } })}`,
  ...text.map((t) => `data: ${JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } })}`),
  `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 345 } })}`,
  'data: {"type":"message_stop"}',
];

test('Claude: 요청 모양과 답 읽기', async () => {
  const { fetchImpl, calls } = fakeFetch([sse(anthropicStream(['안녕', '하세요. ', '글입니다.']))]);
  const progress: number[] = [];
  const result = await llmChat(
    [
      { role: 'user', content: '질문' },
      { role: 'assistant', content: '답' },
      { role: 'user', content: '다음 질문' },
    ],
    opts({ provider: 'anthropic', temperature: 0.7, fetchImpl, onProgress: (n) => progress.push(n) }),
  );

  assert.equal(result.text, '안녕하세요. 글입니다.');
  assert.deepEqual(result.usage, { input_tokens: 120, output_tokens: 345 });
  assert.equal(result.stopReason, 'end');
  assert.equal(result.model, 'model-x');
  assert.deepEqual(progress, [2, 7, 12]);

  const call = calls[0] as Call;
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], KEY);
  assert.equal(call.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(call.body.model, 'model-x');
  assert.equal(call.body.max_tokens, 1000);
  assert.equal(call.body.stream, true);
  assert.equal(call.body.messages.length, 3);
  assert.ok(!('temperature' in call.body), 'Claude 에는 temperature 를 보내지 않는다');
});

test('Claude: 길이 한도와 거절을 알아챈다', async () => {
  const a = fakeFetch([sse(anthropicStream(['중간까지'], 'max_tokens'))]);
  assert.equal((await llmGenerate('x', opts({ fetchImpl: a.fetchImpl }))).stopReason, 'length');
  const b = fakeFetch([sse(anthropicStream([], 'refusal'))]);
  assert.equal((await llmGenerate('x', opts({ fetchImpl: b.fetchImpl }))).stopReason, 'blocked');
});

test('Claude: 답을 쓰다가 오류가 오면 알려 준다', async () => {
  const { fetchImpl } = fakeFetch([
    sse([
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '쓰다가' } })}`,
      `data: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}`,
    ]),
  ]);
  await assert.rejects(
    () => llmGenerate('x', opts({ fetchImpl })),
    (err: unknown) => err instanceof LLMError && err.kind === 'overloaded',
  );
});

const openaiStream = (text: string[], finish = 'stop') => [
  ...text.map((t) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })}`),
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}`,
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 60 } })}`,
  'data: [DONE]',
];

test('GPT: 요청 모양과 답 읽기', async () => {
  const { fetchImpl, calls } = fakeFetch([sse(openaiStream(['첫 ', '문장']))]);
  const result = await llmGenerate('프롬프트', opts({ provider: 'openai', temperature: 0.7, maxTokens: 2000, fetchImpl }));

  assert.equal(result.text, '첫 문장');
  assert.deepEqual(result.usage, { input_tokens: 50, output_tokens: 60 });
  assert.equal(result.stopReason, 'end');

  const call = calls[0] as Call;
  assert.equal(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.body.stream, true);
  assert.deepEqual(call.body.stream_options, { include_usage: true });
  assert.equal(call.body.max_completion_tokens, 2000);
  assert.equal(call.body.temperature, 0.7);
  assert.deepEqual(call.body.messages, [{ role: 'user', content: '프롬프트' }]);
});

test('GPT: 모델이 받지 않는 값은 빼고 다시 보낸다', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(400, { error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model.", param: 'temperature' } }),
    json(400, { error: { message: "Unsupported parameter: 'max_completion_tokens' is not supported.", param: 'max_completion_tokens' } }),
    sse(openaiStream(['됐어요'], 'length')),
  ]);
  const result = await llmGenerate('x', opts({ provider: 'openai', temperature: 0.7, fetchImpl }));
  assert.equal(result.text, '됐어요');
  assert.equal(result.stopReason, 'length');
  assert.equal(calls.length, 3);
  assert.ok(!('temperature' in (calls[1] as Call).body));
  assert.ok(!('temperature' in (calls[2] as Call).body));
  assert.equal((calls[2] as Call).body.max_tokens, 1000);
  assert.ok(!('max_completion_tokens' in (calls[2] as Call).body));
});

test('GPT: 고칠 수 없는 400 은 그대로 알려 준다', async () => {
  const { fetchImpl, calls } = fakeFetch([json(400, { error: { message: 'Invalid messages', param: 'messages' } })]);
  await assert.rejects(
    () => llmGenerate('x', opts({ provider: 'openai', fetchImpl })),
    (err: unknown) => err instanceof LLMError && err.kind === 'bad-request' && err.status === 400,
  );
  assert.equal(calls.length, 1);
});

test('Gemini: 요청 모양과 답 읽기 (키는 주소에 넣지 않는다)', async () => {
  const { fetchImpl, calls } = fakeFetch([
    sse([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '생각', thought: true }, { text: '가나' }] } }] })}`,
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text: '다라' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
      })}`,
    ]),
  ]);
  const result = await llmChat(
    [
      { role: 'user', content: '질문' },
      { role: 'assistant', content: '답' },
      { role: 'user', content: '또 질문' },
    ],
    opts({ provider: 'gemini', model: 'gemini-9-pro', temperature: 0.7, fetchImpl }),
  );

  assert.equal(result.text, '가나다라');
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 25 });
  assert.equal(result.stopReason, 'end');

  const call = calls[0] as Call;
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-9-pro:streamGenerateContent?alt=sse');
  assert.ok(!call.url.includes(KEY));
  assert.equal(call.headers['x-goog-api-key'], KEY);
  assert.deepEqual(call.body.contents.map((c: any) => c.role), ['user', 'model', 'user']);
  assert.deepEqual(call.body.generationConfig, { maxOutputTokens: 1000, temperature: 0.7 });
});

test('Gemini: 잘림과 차단을 알아챈다', async () => {
  const a = fakeFetch([sse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '중간' }] }, finishReason: 'MAX_TOKENS' }] })}`])]);
  assert.equal((await llmGenerate('x', opts({ provider: 'gemini', fetchImpl: a.fetchImpl }))).stopReason, 'length');
  const b = fakeFetch([sse([`data: ${JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })}`])]);
  const blocked = await llmGenerate('x', opts({ provider: 'gemini', fetchImpl: b.fetchImpl }));
  assert.equal(blocked.stopReason, 'blocked');
  assert.equal(blocked.text, '');
});

test('한도 초과는 기다렸다가 다시 시도한다', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(429, { error: { message: 'rate limited' } }, { 'retry-after': '2' }),
    json(503, { error: { message: 'busy' } }),
    sse(anthropicStream(['성공'])),
  ]);
  const waits: number[] = [];
  const retries: string[] = [];
  const result = await llmGenerate(
    'x',
    opts({ fetchImpl, sleepImpl: async (ms) => void waits.push(ms), onRetry: (ms, why) => retries.push(`${ms}:${why}`) }),
  );
  assert.equal(result.text, '성공');
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [2000, 8000]);
  assert.equal(retries.length, 2);
});

test('계속 한도 초과면 멈추고 알려 준다', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(429, { error: { message: 'rate limited' } }),
    json(429, { error: { message: 'rate limited' } }),
    json(429, { error: { message: 'rate limited' } }),
  ]);
  await assert.rejects(
    () => llmGenerate('x', opts({ fetchImpl })),
    (err: unknown) => err instanceof LLMError && err.kind === 'rate',
  );
  assert.equal(calls.length, 3);
});

test('키가 틀리면 알려 주고, 오류 글에 키를 넣지 않는다', async () => {
  const { fetchImpl } = fakeFetch([json(401, { error: { message: `invalid x-api-key ${KEY}` } })]);
  await assert.rejects(
    () => llmGenerate('x', opts({ fetchImpl })),
    (err: unknown) => {
      assert.ok(err instanceof LLMError);
      assert.equal(err.kind, 'auth');
      assert.ok(!err.message.includes(KEY), '오류 글에 키가 들어 있으면 안 된다');
      return true;
    },
  );
});

test('연결 실패와 빠진 값', async () => {
  const net = fakeFetch([new TypeError('Failed to fetch')]);
  await assert.rejects(
    () => llmGenerate('x', opts({ fetchImpl: net.fetchImpl })),
    (err: unknown) => err instanceof LLMError && err.kind === 'network',
  );
  await assert.rejects(() => llmGenerate('x', opts({ apiKey: '' })), (err: unknown) => err instanceof LLMError && err.kind === 'auth');
  await assert.rejects(() => llmGenerate('x', opts({ model: '' })), (err: unknown) => err instanceof LLMError && err.kind === 'bad-request');
});

test('[멈추기]를 누르면 바로 멈춘다', async () => {
  const controller = new AbortController();
  const fetchImpl = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
  const pending = llmGenerate('x', opts({ fetchImpl, signal: controller.signal }));
  controller.abort();
  await assert.rejects(pending, (err: unknown) => err instanceof LLMError && err.kind === 'stopped');
});

test('모델 목록: Claude', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(200, {
      data: [
        { id: 'claude-new-opus', display_name: 'Claude New Opus', max_tokens: 128000 },
        { id: 'claude-new-sonnet', display_name: 'Claude New Sonnet' },
      ],
    }),
  ]);
  const models = await listModels('anthropic', KEY, fetchImpl);
  assert.deepEqual(models, [
    { id: 'claude-new-opus', label: 'Claude New Opus', maxOutput: 128000 },
    { id: 'claude-new-sonnet', label: 'Claude New Sonnet', maxOutput: undefined },
  ]);
  assert.equal((calls[0] as Call).url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal((calls[0] as Call).headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(pickDefaultModel('anthropic', models), 'claude-new-opus');
});

test('모델 목록: GPT 는 글쓰기 모델만 남기고 새것부터', async () => {
  const { fetchImpl } = fakeFetch([
    json(200, {
      data: [
        { id: 'text-embedding-3-large', created: 50 },
        { id: 'gpt-4.1', created: 10 },
        { id: 'gpt-9', created: 30 },
        { id: 'gpt-9-mini', created: 31 },
        { id: 'gpt-4o-realtime-preview', created: 40 },
        { id: 'whisper-1', created: 5 },
        { id: 'o9', created: 20 },
      ],
    }),
  ]);
  const models = await listModels('openai', KEY, fetchImpl);
  assert.deepEqual(models.map((m) => m.id), ['gpt-9-mini', 'gpt-9', 'o9', 'gpt-4.1']);
  assert.equal(pickDefaultModel('openai', models), 'gpt-9');
});

test('모델 목록: Gemini 는 글쓰기 모델만 남긴다', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(200, {
      models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-pro', displayName: 'Gemini 3.5 Pro', outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-pro-preview-tts', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
      ],
    }),
  ]);
  const models = await listModels('gemini', KEY, fetchImpl);
  assert.deepEqual(models.map((m) => m.id), ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.5-pro']);
  assert.equal(models[0]?.maxOutput, 65536);
  assert.ok(!(calls[0] as Call).url.includes(KEY));
  assert.equal(pickDefaultModel('gemini', models), 'gemini-3.5-pro');
});

test('모델 목록: 키가 틀리면 알려 준다', async () => {
  const a = fakeFetch([json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })]);
  await assert.rejects(() => listModels('gemini', KEY, a.fetchImpl), (err: unknown) => err instanceof LLMError && err.kind === 'auth');
  const b = fakeFetch([json(401, { error: { message: 'Incorrect API key provided' } })]);
  await assert.rejects(() => listModels('openai', KEY, b.fetchImpl), (err: unknown) => err instanceof LLMError && err.kind === 'auth');
  await assert.rejects(() => listModels('anthropic', ''), (err: unknown) => err instanceof LLMError && err.kind === 'auth');
});

test('한 번에 쓸 길이: 모델의 한도를 알면 그 안에서, 모르면 웹에서 쓰던 값', () => {
  assert.equal(resolveMaxTokens(32000, 16000, { id: 'a', label: 'a', maxOutput: 128000 }), 32000);
  assert.equal(resolveMaxTokens(32000, 16000, { id: 'a', label: 'a', maxOutput: 8192 }), 8192);
  assert.equal(resolveMaxTokens(32000, 16000, { id: 'a', label: 'a' }), 16000);
  assert.equal(resolveMaxTokens(32000, 16000, undefined), 16000);
  assert.equal(pickDefaultModel('gemini', []), '');
});
