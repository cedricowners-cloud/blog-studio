// 이 컴퓨터의 확장 저장소에 두는 것들: AI 키, 프롬프트 묶음, 내 입력값, 만든 글, SEO 진행 상황, 오늘 쓴 양.
// 서버로 보내는 것은 없다. 로그인이 붙으면(E4) 만든 글과 진행 상황은 서버로 옮긴다.
import { browser } from 'wxt/browser';
import { PROVIDERS, type LLMProvider, type LLMUsage, type ModelInfo } from './llm/client.ts';
import { validatePack, type PromptPack } from './prompts/pack.ts';
import type { SeoRun } from './seo/engine.ts';
import { EMPTY_NAVER_KEYS, normalizeNaverKeys, type BlogHit, type NaverKeys, type NewsHit } from './naver/api.ts';
import { normalizeVoice, type VoiceState } from './voice/library.ts';

export interface SavedKey {
  key: string;
  /** 고른 모델 */
  model: string;
  /** 받아 온 모델 목록. [확인]을 누를 때와, 받은 지 오래됐을 때 새로 받는다 (lib/llm/refresh.ts) */
  models: ModelInfo[];
  checkedAt: string | null;
  /** 고른 모델이 목록에서 없어져 다른 모델로 바꿨을 때 남기는 안내. 사람이 모델을 고르거나 [확인]을 누르면 지운다 */
  note?: string;
}

export type SavedKeys = Partial<Record<LLMProvider, SavedKey>>;

const KEYS = {
  aiKeys: 'aiKeys',
  lastProvider: 'aiLastProvider',
  // 추천 모델 규칙을 어느 판까지 반영했는지 (lib/llm/refresh.ts)
  defaultsVersion: 'aiDefaultsVersion',
  pack: 'promptPack',
  usage: 'aiUsage',
  writeForm: 'writeForm',
  writeHistory: 'writeHistory',
  seoRuns: 'seoRuns',
  seoAuto: 'seoAutoForm',
  voice: 'voice',
  naverKeys: 'naverKeys',
  // 네이버 키를 서버에서 받았는지 직접 넣었는지. lib/server/session.ts 도 이 자리를 쓴다.
  naverSource: 'naverKeysSource',
  research: 'researchBasket',
  // 아래 둘은 lib/server/session.ts 가 다룬다. 바뀌었는지 듣는 데만 쓴다.
  session: 'serverSession',
  packSource: 'promptPackSource',
  loginNote: 'serverLoginNote',
  pendingLogin: 'serverPendingLogin',
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

export const loadDefaultsVersion = () => read<number>(KEYS.defaultsVersion, 0);
export const saveDefaultsVersion = (version: number) => write(KEYS.defaultsVersion, version);

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

/** 저장돼 있는 묶음이 예전 형식이라 못 쓰는 상태인지. 다시 만들어 불러오라고 알려 주는 데 쓴다 */
export async function hasOutdatedPack(): Promise<boolean> {
  const raw = await read<unknown>(KEYS.pack, null);
  return raw !== null && !validatePack(raw).ok;
}

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

// ───────── 한 번에 돌릴 때 적어 둔 값 (다음에 다시 적지 않게) ─────────

export const loadSeoAutoForm = () => read<Record<string, string>>(KEYS.seoAuto, {});
export const saveSeoAutoForm = (form: Record<string, string>) => write(KEYS.seoAuto, form);

// ───────── 내 글과 말투 카드 ─────────

export async function loadVoice(): Promise<VoiceState> {
  return normalizeVoice(await read<unknown>(KEYS.voice, null));
}

export const saveVoice = (state: VoiceState) => write(KEYS.voice, state);

// ───────── 네이버 API 키 (자료 찾기) ─────────

export async function loadNaverKeys(): Promise<NaverKeys> {
  return normalizeNaverKeys(await read<unknown>(KEYS.naverKeys, EMPTY_NAVER_KEYS));
}

/** 설정에서 직접 넣은 키를 저장한다. 서버의 공용 키가 이것을 덮어쓰지 않게 "직접 넣음"으로 적어 둔다 */
export async function saveNaverKeys(keys: NaverKeys): Promise<void> {
  await write(KEYS.naverKeys, normalizeNaverKeys(keys));
  await write(KEYS.naverSource, { from: 'local' });
}

/** 넣어 둔 키를 지운다. 다음에 서버의 공용 키를 다시 받을 수 있게 표시도 지운다 */
export async function clearNaverKeys(): Promise<void> {
  await browser.storage.local.remove([KEYS.naverKeys, KEYS.naverSource]);
}

// ───────── 자료 탭에서 고른 것 ─────────

/** 글쓰기에 가져갈 키워드와 참고 자료 */
export interface ResearchBasket {
  main: string;
  subs: string[];
  blogs: BlogHit[];
  news: NewsHit[];
  /** [글쓰기에 넣기]를 누른 때. 글쓰기 화면이 키워드를 칸에 옮겨 적을지 알아보는 데 쓴다 */
  sent_at: string | null;
}

export const EMPTY_BASKET: ResearchBasket = { main: '', subs: [], blogs: [], news: [], sent_at: null };

/** 한 번에 보내는 참고 자료의 수. 많이 보내면 프롬프트가 길어지고 글이 자료에 끌려간다 */
export const MAX_BASKET_BLOGS = 5;
export const MAX_BASKET_NEWS = 5;
export const MAX_BASKET_SUBS = 8;

export function normalizeBasket(raw: unknown): ResearchBasket {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const rows = (v: unknown) => (Array.isArray(v) ? (v.filter((row) => typeof row === 'object' && row !== null) as Record<string, unknown>[]) : []);
  return {
    main: text(value.main).trim(),
    subs: (Array.isArray(value.subs) ? value.subs : []).map(text).map((sub) => sub.trim()).filter(Boolean).slice(0, MAX_BASKET_SUBS),
    blogs: rows(value.blogs)
      .map((row) => ({ title: text(row.title), link: text(row.link), description: text(row.description), blogger: text(row.blogger), date: text(row.date) }))
      .filter((row) => row.title)
      .slice(0, MAX_BASKET_BLOGS),
    news: rows(value.news)
      .map((row) => ({ title: text(row.title), link: text(row.link), description: text(row.description), source: text(row.source), date: text(row.date) }))
      .filter((row) => row.title)
      .slice(0, MAX_BASKET_NEWS),
    sent_at: typeof value.sent_at === 'string' ? value.sent_at : null,
  };
}

export async function loadBasket(): Promise<ResearchBasket> {
  return normalizeBasket(await read<unknown>(KEYS.research, EMPTY_BASKET));
}

export const saveBasket = (basket: ResearchBasket) => write(KEYS.research, normalizeBasket(basket));
