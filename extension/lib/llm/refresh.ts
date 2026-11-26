// 저장해 둔 모델 목록을 새것으로 바꾼다.
// AI 회사들은 모델을 자주 내놓고, 예전 모델은 몇 달 뒤에 끈다. 목록을 한 번 받아 두고 그대로 쓰면
// 새 모델이 보이지 않고, 꺼진 모델을 골라 둔 채로 글을 만들다가 오류가 난다.
// 그래서 받은 지 일주일이 넘은 목록은 패널을 열 때 새로 받는다. 목록을 받는 데는 돈이 들지 않는다.
import { loadDefaultsVersion, loadKeys, saveDefaultsVersion, saveKey, type SavedKey } from '../store.ts';
import { listModels, pickDefaultModel, PROVIDERS, type LLMProvider, type ModelInfo } from './client.ts';

export const MODEL_LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 목록을 받은 지 오래됐는지 */
export function isStale(saved: SavedKey, now: Date, maxAgeMs = MODEL_LIST_MAX_AGE_MS): boolean {
  const checked = saved.checkedAt ? Date.parse(saved.checkedAt) : NaN;
  return !Number.isFinite(checked) || now.getTime() - checked > maxAgeMs;
}

/**
 * 새로 받은 목록을 저장해 둔 키에 넣는다.
 * 고른 모델이 새 목록에 있으면 그대로 둔다. 없어졌으면 처음 고를 때의 규칙으로 다시 고르고, 바꿨다고 적어 둔다.
 */
export function applyFreshModels(provider: LLMProvider, saved: SavedKey, models: ModelInfo[], now: Date): SavedKey {
  const stillThere = models.some((m) => m.id === saved.model);
  const next: SavedKey = { key: saved.key, model: saved.model, models, checkedAt: now.toISOString() };
  if (stillThere) {
    if (saved.note) next.note = saved.note;
    return next;
  }
  next.model = pickDefaultModel(provider, models);
  if (saved.model) next.note = `전에 고른 ${saved.model} 모델이 목록에서 없어졌어요. ${next.model} 모델로 바꿔 뒀어요. 다른 모델을 쓰려면 아래에서 골라 주세요.`;
  return next;
}

export interface RefreshOptions {
  now?: Date;
  maxAgeMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 받은 지 오래된 모델 목록을 새로 받아 저장한다. 새로 받은 AI 의 이름을 돌려준다.
 * 받지 못하면 (인터넷이 끊겼거나 키가 바뀌었으면) 그 AI 는 그대로 둔다. 여기서는 오류를 알리지 않는다.
 * 글을 만들 때나 설정에서 [확인]을 누를 때 알게 된다.
 */
export async function refreshStaleModels(opts: RefreshOptions = {}): Promise<LLMProvider[]> {
  const now = opts.now ?? new Date();
  const keys = await loadKeys();
  const refreshed: LLMProvider[] = [];
  for (const provider of PROVIDERS) {
    const saved = keys[provider];
    if (!saved?.key || !isStale(saved, now, opts.maxAgeMs)) continue;
    let models: ModelInfo[];
    try {
      models = await listModels(provider, saved.key, opts.fetchImpl);
    } catch {
      continue;
    }
    if (models.length === 0) continue;
    await saveKey(provider, applyFreshModels(provider, saved, models, now));
    refreshed.push(provider);
  }
  return refreshed;
}

// ───────── 추천 모델이 바뀌었을 때, 이미 골라 둔 사람도 옮겨 준다 ─────────

/**
 * 추천 모델 규칙의 판. 규칙(pickDefaultModel)을 바꿔서, 전에 자동으로 골라진 모델을 쓰는 사람도
 * 새 추천으로 옮겨 주고 싶을 때 1 올린다.
 *   1: 2026-11-18. Claude Opus 5.5 / GPT-6.2 Sol / Gemini 4 Hydrogen
 */
export const DEFAULTS_VERSION = 1;

/**
 * 예전 규칙(2026-11-18 이전)이 골랐을 모델.
 * 지금 고른 모델이 "그때 자동으로 골라진 것"인지 알아보는 데만 쓴다. 사람이 일부러 다른 모델을 골랐으면 건드리지 않는다.
 */
export function legacyDefaultModel(provider: LLMProvider, models: ModelInfo[]): string {
  if (models.length === 0) return '';
  const version = (id: string) => (id.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  const newest = (list: ModelInfo[]) =>
    [...list].sort((a, b) => {
      const va = version(a.id);
      const vb = version(b.id);
      for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
        const diff = (vb[i] ?? 0) - (va[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })[0]?.id;
  const first = (models[0] as ModelInfo).id;
  if (provider === 'anthropic') return models.find((m) => /opus/.test(m.id))?.id ?? models.find((m) => /sonnet/.test(m.id))?.id ?? first;
  if (provider === 'gemini') return newest(models.filter((m) => /^gemini-[\d.]+-pro$/.test(m.id))) ?? newest(models.filter((m) => /pro/.test(m.id))) ?? first;
  return newest(models.filter((m) => /^gpt-[\d.]+$/.test(m.id))) ?? first;
}

export interface ModelChange {
  provider: LLMProvider;
  from: string;
  to: string;
}

/**
 * 추천 모델 규칙이 바뀐 뒤 처음 패널을 열 때 한 번 한다.
 *  - 모델 목록을 새로 받는다 (돈이 들지 않는다).
 *  - 고른 모델이 예전 규칙으로 자동으로 골라진 것이면 새 추천 모델로 바꾸고, 바꿨다고 적어 둔다.
 *  - 사람이 일부러 다른 모델을 골라 뒀으면 그대로 둔다. 목록만 새로 받는다.
 * 목록을 받지 못한 AI 가 있으면 다음에 패널을 열 때 다시 한다.
 */
export async function upgradeDefaults(opts: RefreshOptions = {}): Promise<ModelChange[]> {
  if ((await loadDefaultsVersion()) >= DEFAULTS_VERSION) return [];
  const now = opts.now ?? new Date();
  const keys = await loadKeys();
  const changes: ModelChange[] = [];
  let allDone = true;
  for (const provider of PROVIDERS) {
    const saved = keys[provider];
    if (!saved?.key) continue;
    let models: ModelInfo[];
    try {
      models = await listModels(provider, saved.key, opts.fetchImpl);
    } catch {
      allDone = false;
      continue;
    }
    if (models.length === 0) continue;
    const wasAutomatic = saved.model === legacyDefaultModel(provider, saved.models) || !models.some((m) => m.id === saved.model);
    const recommended = pickDefaultModel(provider, models);
    if (wasAutomatic && recommended && recommended !== saved.model) {
      await saveKey(provider, {
        key: saved.key,
        model: recommended,
        models,
        checkedAt: now.toISOString(),
        note: saved.model
          ? `추천 모델이 새로 나와서 ${saved.model} 대신 ${recommended} 모델로 바꿔 뒀어요. 전처럼 쓰려면 아래에서 다시 골라 주세요.`
          : `${recommended} 모델을 골라 뒀어요.`,
      });
      changes.push({ provider, from: saved.model, to: recommended });
    } else {
      await saveKey(provider, applyFreshModels(provider, saved, models, now));
    }
  }
  if (allDone) await saveDefaultsVersion(DEFAULTS_VERSION);
  return changes;
}
