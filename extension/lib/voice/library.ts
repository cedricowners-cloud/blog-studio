// 내 글에서 말투 배우기. 내가 쓴 글을 모아 두고, AI가 말투를 정리한 "말투 카드"를 만든다.
// 글과 카드는 이 컴퓨터의 확장 저장소에만 둔다. 분석할 때만 내가 고른 AI로 보낸다.
// 여기서는 값만 다룬다. 저장과 AI 호출은 화면 쪽에서 한다.
import { fill, glue, type PromptPack } from '../prompts/pack.ts';

export interface VoicePost {
  id: string;
  title: string;
  body: string;
  /** blog: 내 블로그에서 가져옴 · paste: 직접 붙여넣음 */
  source: 'blog' | 'paste';
  /** 네이버 글 번호. 블로그에서 가져온 글에만 있다 */
  log_no?: string;
  /** 글을 쓴 날 (블로그에 적힌 그대로) */
  written_at?: string;
  added_at: string;
}

export interface VoiceCard {
  text: string;
  analyzed_at: string;
  /** 분석할 때의 글 모음 표시. 글 모음이 바뀌었는지 알아보는 데 쓴다 */
  signature: string;
  post_count: number;
  /** 사람이 직접 고쳤는지. 고쳤으면 자동으로 다시 분석해서 덮어쓰지 않는다 */
  edited: boolean;
  model: string;
}

export interface VoiceState {
  posts: VoicePost[];
  card: VoiceCard | null;
  /** 내 블로그 아이디. 글쓰기 화면의 주소에서 알아내거나, 사람이 맞다고 확인한 것 */
  blog_id: string | null;
  /** 한 번에 돌릴 때 새 글을 찾아 넣을지 */
  auto_check: boolean;
  checked_at: string | null;
  /** 읽어 봤지만 너무 짧아서 넣지 않은 글의 번호. 새 글을 찾을 때마다 다시 읽지 않으려고 적어 둔다 */
  ignored_log_nos: string[];
}

export const EMPTY_VOICE: VoiceState = { posts: [], card: null, blog_id: null, auto_check: true, checked_at: null, ignored_log_nos: [] };

const IGNORED_LIMIT = 200;

/** 너무 짧아서 넣지 않은 글의 번호를 적어 둔다 */
export function rememberIgnored(state: VoiceState, logNos: string[]): VoiceState {
  const merged = [...new Set([...logNos, ...state.ignored_log_nos])].slice(0, IGNORED_LIMIT);
  return { ...state, ignored_log_nos: merged };
}

/** 모아 두는 글의 최대 수. 넘으면 오래전에 넣은 글부터 뺀다 */
export const MAX_POSTS = 20;
/** 한 번 분석할 때 보내는 글 수와, 글 하나에서 보내는 글자 수. AI 비용을 정해진 범위에 둔다 */
export const ANALYZE_POSTS = 12;
export const EXCERPT_CHARS = 1500;
/** 이보다 짧은 글은 말투를 알기 어려워서 넣지 않는다 */
export const MIN_BODY_CHARS = 200;
/** 글을 쓸 때 알려 주는 "이미 쓴 글" 제목의 최대 수 */
export const TITLE_LIMIT = 30;
const CARD_LIMIT = 1500;

export function normalizeVoice(raw: unknown): VoiceState {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_VOICE, ignored_log_nos: [] };
  const value = raw as Partial<VoiceState>;
  return {
    posts: Array.isArray(value.posts) ? value.posts.filter((p) => p && typeof p.body === 'string' && typeof p.title === 'string') : [],
    card: value.card && typeof value.card.text === 'string' ? value.card : null,
    blog_id: typeof value.blog_id === 'string' && value.blog_id ? value.blog_id : null,
    auto_check: value.auto_check !== false,
    checked_at: typeof value.checked_at === 'string' ? value.checked_at : null,
    ignored_log_nos: Array.isArray(value.ignored_log_nos) ? value.ignored_log_nos.filter((n) => typeof n === 'string') : [],
  };
}

