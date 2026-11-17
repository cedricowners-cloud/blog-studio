import { llmGenerate, resolveMaxTokens } from '../../lib/llm/client';
import type { PromptPack } from '../../lib/prompts/pack';
import { addUsage, loadVoice, saveVoice, type ReadyAi } from '../../lib/store';
import {
  addPosts,
  buildAnalyzePrompt,
  cleanCard,
  hasPost,
  MIN_BODY_CHARS,
  postsToAnalyze,
  rememberIgnored,
  signatureOf,
  type VoicePost,
  type VoiceState,
} from '../../lib/voice/library';
import type { ListedPost } from '../../lib/voice/naver';
import { explainReader, findBlogTabs, readList, readPost } from '../../lib/voice/run';

// 내 말투와 관련해 여러 화면이 같이 쓰는 일: 말투 정리하기, 블로그에서 글 읽어 오기, 새 글 찾아 넣기.

/** 한 번에 돌릴 때 자동으로 찾아 넣는 새 글의 최대 수 */
const AUTO_ADD_LIMIT = 5;

export interface AnalyzeOptions {
  signal?: AbortSignal;
  onProgress?: (chars: number) => void;
}

/** 모아 둔 글을 AI에게 보내 말투를 정리하게 하고, 말투 카드로 저장한다. */
export async function analyzeVoice(pack: PromptPack, ai: ReadyAi, options: AnalyzeOptions = {}): Promise<VoiceState> {
  const state = await loadVoice();
  const posts = postsToAnalyze(state);
  if (posts.length === 0) throw new Error('모아 둔 글이 없어요. 먼저 내 글을 넣어 주세요.');

  const result = await llmGenerate(buildAnalyzePrompt(pack, posts), {
    provider: ai.provider,
    model: ai.model,
    apiKey: ai.key,
    temperature: 0.3,
    maxTokens: resolveMaxTokens(8000, 4096, ai.modelInfo),
    signal: options.signal,
    onProgress: options.onProgress,
  });
  await addUsage(ai.provider, result.usage);

  const text = cleanCard(result.text);
  if (!text) throw new Error('AI가 말투를 정리하지 못했어요. 다시 해 주세요.');

  // 분석하는 사이에 글이 바뀌었을 수 있다. 저장할 때 다시 읽고, 분석에 쓴 글 모음의 표시를 남긴다.
  const fresh = await loadVoice();
  const next: VoiceState = {
    ...fresh,
    card: {
      text,
      analyzed_at: new Date().toISOString(),
      signature: signatureOf(state.posts),
      post_count: posts.length,
      edited: false,
      model: result.model,
    },
  };
  await saveVoice(next);
  return next;
}

export interface ImportResult {
  added: number;
  duplicate: number;
  tooShort: number;
  /** 읽지 못한 글의 제목 */
  failed: string[];
}

/** 목록에서 고른 글을 하나씩 읽어 와 모아 둔다. 최근 글이 앞에 오게 오래된 글부터 넣는다. */
export async function importPosts(
  tabId: number,
  blogId: string,
  chosen: ListedPost[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const read: VoicePost[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const item of [...chosen].reverse()) {
    onProgress?.(done, chosen.length);
    const result = await readPost(tabId, blogId, item.logNo);
    done += 1;
    if (!result.ok || !result.body) {
      failed.push(item.title || item.logNo);
      continue;
    }
    read.push({
      id: `blog-${item.logNo}`,
      title: item.title || result.title,
      body: result.body,
      source: 'blog',
      log_no: item.logNo,
      written_at: item.date,
      added_at: new Date().toISOString(),
    });
  }
  onProgress?.(chosen.length, chosen.length);

  const state = await loadVoice();
  const outcome = addPosts(state, read);
  const short = read.filter((p) => p.body.trim().length < MIN_BODY_CHARS && p.log_no).map((p) => p.log_no as string);
  await saveVoice({ ...rememberIgnored(outcome.state, short), blog_id: state.blog_id ?? blogId, checked_at: new Date().toISOString() });
  return { added: outcome.added, duplicate: outcome.duplicate, tooShort: outcome.tooShort, failed };
}

/**
 * 내 블로그에 새 글이 있으면 찾아 넣는다. 한 번에 돌리기를 시작할 때 부른다.
 * 블로그 탭이 없거나 읽지 못해도 멈추지 않는다. 무슨 일이 있었는지 한 줄로 알려 준다.
 */
export async function checkNewPosts(): Promise<{ added: number; note: string }> {
  const state = await loadVoice();
  if (!state.blog_id) return { added: 0, note: '' };
  try {
    const tab = (await findBlogTabs())[0];
    if (!tab) return { added: 0, note: '네이버 블로그를 연 탭이 없어서 새 글은 확인하지 못했어요.' };
    const list = await readList(tab.tabId, state.blog_id, 10);
    if (!list.ok) return { added: 0, note: '새 글을 확인하지 못했어요. ' + explainReader(list.reason) };
    const fresh = list.posts
      .filter((p) => !hasPost(state, { log_no: p.logNo }) && !state.ignored_log_nos.includes(p.logNo))
      .slice(0, AUTO_ADD_LIMIT);
    if (fresh.length === 0) {
      await saveVoice({ ...state, checked_at: new Date().toISOString() });
      return { added: 0, note: '' };
    }
    const result = await importPosts(tab.tabId, state.blog_id, fresh);
    if (result.added > 0) return { added: result.added, note: `내 블로그의 새 글 ${result.added}편을 찾아 넣었어요.` };
    return { added: 0, note: result.failed.length > 0 ? `내 블로그의 새 글 ${result.failed.length}편을 읽지 못했어요.` : '' };
  } catch (err) {
    return { added: 0, note: '새 글을 확인하지 못했어요 (' + String(err instanceof Error ? err.message : err) + ').' };
  }
}
