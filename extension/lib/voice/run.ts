import { browser } from 'wxt/browser';
import type { ReaderList, ReaderPost } from '../../entrypoints/naver-reader';
import { blogIdFromUrl, type BlogPage } from './naver';

// 열려 있는 네이버 블로그 탭에 읽기 코드를 넣고, 글 목록과 글 본문을 받아 온다.

export interface BlogTab extends BlogPage {
  tabId: number;
  url: string;
}

/**
 * 네이버 블로그가 열려 있는 탭을 찾는다. 지금 보고 있는 탭이 블로그면 그 탭을 먼저 쓴다.
 * 접근 허용 주소가 blog.naver.com 이라서 그 주소의 탭만 보인다.
 */
export async function findBlogTabs(): Promise<BlogTab[]> {
  const tabs = await browser.tabs.query({ url: 'https://blog.naver.com/*' });
  const found: (BlogTab & { active: boolean })[] = [];
  for (const tab of tabs) {
    if (tab.id == null || !tab.url) continue;
    const page = blogIdFromUrl(tab.url);
    found.push({ tabId: tab.id, url: tab.url, blogId: page?.blogId ?? '', isWritePage: page?.isWritePage ?? false, active: !!tab.active });
  }
  found.sort((a, b) => Number(b.active) - Number(a.active));
  return found.map(({ active: _active, ...tab }) => tab);
}

async function inject(tabId: number): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['/naver-reader.js'] });
}

export async function readList(tabId: number, blogId: string, count: number): Promise<ReaderList> {
  await inject(tabId);
  const [injected] = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (id: string, n: number) => {
      const reader = (window as any).__blogStudioReader;
      return reader ? await reader.list(id, n) : null;
    },
    args: [blogId, count],
  });
  return (injected?.result as ReaderList | null) ?? { ok: false, reason: 'no-reader', posts: [] };
}

export async function readPost(tabId: number, blogId: string, logNo: string): Promise<ReaderPost> {
  await inject(tabId);
  const [injected] = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (id: string, no: string) => {
      const reader = (window as any).__blogStudioReader;
      return reader ? await reader.post(id, no) : null;
    },
    args: [blogId, logNo],
  });
  return (injected?.result as ReaderPost | null) ?? { ok: false, reason: 'no-reader', title: '', body: '' };
}

/** 읽지 못한 까닭을 쉬운 말로 */
export function explainReader(reason: string | null): string {
  if (!reason) return '';
  if (reason === 'http-404') return '이 블로그를 찾지 못했어요. 아이디가 맞는지 확인해 주세요.';
  if (reason === 'http-403') return '네이버가 읽기를 막았어요. 잠시 뒤에 다시 해 주세요.';
  if (reason === 'not-a-list') return '글 목록을 알아보지 못했어요. 네이버가 화면을 바꿨을 수 있어요. 글을 직접 붙여넣어 주세요.';
  if (reason === 'no-body') return '본문을 찾지 못했어요. 비공개 글이거나, 화면 모양이 다른 글이에요.';
  if (reason === 'no-reader') return '블로그 탭에서 응답이 없어요. 그 탭을 새로 고친 뒤 다시 해 주세요.';
  if (reason.startsWith('fetch-failed')) return '읽다가 연결이 끊겼어요. 다시 해 주세요.';
  return '읽지 못했어요 (' + reason + ').';
}
