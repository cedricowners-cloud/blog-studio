import { browser } from 'wxt/browser';
import type {
  FillRequest,
  FillResult,
  ImagePasteRequest,
  ImagePasteResult,
  ImagesBeginResult,
  ImagesFinishRequest,
  ImagesFinishResult,
  ProbeResult,
} from './types';

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

// ───────── 사진 넣기 ─────────
// 시작할 때 에디터가 있는 프레임을 알아내고, 그 뒤로는 그 프레임에만 보낸다.
// 사진 데이터가 크기 때문에 다른 프레임에까지 보내지 않는다.

export interface ImagesStart extends ImagesBeginResult {
  /** 에디터가 있는 프레임. 붙여넣기와 마무리는 이 프레임에만 보낸다 */
  frameId: number;
}

/** 사진 넣기를 시작한다. 지금 문서를 떠 두고 붙여넣기를 받을 곳을 찾는다. */
export async function beginImages(tabId: number): Promise<ImagesStart | null> {
  await injectBridge(tabId);
  const injected = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: () => {
      const bridge = (window as any).__blogStudioEditor;
      return bridge && bridge.imagesBegin ? bridge.imagesBegin() : null;
    },
  });
  const answers = injected
    .map((item) => ({ frameId: item.frameId ?? 0, result: item.result as ImagesBeginResult | null }))
    .filter((item): item is { frameId: number; result: ImagesBeginResult } => item.result != null);
  const hit = answers.find((item) => item.result.reason !== 'no-editor') ?? answers[0];
  return hit ? { ...hit.result, frameId: hit.frameId } : null;
}

/** 사진 한 장을 붙여넣는다. 사진은 한 장씩 보낸다 (한꺼번에 보내면 너무 크다). */
export async function pasteImage(tabId: number, frameId: number, request: ImagePasteRequest): Promise<ImagePasteResult | null> {
  const [injected] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: async (req: ImagePasteRequest) => {
      const bridge = (window as any).__blogStudioEditor;
      return bridge && bridge.imagePaste ? await bridge.imagePaste(req) : null;
    },
    args: [request],
  });
  return (injected?.result as ImagePasteResult | null) ?? null;
}

/** 올라온 사진을 본문의 이미지 자리로 옮긴다. */
export async function finishImages(tabId: number, frameId: number, request: ImagesFinishRequest): Promise<ImagesFinishResult | null> {
  const [injected] = await browser.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: async (req: ImagesFinishRequest) => {
      const bridge = (window as any).__blogStudioEditor;
      return bridge && bridge.imagesFinish ? await bridge.imagesFinish(req) : null;
    },
    args: [request],
  });
  return (injected?.result as ImagesFinishResult | null) ?? null;
}

/** 사진 넣기를 그만두고 붙여넣기 전으로 돌려놓는다. */
export async function cancelImages(tabId: number, frameId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: async () => {
      const bridge = (window as any).__blogStudioEditor;
      if (bridge && bridge.imagesCancel) await bridge.imagesCancel();
    },
  });
}