const sameBody = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

export function hasPost(state: VoiceState, post: { log_no?: string; body?: string }): boolean {
  return state.posts.some(
    (p) => (post.log_no !== undefined && p.log_no === post.log_no) || (post.body !== undefined && sameBody(p.body, post.body)),
  );
}

export interface AddResult {
  state: VoiceState;
  added: number;
  /** 이미 있어서 넣지 않은 글 */
  duplicate: number;
  /** 너무 짧아서 넣지 않은 글 */
  tooShort: number;
}

/** 글을 더한다. 새 글이 앞에 온다. 이미 있는 글과 너무 짧은 글은 넣지 않는다. */
export function addPosts(state: VoiceState, incoming: VoicePost[]): AddResult {
  let posts = [...state.posts];
  let added = 0;
  let duplicate = 0;
  let tooShort = 0;
  for (const post of incoming) {
    const body = post.body.trim();
    if (body.length < MIN_BODY_CHARS) {
      tooShort += 1;
      continue;
    }
    if (hasPost({ ...state, posts }, { log_no: post.log_no, body })) {
      duplicate += 1;
      continue;
    }
    posts = [{ ...post, title: post.title.trim() || '(제목 없음)', body }, ...posts];
    added += 1;
  }
  return { state: { ...state, posts: posts.slice(0, MAX_POSTS) }, added, duplicate, tooShort };
}

export function removePost(state: VoiceState, id: string): VoiceState {
  return { ...state, posts: state.posts.filter((p) => p.id !== id) };
}

/** 글 모음이 같으면 같은 글자가 나온다. 순서가 달라도 같다. */
export function signatureOf(posts: VoicePost[]): string {
  let hash = 5381;
  for (const part of posts.map((p) => `${p.id}:${p.body.length}`).sort()) {
    for (let i = 0; i < part.length; i++) hash = ((hash << 5) + hash + part.charCodeAt(i)) | 0;
    hash = ((hash << 5) + hash + 10) | 0;
  }
  return `${posts.length}-${(hash >>> 0).toString(36)}`;
}

/** 말투 카드를 만든 뒤에 글 모음이 바뀌었는지 */
export function cardIsStale(state: VoiceState): boolean {
  return state.card !== null && state.card.signature !== signatureOf(state.posts);
}

/** 지금 분석을 돌려야 하는지: 글은 있는데 카드가 없거나, 글 모음이 바뀌었고 사람이 카드를 고치지 않았을 때 */
export function needsAnalysis(state: VoiceState): boolean {
  if (state.posts.length === 0) return false;
  if (!state.card || !state.card.text.trim()) return true;
  return cardIsStale(state) && !state.card.edited;
}

/** 분석에 보낼 글. 최근에 넣은 글부터 고른다 */
export function postsToAnalyze(state: VoiceState): VoicePost[] {
  return state.posts.slice(0, ANALYZE_POSTS);
}

/** 말투를 분석하게 하는 프롬프트 */
export function buildAnalyzePrompt(pack: PromptPack, posts: VoicePost[]): string {
  const items = posts.map((post, i) =>
    fill(glue(pack, 'voice.post_item'), { n: i + 1, title: post.title, body: post.body.slice(0, EXCERPT_CHARS) }),
  );
  return fill(glue(pack, 'voice.analyze'), { count: posts.length, posts: items.join('\n') });
}

/** AI의 답을 말투 카드에 넣을 글로 다듬는다. 코드 울타리를 떼고 길이를 자른다 */
export function cleanCard(text: string): string {
  return text
    .replace(/^\s*```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()
    .slice(0, CARD_LIMIT);
}

/** 글을 쓸 때 "이미 쓴 글"로 알려 줄 제목들 */
export function titlesOf(state: VoiceState): string[] {
  const titles: string[] = [];
  for (const post of state.posts) {
    if (post.title && post.title !== '(제목 없음)' && !titles.includes(post.title)) titles.push(post.title);
  }
  return titles.slice(0, TITLE_LIMIT);
}
