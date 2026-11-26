// 처음 골라 주는 모델과, 오래된 모델 목록을 새로 받는 것을 시험한다. 진짜 AI 회사는 부르지 않는다.
// 아래 모델 이름은 2026-11-18 에 각 회사의 문서에서 확인한 것이다.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const store: Record<string, unknown> = {};
const asList = (key: string | string[]) => (Array.isArray(key) ? key : [key]);
(globalThis as any).chrome = {
  runtime: { id: 'test' },
  storage: {
    local: {
      get: async (key: string | string[]) => Object.fromEntries(asList(key).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
      set: async (values: Record<string, unknown>) => void Object.assign(store, structuredClone(values)),
      remove: async (key: string | string[]) => {
        for (const k of asList(key)) delete store[k];
      },
    },
    onChanged: { addListener: () => {} },
  },
};

const { listModels, pickDefaultModel } = await import('../lib/llm/client.ts');
const { applyFreshModels, DEFAULTS_VERSION, isStale, legacyDefaultModel, refreshStaleModels, upgradeDefaults, MODEL_LIST_MAX_AGE_MS } = await import('../lib/llm/refresh.ts');

const list = (...ids: string[]) => ids.map((id) => ({ id, label: id }));
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

test('처음 고르는 모델: Claude 는 가장 새 Opus (가장 비싼 Fable 은 고르지 않는다)', () => {
  const now = list('claude-fable-5-2', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-mythos-5-2', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929');
  assert.equal(pickDefaultModel('anthropic', now), 'claude-opus-5-5');
  // 차례가 뒤섞여 와도 판이 높은 것을 고른다
  assert.equal(pickDefaultModel('anthropic', [...now].reverse()), 'claude-opus-5-5');
  assert.equal(pickDefaultModel('anthropic', list('claude-haiku-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5')), 'claude-sonnet-5-5');
  assert.equal(pickDefaultModel('anthropic', list('claude-haiku-5-5')), 'claude-haiku-5-5');
});

test('처음 고르는 모델: GPT 는 가장 새 Sol (가장 비싼 Astra 는 고르지 않는다)', () => {
  const now = list('gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'o3', 'gpt-4.1', 'gpt-4o');
  assert.equal(pickDefaultModel('openai', now), 'gpt-6.2-sol');
  // 줄 이름이 없던 때의 목록에서는 숫자가 가장 큰 것
  assert.equal(pickDefaultModel('openai', list('gpt-5.4-mini', 'gpt-5.5', 'gpt-5.4', 'gpt-4.1')), 'gpt-5.5');
  // 아는 모양이 하나도 없으면 목록의 첫 번째
  assert.equal(pickDefaultModel('openai', list('gpt-6-luna', 'gpt-6.1-terra')), 'gpt-6-luna');
});

test('처음 고르는 모델: Gemini 는 가장 새 판에서 무료 한도가 있는 것', () => {
  const now = list('gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen');
  assert.equal(pickDefaultModel('gemini', now), 'gemini-4-hydrogen');
  // 4 판이 아직 안 보이는 키: 가장 새 Flash. 곧 꺼지는 2.5 Pro 나 미리보기 Pro 를 고르지 않는다
  assert.equal(pickDefaultModel('gemini', now.filter((m) => !m.id.startsWith('gemini-4'))), 'gemini-3.8-flash');
  // 같은 판에 Pro 와 Flash 가 있으면 Pro (예전 이름 규칙)
  assert.equal(pickDefaultModel('gemini', list('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite')), 'gemini-2.5-pro');
  // 미리보기뿐이면 그중에서, lite 뿐이면 그것이라도
  assert.equal(pickDefaultModel('gemini', list('gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite')), 'gemini-3.1-pro-preview');
  assert.equal(pickDefaultModel('gemini', list('gemini-3.1-flash-lite')), 'gemini-3.1-flash-lite');
  assert.equal(pickDefaultModel('gemini', []), '');
});

test('모델 목록 새로 받기: 고른 모델이 남아 있으면 그대로, 없어졌으면 다시 고르고 알려 준다', () => {
  const now = new Date('2026-12-02T00:00:00Z');
  const saved = { key: 'k', model: 'gemini-2.5-pro', models: list('gemini-2.5-pro', 'gemini-2.5-flash'), checkedAt: '2026-11-18T00:00:00.000Z' };

  const kept = applyFreshModels('gemini', saved, list('gemini-2.5-pro', 'gemini-4-hydrogen'), now);
  assert.equal(kept.model, 'gemini-2.5-pro');
  assert.equal(kept.note, undefined);
  assert.equal(kept.checkedAt, now.toISOString());
  assert.equal(kept.models.length, 2);

  // 12월 1일에 2.5 Pro 가 꺼진 뒤
  const moved = applyFreshModels('gemini', saved, list('gemini-3.8-flash', 'gemini-4-carbon', 'gemini-4-hydrogen'), now);
  assert.equal(moved.model, 'gemini-4-hydrogen');
  assert.match(moved.note ?? '', /gemini-2\.5-pro.*없어졌어요.*gemini-4-hydrogen/);
  // 키는 안내 글에 들어가지 않는다
  assert.ok(!(moved.note ?? '').includes(saved.key + ' '));
});

test('모델 목록 새로 받기: 일주일이 지난 목록만 새로 받는다', async () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const old = new Date(now.getTime() - MODEL_LIST_MAX_AGE_MS - 1000).toISOString();
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  assert.equal(isStale({ key: 'k', model: 'm', models: [], checkedAt: old }, now), true);
  assert.equal(isStale({ key: 'k', model: 'm', models: [], checkedAt: fresh }, now), false);
  assert.equal(isStale({ key: 'k', model: 'm', models: [], checkedAt: null }, now), true);

  store.aiKeys = {
    gemini: { key: 'gem-key', model: 'gemini-2.5-pro', models: list('gemini-2.5-pro'), checkedAt: old },
    openai: { key: 'oai-key', model: 'gpt-4.1', models: list('gpt-4.1'), checkedAt: fresh },
    anthropic: { key: 'ant-key', model: 'claude-sonnet-4-5-20250929', models: list('claude-sonnet-4-5-20250929'), checkedAt: old },
  };
  const urls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    if (String(url).includes('generativelanguage')) {
      assert.equal((init?.headers as Record<string, string>)['x-goog-api-key'], 'gem-key');
      return json(200, { models: ['gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-4-carbon'].map((id) => ({ name: `models/${id}`, displayName: id, supportedGenerationMethods: ['generateContent'] })) });
    }
    // Claude 는 받지 못한 것으로 한다 (인터넷이 끊겼거나 키가 바뀜)
    return json(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  }) as typeof fetch;

  const refreshed = await refreshStaleModels({ now, fetchImpl });
  assert.deepEqual(refreshed, ['gemini']);
  // 받은 지 얼마 안 된 GPT 는 묻지 않는다
  assert.ok(urls.every((url) => !url.includes('openai')));
  assert.ok(urls.every((url) => !url.includes('gem-key') && !url.includes('ant-key')), '키는 주소에 넣지 않는다');

  const keys = store.aiKeys as Record<string, { model: string; models: unknown[]; checkedAt: string; note?: string }>;
  assert.equal(keys.gemini!.model, 'gemini-4-hydrogen');
  assert.equal(keys.gemini!.models.length, 3);
  assert.equal(keys.gemini!.checkedAt, now.toISOString());
  assert.match(keys.gemini!.note ?? '', /없어졌어요/);
  // 받지 못한 Claude 와, 묻지 않은 GPT 는 그대로다
  assert.equal(keys.anthropic!.model, 'claude-sonnet-4-5-20250929');
  assert.equal(keys.anthropic!.checkedAt, old);
  assert.equal(keys.openai!.model, 'gpt-4.1');

  // 바로 다시 불러도 방금 받은 것은 다시 묻지 않는다
  urls.length = 0;
  assert.deepEqual(await refreshStaleModels({ now, fetchImpl }), []);
  assert.ok(urls.every((url) => !url.includes('generativelanguage')));
});

