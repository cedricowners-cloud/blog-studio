// 이 컴퓨터의 확장 저장소에 두는 것들: AI 키, 프롬프트 묶음, 내 입력값, 만든 글, SEO 진행 상황, 오늘 쓴 양.
// 서버로 보내는 것은 없다. 로그인이 붙으면(E4) 만든 글과 진행 상황은 서버로 옮긴다.
import { browser } from 'wxt/browser';
import { PROVIDERS, type LLMProvider, type LLMUsage, type ModelInfo } from './llm/client.ts';
import { validatePack, type PromptPack } from './prompts/pack.ts';
import type { SeoRun } from './seo/engine.ts';

export interface SavedKey {
  key: string;
  /** 고른 모델 */
  model: string;
  /** [확인]을 눌렀을 때 받아 온 모델 목록 */
  models: ModelInfo[];
  checkedAt: string | null;
}

export type SavedKeys = Partial<Record<LLMProvider, SavedKey>>;

const KEYS = {
  aiKeys: 'aiKeys',
  lastProvider: 'aiLastProvider',
  pack: 'promptPack',
  usage: 'aiUsage',
  writeForm: 'writeForm',
  writeHistory: 'writeHistory',
  seoRuns: 'seoRuns',
} as const;

async function read<T>(key: string, fallback: T): Promise<T> {
  const got = await browser.storage.local.get(key);
  const value = got[key];
  return value === undefined || value === null ? fallback : (value as T);
}

const write = (key: string, value: unknown) => browser.storage.local.set({ [key]: value });

/** 저장소의 값이 바뀌면 알려 준다. 다른 탭(설정)에서 키를 넣으면 글쓰기 화면이 따라 바뀌게 한다. */
export function onStoreChange(watch: (keyof typeof KEYS)[], listener: () => void): void {
  const names = watch.map((k) => KEYS[k]) as string[];
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => names.includes(k))) listener();
  });
}

// ───────── AI 키 ─────────

export const loadKeys = () => read<SavedKeys>(KEYS.aiKeys, {});

export async function saveKey(provider: LLMProvider, value: SavedKey | null): Promise<void> {
  const keys = await loadKeys();
  if (value) keys[provider] = value;
  else delete keys[provider];
  await write(KEYS.aiKeys, keys);
}

export interface ReadyAi {
  provider: LLMProvider;
  key: string;
  model: string;
  modelInfo: ModelInfo | undefined;
}

/** 키와 모델이 다 정해진 AI 목록 */
export function readyAis(keys: SavedKeys): ReadyAi[] {
  const out: ReadyAi[] = [];
  for (const provider of PROVIDERS) {
    const saved = keys[provider];
    if (saved && saved.key && saved.model) {
      out.push({ provider, key: saved.key, model: saved.model, modelInfo: saved.models.find((m) => m.id === saved.model) });
    }
  }
  return out;
}

export const loadLastProvider = () => read<LLMProvider | null>(KEYS.lastProvider, null);
export const saveLastProvider = (provider: LLMProvider) => write(KEYS.lastProvider, provider);

// ───────── 프롬프트 묶음 ─────────

export async function loadPack(): Promise<PromptPack | null> {
  const raw = await read<unknown>(KEYS.pack, null);
  if (!raw) return null;
  const check = validatePack(raw);
  return check.ok ? check.pack : null;
}

export const savePack = (pack: PromptPack | null) => (pack ? write(KEYS.pack, pack) : browser.storage.local.remove(KEYS.pack));

// ───────── 오늘 쓴 양 ─────────

export interface UsageCount {
  input: number;
  output: number;
  calls: number;
}

type UsageLog = Record<string, Partial<Record<LLMProvider, UsageCount>>>;

export function dayKey(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export async function addUsage(provider: LLMProvider, usage: LLMUsage): Promise<void> {
  const log = await read<UsageLog>(KEYS.usage, {});
  const today = dayKey();
  const day = log[today] ?? {};
  const prev = day[provider] ?? { input: 0, output: 0, calls: 0 };
  day[provider] = { input: prev.input + usage.input_tokens, output: prev.output + usage.output_tokens, calls: prev.calls + 1 };
  log[today] = day;
  // 두 주 지난 기록은 지운다
  const keep = Object.keys(log).sort().slice(-14);
  await write(KEYS.usage, Object.fromEntries(keep.map((k) => [k, log[k]])));
}

export async function loadUsageToday(): Promise<Partial<Record<LLMProvider, UsageCount>>> {
  const log = await read<UsageLog>(KEYS.usage, {});
  return log[dayKey()] ?? {};
}

// ───────── 글쓰기 입력값과 만든 글 ─────────

export const loadWriteForm = () => read<Record<string, string>>(KEYS.writeForm, {});
export const saveWriteForm = (form: Record<string, string>) => write(KEYS.writeForm, form);

export interface WrittenPost {
  id: string;
  created_at: string;
  method_label: string;
  topic: string;
  titles: string[];
  body: string;
  passed: number;
  total: number;
  needs_review: boolean;
  model: string;
}

const HISTORY_LIMIT = 10;

export const loadHistory = () => read<WrittenPost[]>(KEYS.writeHistory, []);

export async function pushHistory(post: WrittenPost): Promise<void> {
  const list = await loadHistory();
  await write(KEYS.writeHistory, [post, ...list.filter((p) => p.id !== post.id)].slice(0, HISTORY_LIMIT));
}

// ───────── SEO 8단계 진행 상황 ─────────

const SEO_RUN_LIMIT = 20;

export async function loadSeoRuns(): Promise<SeoRun[]> {
  const runs = await read<SeoRun[]>(KEYS.seoRuns, []);
  return [...runs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveSeoRun(run: SeoRun): Promise<void> {
  const runs = await loadSeoRuns();
  await write(KEYS.seoRuns, [run, ...runs.filter((r) => r.id !== run.id)].slice(0, SEO_RUN_LIMIT));
}

export async function deleteSeoRun(id: string): Promise<void> {
  const runs = await loadSeoRuns();
  await write(KEYS.seoRuns, runs.filter((r) => r.id !== id));
}
