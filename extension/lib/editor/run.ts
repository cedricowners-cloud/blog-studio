import { browser } from 'wxt/browser';
import type { FillRequest, FillResult, ProbeResult } from './types';

export interface WriteTab {
  id: number;
  url: string;
}

/** 지금 보고 있는 탭이 네이버 블로그인지 확인한다. 아니면 null. */
export async function getNaverTab(): Promise<WriteTab | null> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return null;
  // 접근 허용 주소(blog.naver.com)가 아니면 url 이 비어서 온다.
  if (!tab.url || !tab.url.startsWith('https://blog.naver.com/')) return null;
  return { id: tab.id, url: tab.url };
}

/**
 * 글쓰기 탭의 모든 프레임에 읽기 코드를 넣고, 에디터 상태를 읽어 온다.
 * 프레임마다 결과가 하나씩 온다. 에디터가 있는 프레임의 결과를 맨 앞에 둔다.
 */
/** 글쓰기 탭의 모든 프레임에 에디터 코드를 넣는다. 이미 같은 버전이 있으면 아무 일도 하지 않는다. */
async function injectBridge(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    files: ['/editor-bridge.js'],
  });
}

/**
 * 에디터에 글을 넣는다. 에디터가 있는 프레임의 결과를 돌려준다.
 * 저장이나 발행은 하지 않는다.
 */
export async function fillEditor(tabId: number, request: FillRequest): Promise<FillResult | null> {
  await injectBridge(tabId);
  const injected = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: async (req: FillRequest) => {
      const bridge = (window as any).__blogStudioEditor;
      return bridge ? await bridge.fill(req) : null;
    },
    args: [request],
  });
  const results = injected
    .map((item) => item.result as FillResult | null)
    .filter((r): r is FillResult => r != null);
  return results.find((r) => r.reason !== 'no-editor') ?? results[0] ?? null;
}

/** 마지막으로 채우기 전의 글로 되돌린다. */
export async function restoreEditor(tabId: number): Promise<{ ok: boolean; reason: string | null } | null> {
  await injectBridge(tabId);
  const injected = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: async () => {
      const bridge = (window as any).__blogStudioEditor;
      return bridge ? await bridge.restore() : null;
    },
  });
  const results = injected
    .map((item) => item.result as { ok: boolean; reason: string | null } | null)
    .filter((r): r is { ok: boolean; reason: string | null } => r != null);
  return results.find((r) => r.reason !== 'no-editor') ?? results[0] ?? null;
}

export async function probeEditor(tabId: number, includeRaw: boolean): Promise<ProbeResult[]> {
  await injectBridge(tabId);

  const injected = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: (raw: boolean) => {
      const bridge = (window as any).__blogStudioEditor;
      return bridge ? bridge.probe(raw) : null;
    },
    args: [includeRaw],
  });

  const results = injected
    .map((item) => item.result as ProbeResult | null)
    .filter((r): r is ProbeResult => r != null);
  results.sort((a, b) => Number(b.found) - Number(a.found));
  return results;
}