test('모델 목록: 글쓰기 모델이 아닌 것과 날짜가 붙은 고정판은 보여 주지 않는다 (2026-11-18 의 실제 목록에서)', async () => {
  const openai = (async () =>
    json(200, {
      data: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-live-1', 'gpt-5.5-pro-2026-04-23', 'gpt-5.5-pro', 'gpt-5.5-2026-04-23', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4-mini-2026-03-17', 'o3', 'o3-2025-04-16', 'gpt-4o-2024-11-20', 'gpt-4o-2024-08-06', 'gpt-4o', 'gpt-9-2027-01-01'].map(
        (id, i) => ({ id, created: 100 - i }),
      ),
    })) as typeof fetch;
  assert.deepEqual((await listModels('openai', 'k', openai)).map((m) => m.id), ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-5.5', 'gpt-5.4-mini', 'o3', 'gpt-4o', 'gpt-9-2027-01-01']);

  const gemini = (async () =>
    json(200, {
      models: ['gemini-pro-latest', 'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools', 'gemini-nano-banana-2.1', 'gemini-3.5-transcribe', 'gemini-3.8-flash', 'gemini-4-carbon', 'gemini-4-hydrogen'].map((id) => ({
        name: `models/${id}`,
        supportedGenerationMethods: ['generateContent'],
      })),
    })) as typeof fetch;
  assert.deepEqual((await listModels('gemini', 'k', gemini)).map((m) => m.id), ['gemini-pro-latest', 'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-4-carbon', 'gemini-4-hydrogen']);
});

