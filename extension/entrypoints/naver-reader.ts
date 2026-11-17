import { defineUnlistedScript } from '#imports';
import { extractPost, listUrl, parsePostList, postUrl, type ListedPost } from '../lib/voice/naver';

/**
 * 열려 있는 네이버 블로그 탭 안에서 도는 코드. 내 블로그의 글 목록과 글 본문을 읽는다.
 *
 * 확장 화면에서 네이버를 직접 부르면 네이버가 막는다 (다른 곳에서 온 요청은 403).
 * 블로그 탭 안에서 부르면 같은 사이트의 요청이라 통한다. 그래서 이 파일을 탭에 넣는다.
 *
 * - 읽기만 한다. 글을 바꾸거나 버튼을 누르지 않는다.
 * - 로그인 정보를 싣지 않는다 (credentials: 'omit'). 그래서 공개 글만 읽힌다.
 */
export interface ReaderList {
  ok: boolean;
  reason: string | null;
  posts: ListedPost[];
}

export interface ReaderPost {
  ok: boolean;
  reason: string | null;
  title: string;
  body: string;
}

export default defineUnlistedScript(() => {
  const w = window as any;
  const READER_VERSION = 1;
  if (w.__blogStudioReader && w.__blogStudioReader.version === READER_VERSION) return;

  async function get(url: string): Promise<{ ok: boolean; status: number; text: string }> {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    return { ok: res.ok, status: res.status, text: await res.text() };
  }

  async function list(blogId: string, count: number): Promise<ReaderList> {
    try {
      const res = await get(listUrl(blogId, count));
      if (!res.ok) return { ok: false, reason: `http-${res.status}`, posts: [] };
      const posts = parsePostList(res.text);
      return posts ? { ok: true, reason: null, posts } : { ok: false, reason: 'not-a-list', posts: [] };
    } catch (err) {
      return { ok: false, reason: 'fetch-failed: ' + String(err instanceof Error ? err.message : err), posts: [] };
    }
  }

  async function post(blogId: string, logNo: string): Promise<ReaderPost> {
    try {
      const res = await get(postUrl(blogId, logNo));
      if (!res.ok) return { ok: false, reason: `http-${res.status}`, title: '', body: '' };
      const read = extractPost(res.text);
      return read ? { ok: true, reason: null, ...read } : { ok: false, reason: 'no-body', title: '', body: '' };
    } catch (err) {
      return { ok: false, reason: 'fetch-failed: ' + String(err instanceof Error ? err.message : err), title: '', body: '' };
    }
  }

  w.__blogStudioReader = { version: READER_VERSION, list, post };
});