// ── 추천 모델이 바뀌었을 때, 이미 골라 둔 사람도 옮겨 준다 ──

const GEMINI_NOW = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-4-argon', 'gemini-4-carbon', 'gemini-4-hydrogen'];
const OPENAI_NOW = ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-4.1', 'o3'];
const CLAUDE_NOW = ['claude-fable-5-2', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-4-5-20250929'];

/** 세 회사의 목록을 돌려주는 가짜. fail 에 적힌 회사는 받지 못한 것으로 한다 */
function vendors(fail: string[] = []): { fetchImpl: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const text = String(url);
    const who = text.includes('generativelanguage') ? 'gemini' : text.includes('openai') ? 'openai' : 'anthropic';
    asked.push(who);
    if (fail.includes(who)) return json(500, { error: { message: 'down' } });
    if (who === 'gemini') return json(200, { models: GEMINI_NOW.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) });
    if (who === 'openai') return json(200, { data: OPENAI_NOW.map((id, i) => ({ id, created: 100 - i })) });
    return json(200, { data: CLAUDE_NOW.map((id) => ({ id, display_name: id, max_tokens: 128000 })) });
  }) as typeof fetch;
  return { fetchImpl, asked };
}

test('예전 규칙이 골랐을 모델을 알아본다', () => {
  assert.equal(legacyDefaultModel('gemini', list('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.1-pro-preview')), 'gemini-2.5-pro');
  assert.equal(legacyDefaultModel('gemini', list('gemini-3-flash-preview', 'gemini-3.1-pro-preview')), 'gemini-3.1-pro-preview');
  assert.equal(legacyDefaultModel('openai', list('gpt-6.2-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-4.1')), 'gpt-5.5');
  assert.equal(legacyDefaultModel('anthropic', list('claude-fable-5-2', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5')), 'claude-opus-5-5');
  assert.equal(legacyDefaultModel('openai', []), '');
});

test('추천 모델로 옮기기: 자동으로 골라졌던 모델만 새 추천으로 바꾸고, 일부러 고른 모델은 그대로 둔다', async () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  store.aiKeys = {
    // 예전 규칙이 자동으로 골라 준 모델 (목록을 받은 지는 얼마 안 됐다)
    gemini: { key: 'gem-key', model: 'gemini-2.5-pro', models: list('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'), checkedAt: fresh },
    openai: { key: 'oai-key', model: 'gpt-5.5', models: list('gpt-5.5', 'gpt-5.4', 'gpt-4.1'), checkedAt: fresh },
    // 사람이 일부러 고른 모델 (예전 규칙이라면 opus 를 골랐을 것이다)
    anthropic: { key: 'ant-key', model: 'claude-haiku-5-5', models: list('claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5-5'), checkedAt: fresh },
  };
  const { fetchImpl, asked } = vendors();
  const changes = await upgradeDefaults({ now, fetchImpl });
  assert.deepEqual(changes, [
    { provider: 'gemini', from: 'gemini-2.5-pro', to: 'gemini-4-hydrogen' },
    { provider: 'openai', from: 'gpt-5.5', to: 'gpt-6.2-sol' },
  ]);
  const keys = store.aiKeys as Record<string, { model: string; models: unknown[]; checkedAt: string; note?: string; key: string }>;
  assert.equal(keys.gemini!.model, 'gemini-4-hydrogen');
  assert.match(keys.gemini!.note ?? '', /gemini-2\.5-pro 대신 gemini-4-hydrogen/);
  assert.equal(keys.gemini!.key, 'gem-key');
  assert.equal(keys.openai!.model, 'gpt-6.2-sol');
  // 일부러 고른 모델은 그대로. 목록만 새것이 된다
  assert.equal(keys.anthropic!.model, 'claude-haiku-5-5');
  assert.equal(keys.anthropic!.note, undefined);
  assert.equal(keys.anthropic!.models.length, CLAUDE_NOW.length);
  assert.equal(store.aiDefaultsVersion, DEFAULTS_VERSION);

  // 한 번만 한다. 그 뒤에 사람이 다시 예전 모델을 골라도 또 바꾸지 않는다
  keys.gemini!.model = 'gemini-2.5-pro';
  asked.length = 0;
  assert.deepEqual(await upgradeDefaults({ now, fetchImpl }), []);
  assert.equal(asked.length, 0);
  assert.equal((store.aiKeys as typeof keys).gemini!.model, 'gemini-2.5-pro');
});

test('추천 모델로 옮기기: 키가 없으면 아무것도 묻지 않고, 받지 못한 회사가 있으면 다음에 다시 한다', async () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const none = vendors();
  assert.deepEqual(await upgradeDefaults({ now, fetchImpl: none.fetchImpl }), []);
  assert.equal(none.asked.length, 0);
  assert.equal(store.aiDefaultsVersion, DEFAULTS_VERSION);

  for (const key of Object.keys(store)) delete store[key];
  store.aiKeys = {
    gemini: { key: 'gem-key', model: 'gemini-2.5-pro', models: list('gemini-2.5-pro'), checkedAt: null },
    openai: { key: 'oai-key', model: 'gpt-5.5', models: list('gpt-5.5', 'gpt-4.1'), checkedAt: null },
  };
  const down = vendors(['gemini']);
  assert.deepEqual(await upgradeDefaults({ now, fetchImpl: down.fetchImpl }), [{ provider: 'openai', from: 'gpt-5.5', to: 'gpt-6.2-sol' }]);
  assert.equal(store.aiDefaultsVersion, undefined, '받지 못한 회사가 있으면 끝났다고 적지 않는다');
  // 다음에 다시 하면 남은 회사만 바뀐다 (이미 바꾼 회사는 그대로)
  const up = vendors();
  assert.deepEqual(await upgradeDefaults({ now, fetchImpl: up.fetchImpl }), [{ provider: 'gemini', from: 'gemini-2.5-pro', to: 'gemini-4-hydrogen' }]);
  assert.equal(store.aiDefaultsVersion, DEFAULTS_VERSION);
});
