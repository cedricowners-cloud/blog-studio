import { defineUnlistedScript } from '#imports';
import { allImages, isUploaded, placeImages } from '../lib/editor/images';
import type {
  ComponentSummary,
  FillRequest,
  FillResult,
  ImagePasteRequest,
  ImagePasteResult,
  ImagesBeginResult,
  ImagesFinishRequest,
  ImagesFinishResult,
  ProbeDiagnostics,
  ProbeResult,
} from '../lib/editor/types';

/**
 * 네이버 글쓰기 화면 안에서 도는 코드.
 *
 * 네이버 스마트에디터는 화면의 글자가 아니라 내부 문서 데이터를 저장한다.
 * 그 데이터는 페이지의 전역(window)에서만 보이므로, 이 파일은 페이지와 같은
 * 실행 환경(MAIN world)에 넣는다. 에디터는 페이지 안의 프레임 속에 있어서
 * 모든 프레임에 넣고, 에디터가 있는 프레임만 결과를 돌려준다.
 *
 * 이 단계(E1)의 코드는 읽기만 한다. 문서를 바꾸거나 버튼을 누르지 않는다.
 * 네이버가 공개한 기능이 아니라서 없을 수 있다. 없으면 없다고 알려 준다.
 */
export default defineUnlistedScript(() => {
  const w = window as any;
  // 이 숫자를 올리면, 이미 열려 있는 탭에 들어가 있던 예전 코드가 새 코드로 바뀐다.
  const BRIDGE_VERSION = 6;
  if (w.__blogStudioEditor && w.__blogStudioEditor.version === BRIDGE_VERSION) return;

  const RAW_LIMIT = 600_000; // 문서 전체를 실어 보낼 때의 글자 수 상한

  /** 에디터 모음에서 이름과 에디터를 꺼낸다. 모음의 모양(객체, Map, 배열)을 가리지 않는다. */
  function listEditors(store: any): Array<[string, any]> {
    if (!store) return [];
    if (store instanceof Map) return [...store.entries()].map(([k, v]) => [String(k), v]);
    if (Array.isArray(store)) return store.map((v, i) => [String(i), v]);
    if (typeof store === 'object') return Object.keys(store).map((k) => [k, store[k]]);
    return [];
  }

  function findEditor(): { keys: string[]; editor: any } | null {
    // SmartEditor 는 객체일 수도 있고 함수(클래스)일 수도 있다. 종류를 따지지 않는다.
    const S = w.SmartEditor;
    if (!S) return null;
    const entries = listEditors(S._editors).filter(([, editor]) => editor != null);
    const first = entries[0];
    if (!first) return null;
    return { keys: entries.map(([key]) => key), editor: first[1] };
  }

  /** 에디터를 찾지 못했을 때 원인을 짐작할 수 있는 정보를 모은다. */
  function diagnose(): ProbeDiagnostics {
    const S = w.SmartEditor;
    let smartEditorKeys: string[] = [];
    try {
      smartEditorKeys = S ? Object.getOwnPropertyNames(S).slice(0, 40) : [];
    } catch {
      smartEditorKeys = [];
    }
    const store = S ? S._editors : undefined;
    const editorsType =
      store === undefined ? 'undefined'
      : store === null ? 'null'
      : store instanceof Map ? 'map'
      : Array.isArray(store) ? 'array'
      : typeof store;
    let globals: string[] = [];
    try {
      globals = Object.keys(w).filter((k) => /smart|editor|^se[A-Z_]/i.test(k)).slice(0, 40);
    } catch {
      globals = [];
    }
    const iframes = Array.from(document.querySelectorAll('iframe'))
      .slice(0, 10)
      .map((f) => (f.id ? '#' + f.id + ' ' : '') + (f.getAttribute('src') || '(주소 없음)').slice(0, 80));
    return {
      smartEditorType: typeof S,
      smartEditorKeys,
      editorsType,
      editorCount: listEditors(store).length,
      globalsLikeEditor: globals,
      iframes,
    };
  }

  /** 에디터 객체와 그 원형이 가진 기능 이름을 모은다. */
  function listMethods(obj: any): string[] {
    const names = new Set<string>();
    let cur = obj;
    for (let depth = 0; cur && depth < 5; depth += 1) {
      if (cur === Object.prototype) break;
      for (const name of Object.getOwnPropertyNames(cur)) {
        if (name === 'constructor' || name.startsWith('__')) continue;
        let isFunction = false;
        try {
          isFunction = typeof obj[name] === 'function';
        } catch {
          isFunction = false;
        }
        if (isFunction) names.add(name);
      }
      cur = Object.getPrototypeOf(cur);
    }
    return [...names].sort().slice(0, 300);
  }

  /** 부품 안의 글자를 모은다. 구조를 가정하지 않고 "value" 문자열을 찾는다. */
  function collectText(node: any, out: string[], depth: number): void {
    if (node == null || depth > 8 || out.join('').length > 200) return;
    if (Array.isArray(node)) {
      for (const item of node) collectText(item, out, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    if (typeof node.value === 'string' && node.value.trim()) out.push(node.value);
    for (const key of Object.keys(node)) {
      if (key === 'style' || key === 'id') continue;
      const child = node[key];
      if (child && typeof child === 'object') collectText(child, out, depth + 1);
    }
  }

  /**
   * 부품 안의 꾸밈 값을 모은다. 굵게, 글자 크기, 정렬 같은 값은 부품 겉이 아니라
   * 안쪽 문단과 글자 조각의 "style" 칸에 들어 있다. 칸 이름을 가정하지 않고 있는 대로 모은다.
   */
  function collectStyles(node: any, out: Set<string>, depth: number): void {
    if (node == null || depth > 8 || out.size >= 24) return;
    if (Array.isArray(node)) {
      for (const item of node) collectStyles(item, out, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (key === 'style' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const name of Object.keys(child)) {
          const value = child[name];
          if (name.startsWith('@') || value === null || typeof value === 'object') continue;
          if (out.size < 24) out.add(`${name}=${String(value).slice(0, 30)}`);
        }
      } else if (key === 'align' && typeof child === 'string') {
        out.add(`align=${child}`);
      } else if (child && typeof child === 'object') {
        collectStyles(child, out, depth + 1);
      }
    }
  }

  function summarize(comp: any, index: number): ComponentSummary {
    const parts: string[] = [];
    collectText(comp, parts, 0);
    const styles = new Set<string>();
    collectStyles(comp, styles, 0);
    return {
      index,
      ctype: String(comp && comp['@ctype'] ? comp['@ctype'] : '(알 수 없음)'),
      layout: comp && typeof comp.layout === 'string' ? comp.layout : null,
      keys: comp && typeof comp === 'object' ? Object.keys(comp) : [],
      text: parts.join(' ').replace(/\s+/g, ' ').slice(0, 80),
      paragraphCount: comp && Array.isArray(comp.value) ? comp.value.length : 0,
      styles: [...styles].sort(),
    };
  }

  /** 에디터 자원 주소에 들어 있는 버전 번호를 찾는다. */
  function guessVersion(): string | null {
    const urls: string[] = [];
    document.querySelectorAll('script[src]').forEach((el) => urls.push((el as HTMLScriptElement).src));
    document.querySelectorAll('link[href]').forEach((el) => urls.push((el as HTMLLinkElement).href));
    for (const url of urls) {
      if (!/editor|smarteditor|\/se\//i.test(url)) continue;
      const match = url.match(/\/(\d+\.\d+\.\d+)\//);
      if (match && match[1]) return match[1];
    }
    return null;
  }

  /** "작성 중인 글이 있습니다" 안내가 화면에 보이는지 확인한다. */
  function hasDraftPrompt(): boolean {
    const nodes = document.querySelectorAll('[class*="popup"], [class*="layer"], [role="dialog"], [class*="alert"]');
    for (const el of Array.from(nodes)) {
      const box = el as HTMLElement;
      if (!box.offsetParent && getComputedStyle(box).position !== 'fixed') continue;
      const text = box.innerText || '';
      if (text.includes('작성 중인 글')) return true;
    }
    return false;
  }

  function probe(includeRaw: boolean): ProbeResult {
    const result: ProbeResult = {
      href: location.href,
      isTop: window.top === window,
      found: false,
      reason: null,
      editorKeys: [],
      methods: [],
      editorVersion: null,
      docKeys: [],
      title: '',
      componentCount: 0,
      components: [],
      renderedCount: document.querySelectorAll('.se-component').length,
      draftPrompt: hasDraftPrompt(),
      rawJson: null,
      rawTooLarge: false,
      diag: diagnose(),
    };

    const hit = findEditor();
    if (!hit) {
      result.reason = 'no-editor';
      return result;
    }
    result.found = true;
    result.editorKeys = hit.keys;
    result.methods = listMethods(hit.editor);
    result.editorVersion = guessVersion();

    if (typeof hit.editor.getDocumentData !== 'function') {
      result.reason = 'no-getDocumentData';
      return result;
    }

    try {
      const data = hit.editor.getDocumentData();
      const doc = data && data.document ? data.document : data;
      result.docKeys = doc && typeof doc === 'object' ? Object.keys(doc) : [];
      const comps: any[] = doc && Array.isArray(doc.components) ? doc.components : [];
      result.componentCount = comps.length;
      result.components = comps.slice(0, 80).map(summarize);
      const titleComp = comps.find((c) => c && c['@ctype'] === 'documentTitle');
      if (titleComp) {
        const parts: string[] = [];
        collectText(titleComp, parts, 0);
        result.title = parts.join(' ').slice(0, 120);
      }
      if (includeRaw) {
        const raw = JSON.stringify(data);
        if (raw.length > RAW_LIMIT) result.rawTooLarge = true;
        else result.rawJson = raw;
      }
    } catch (err) {
      result.reason = 'read-failed: ' + String(err && (err as Error).message ? (err as Error).message : err).slice(0, 120);
    }
    return result;
  }

  // ───────────────────────── 글 넣기 (E2, E3) ─────────────────────────
  // 여기서부터는 문서를 바꾼다. 저장이나 발행 버튼은 누르지 않는다.

  /** 우리가 만들어 넣는 본문 부품 종류. 이 밖의 부품(지도, 스티커 등)은 지우지 않고 남긴다. */
  const KNOWN_BODY = new Set(['text', 'quotation', 'horizontalLine', 'table', 'image']);
  /** 견본에서 id 를 가지고 있던 것들 */
  const NEEDS_ID = new Set([
    'documentTitle', 'text', 'quotation', 'horizontalLine', 'table', 'image', 'paragraph', 'textNode', 'tableCell',
  ]);

  function newId(): string {
    const unique =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
    return 'SE-' + unique;
  }

  /** 부품을 복사하면서 id 를 새로 붙인다. */
  function withIds(node: any): any {
    if (Array.isArray(node)) return node.map(withIds);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    if (NEEDS_ID.has(String(node['@ctype']))) out.id = newId();
    for (const key of Object.keys(node)) {
      if (key === 'id') continue;
      out[key] = withIds(node[key]);
    }
    return out;
  }

  /** 부품 안의 글자를 순서대로 이어 붙인다. */
  function flatten(node: any): string {
    if (node == null) return '';
    if (Array.isArray(node)) return node.map(flatten).join('');
    if (typeof node !== 'object') return '';
    if (node['@ctype'] === 'textNode') return typeof node.value === 'string' ? node.value : '';
    let out = '';
    for (const key of Object.keys(node)) {
      if (key === 'style') continue;
      const child = node[key];
      if (child && typeof child === 'object') out += flatten(child);
    }
    return out;
  }

  /**
   * 부품 안의 색 값을 순서대로 모은다 (글자색, 배경색).
   * 에디터가 모르는 값을 버리는지 알아보려고, 넣은 것과 다시 읽은 것을 견준다.
   */
  function colorSignature(node: any, out: string[] = []): string[] {
    if (node == null) return out;
    if (Array.isArray(node)) {
      for (const item of node) colorSignature(item, out);
      return out;
    }
    if (typeof node !== 'object') return out;
    const style = node.style;
    if (style && typeof style === 'object' && style['@ctype'] === 'nodeStyle') {
      for (const key of ['fontColor', 'backgroundColor']) {
        if (typeof style[key] === 'string') out.push(`${key}=${String(style[key]).toLowerCase()}`);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'style') continue;
      const child = node[key];
      if (child && typeof child === 'object') colorSignature(child, out);
    }
    return out;
  }

  function describe(comp: any): string {
    if (!comp) return '(없음)';
    const layout = typeof comp.layout === 'string' ? '/' + comp.layout : '';
    return `${String(comp['@ctype'])}${layout} "${flatten(comp).slice(0, 24)}"`;
  }

  function errorText(err: unknown): string {
    return String(err && (err as Error).message ? (err as Error).message : err).slice(0, 160);
  }

  function unwrap(data: any): any {
    return data && data.document ? data.document : data;
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function fill(req: FillRequest): Promise<FillResult> {
    const result: FillResult = {
      ok: false,
      reason: null,
      existingCount: 0,
      existingChars: 0,
      sentCount: 0,
      foundCount: 0,
      kept: 0,
      titleAfter: '',
      mismatches: [],
      hasBackup: !!w.__blogStudioBackup,
    };
    const fail = (reason: string): FillResult => ({ ...result, reason });

    const hit = findEditor();
    if (!hit) return fail('no-editor');
    const ed = hit.editor;
    if (typeof ed.getDocumentData !== 'function' || typeof ed.setDocumentData !== 'function') {
      return fail('no-setDocumentData');
    }
    if (hasDraftPrompt()) return fail('draft-prompt');

    let data: any;
    try {
      data = ed.getDocumentData();
    } catch (err) {
      return fail('read-failed: ' + errorText(err));
    }
    const doc = unwrap(data);
    if (!doc || !Array.isArray(doc.components)) return fail('unexpected-document');

    const comps: any[] = doc.components;
    const titleComp = comps.find((c) => c && c['@ctype'] === 'documentTitle') ?? null;
    const body = comps.filter((c) => c !== titleComp);
    result.existingCount = body.length;
    result.existingChars = flatten(body).replace(/[\s​]/g, '').length;
    const hasOtherParts = body.some((c) => c && c['@ctype'] !== 'text');
    if ((result.existingChars > 0 || hasOtherParts) && !req.force) return fail('not-empty');

    // 되돌릴 수 있게 넣기 전 문서를 보관한다. 코드가 바뀌어도 남도록 따로 둔다.
    w.__blogStudioBackup = { at: Date.now(), json: JSON.stringify(data) };
    result.hasBackup = true;

    const kept = body.filter((c) => c && !KNOWN_BODY.has(String(c['@ctype'])));
    const fresh: any[] = withIds(req.components);
    result.kept = kept.length;

    if (titleComp && req.title != null) {
      titleComp.title = [withIds({ nodes: [{ value: req.title, '@ctype': 'textNode' }], '@ctype': 'paragraph' })];
    }
    const expected = [...fresh, ...kept];
    doc.components = [...(titleComp ? [titleComp] : []), ...expected];

    try {
      const returned = ed.setDocumentData(data);
      if (returned && typeof returned.then === 'function') await returned;
    } catch (err) {
      // 넣다가 실패하면 넣기 전 상태로 돌려놓는다.
      try {
        ed.setDocumentData(JSON.parse(w.__blogStudioBackup.json));
      } catch {
        /* 되돌리기도 실패하면 사용자가 화면에서 확인한다 */
      }
      return fail('set-failed: ' + errorText(err));
    }

    await sleep(400);

    // 넣은 것과 다시 읽은 것을 부품마다 견준다.
    let after: any;
    try {
      after = unwrap(ed.getDocumentData());
    } catch (err) {
      return fail('verify-failed: ' + errorText(err));
    }
    const afterComps: any[] = after && Array.isArray(after.components) ? after.components : [];
    const afterTitle = afterComps.find((c) => c && c['@ctype'] === 'documentTitle') ?? null;
    const afterBody = afterComps.filter((c) => c !== afterTitle);
    result.sentCount = expected.length;
    result.foundCount = afterBody.length;
    result.titleAfter = flatten(afterTitle);

    const count = Math.max(expected.length, afterBody.length);
    for (let i = 0; i < count && result.mismatches.length < 10; i += 1) {
      const a = expected[i];
      const b = afterBody[i];
      const same =
        !!a && !!b &&
        a['@ctype'] === b['@ctype'] &&
        (a.layout ?? null) === (b.layout ?? null) &&
        flatten(a) === flatten(b);
      if (!same) {
        result.mismatches.push({ index: i, expected: describe(a), actual: describe(b) });
        continue;
      }
      // 글자는 같은데 색이 다르면 따로 알려 준다. 에디터가 색을 받지 않았다는 뜻이다.
      const sentColors = colorSignature(a).join(', ');
      const readColors = colorSignature(b).join(', ');
      if (sentColors !== readColors) {
        result.mismatches.push({
          index: i,
          expected: '색: ' + (sentColors || '(없음)'),
          actual: '색: ' + (readColors || '(없음)'),
        });
      }
    }
    if (req.title != null && result.titleAfter !== req.title) {
      result.mismatches.push({ index: -1, expected: `제목 "${req.title}"`, actual: `제목 "${result.titleAfter}"` });
    }

    result.ok = result.mismatches.length === 0;
    result.reason = result.ok ? null : 'mismatch';
    return result;
  }

  /** 마지막으로 채우기 전의 문서로 되돌린다. */
  async function restore(): Promise<{ ok: boolean; reason: string | null }> {
    const hit = findEditor();
    if (!hit) return { ok: false, reason: 'no-editor' };
    const backup = w.__blogStudioBackup;
    if (!backup || typeof backup.json !== 'string') return { ok: false, reason: 'no-backup' };
    if (typeof hit.editor.setDocumentData !== 'function') return { ok: false, reason: 'no-setDocumentData' };
    try {
      const returned = hit.editor.setDocumentData(JSON.parse(backup.json));
      if (returned && typeof returned.then === 'function') await returned;
    } catch (err) {
      return { ok: false, reason: 'set-failed: ' + errorText(err) };
    }
    return { ok: true, reason: null };
  }

  // ───────────────────────── 사진 넣기 ─────────────────────────
  // 사진의 주소는 네이버가 사진을 받은 뒤에 정해 준다. 그래서 세 걸음으로 한다.
  //   1) imagesBegin   지금 문서를 따로 떠 두고, 붙여넣기를 받을 곳과 커서를 준비한다.
  //   2) imagePaste    사진을 한 장씩 붙여넣는다. 에디터가 네이버에 올린다.
  //   3) imagesFinish  다 올라오면, 떠 둔 문서의 "이미지 자리"에 사진 부품을 끼워서 다시 넣는다.
  // 붙여넣기는 사람이 Ctrl+V 로 사진을 붙여넣는 것과 같은 일을 에디터에 알리는 것이다. 저장이나 발행은 하지 않는다.

  interface ImageWork {
    /** 붙여넣기 전의 문서 (글자로 떠 둔 것) */
    baseJson: string;
    /** 원래 있던 사진의 id */
    already: Set<string>;
    pasted: number;
  }
  let imageWork: ImageWork | null = null;

  function readComponents(ed: any): any[] {
    try {
      const doc = unwrap(ed.getDocumentData());
      return doc && Array.isArray(doc.components) ? doc.components : [];
    } catch {
      return [];
    }
  }

  /** 붙여넣기를 받는 곳. 에디터는 숨은 입력 칸(iframe)에서 붙여넣기를 받는다. 없으면 본문에서 찾는다. */
  function findPasteTarget(): { el: any; kind: 'buffer' | 'editable' } | null {
    try {
      const buffer: any = document.querySelector("iframe[id^='input_buffer']");
      const inner = buffer ? buffer.contentDocument : null;
      const el = inner ? inner.querySelector("[contenteditable='true']") || inner.body : null;
      if (el) return { el, kind: 'buffer' };
    } catch {
      /* 다른 곳의 프레임이면 읽지 못한다. 본문에서 찾는다 */
    }
    const editable = document.querySelector("[contenteditable='true']");
    return editable ? { el: editable, kind: 'editable' } : null;
  }

  /** 붙여넣기는 커서가 있어야 받는다. 자리는 나중에 옮기므로 본문의 맨 끝에 둔다. */
  function placeCaretAtEnd(): void {
    try {
      const paragraphs = document.querySelectorAll('.se-text-paragraph');
      const last: any = paragraphs[paragraphs.length - 1];
      if (!last) return;
      last.scrollIntoView({ block: 'center' });
      const rect = last.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + 8, clientY: rect.top + rect.height / 2, button: 0, buttons: 1 };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const Ctor: any = type.startsWith('pointer') ? w.PointerEvent : w.MouseEvent;
        if (Ctor) last.dispatchEvent(new Ctor(type, at));
      }
      const range = document.createRange();
      range.selectNodeContents(last);
      range.collapse(false);
      const selection = w.getSelection ? w.getSelection() : null;
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch {
      /* 커서를 놓지 못해도 붙여넣기를 시도해 본다 */
    }
  }

  function dataUrlToFile(name: string, dataUrl: string): any {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) throw new Error('사진 데이터의 모양이 달라요');
    const binary = w.atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new w.File([bytes], name, { type: match[1] });
  }

  function imagesBegin(): ImagesBeginResult {
    const fail = (reason: string): ImagesBeginResult => ({ ok: false, reason, target: null, existing: 0 });
    const hit = findEditor();
    if (!hit) return fail('no-editor');
    const ed = hit.editor;
    if (typeof ed.getDocumentData !== 'function' || typeof ed.setDocumentData !== 'function') return fail('no-setDocumentData');
    if (hasDraftPrompt()) return fail('draft-prompt');
    if (document.visibilityState && document.visibilityState !== 'visible') return fail('hidden');
    const target = findPasteTarget();
    if (!target) return fail('no-paste-target');

    let data: any;
    try {
      data = ed.getDocumentData();
    } catch (err) {
      return fail('read-failed: ' + errorText(err));
    }
    const doc = unwrap(data);
    if (!doc || !Array.isArray(doc.components)) return fail('unexpected-document');

    const existing = allImages(doc.components);
    imageWork = { baseJson: JSON.stringify(data), already: new Set(existing.map((image) => String(image.id))), pasted: 0 };
    placeCaretAtEnd();
    return { ok: true, reason: null, target: target.kind, existing: existing.length };
  }

  async function imagePaste(req: ImagePasteRequest): Promise<ImagePasteResult> {
    const fail = (reason: string): ImagePasteResult => ({ ok: false, reason, appeared: false });
    const work = imageWork;
    const hit = findEditor();
    if (!work || !hit) return fail(work ? 'no-editor' : 'not-started');
    const target = findPasteTarget();
    if (!target) return fail('no-paste-target');
    if (document.visibilityState && document.visibilityState !== 'visible') return fail('hidden');

    const ours = () => allImages(readComponents(hit.editor)).filter((image) => !work.already.has(String(image.id)));
    const before = ours().length;
    try {
      const transfer = new w.DataTransfer();
      transfer.items.add(dataUrlToFile(req.name, req.dataUrl));
      target.el.dispatchEvent(new w.ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: transfer }));
    } catch (err) {
      return fail('paste-failed: ' + errorText(err));
    }
    work.pasted += 1;
    // 에디터가 사진 부품을 만들 때까지 잠깐 기다린다. 다 올라가는 것은 imagesFinish 에서 기다린다.
    for (let i = 0; i < 25; i += 1) {
      await sleep(400);
      if (ours().length > before) return { ok: true, reason: null, appeared: true };
    }
    return { ok: true, reason: null, appeared: false };
  }

  async function imagesFinish(req: ImagesFinishRequest): Promise<ImagesFinishResult> {
    const result: ImagesFinishResult = {
      ok: false, reason: null, pasted: imageWork ? imageWork.pasted : 0, uploaded: 0, placed: 0, emptySlots: [], appended: 0, foundAfter: 0, log: [],
    };
    const work = imageWork;
    const hit = findEditor();
    if (!work || !hit) return { ...result, reason: work ? 'no-editor' : 'not-started' };
    const ed = hit.editor;
    const ours = () => allImages(readComponents(ed)).filter((image) => !work.already.has(String(image.id)));
    const restoreBase = async () => {
      try {
        const returned = ed.setDocumentData(JSON.parse(work.baseJson));
        if (returned && typeof returned.then === 'function') await returned;
      } catch {
        /* 되돌리지 못하면 사용자가 화면에서 확인한다 */
      }
    };

    // 다 올라올 때까지 기다린다. 여기서 서두르면 사진이 깨진다. 더 올라오지 않으면 그만 기다린다.
    const deadline = Date.now() + Math.max(1000, req.timeoutMs);
    let best = 0;
    let stalledSince = Date.now();
    let images: any[] = [];
    for (;;) {
      images = ours();
      const done = images.filter(isUploaded).length;
      if (images.length >= work.pasted && done >= images.length && images.length > 0) break;
      if (done > best) {
        best = done;
        stalledSince = Date.now();
      }
      if (Date.now() > deadline) {
        result.log.push('기다리는 시간이 다 됐어요');
        break;
      }
      if (Date.now() - stalledSince > 40_000) {
        result.log.push('40초 동안 더 올라오지 않았어요');
        break;
      }
      await sleep(500);
    }

    const uploaded = images.filter(isUploaded);
    result.uploaded = uploaded.length;
    result.log.push(`붙여넣음 ${work.pasted}장 · 에디터에 나타남 ${images.length}장 · 다 올라감 ${uploaded.length}장`);
    imageWork = null;

    if (uploaded.length === 0) {
      // 한 장도 올라오지 않았다. 쪼개진 글을 붙여넣기 전의 모습으로 돌려놓는다.
      await restoreBase();
      return { ...result, reason: work.pasted > 0 ? 'no-upload' : 'nothing-pasted' };
    }

    // 붙여넣기 전의 문서에 사진만 끼워서 다시 넣는다.
    const data = JSON.parse(work.baseJson);
    const doc = unwrap(data);
    const comps: any[] = doc.components;
    const titleComp = comps.find((c) => c && c['@ctype'] === 'documentTitle') ?? null;
    const placement = placeImages(comps.filter((c) => c !== titleComp), uploaded, req.slots, newId);
    doc.components = [...(titleComp ? [titleComp] : []), ...placement.components];
    result.placed = placement.placed;
    result.emptySlots = placement.emptySlots;
    result.appended = placement.appended.length;

    try {
      const returned = ed.setDocumentData(data);
      if (returned && typeof returned.then === 'function') await returned;
    } catch (err) {
      await restoreBase();
      return { ...result, reason: 'set-failed: ' + errorText(err) };
    }
    await sleep(500);

    // 넣은 사진이 문서에 그대로 있는지 다시 읽어 확인한다.
    const wanted = new Set(uploaded.map((image) => String(image.src)));
    result.foundAfter = allImages(readComponents(ed)).filter((image) => wanted.has(String(image.src))).length;
    result.ok = result.foundAfter === uploaded.length;
    result.reason = result.ok ? null : 'mismatch';
    return result;
  }

  /** 사진 넣기를 그만두고, 붙여넣기 전의 문서로 돌려놓는다. */
  async function imagesCancel(): Promise<{ ok: boolean; reason: string | null }> {
    const work = imageWork;
    const hit = findEditor();
    imageWork = null;
    if (!work) return { ok: true, reason: null };
    if (!hit) return { ok: false, reason: 'no-editor' };
    try {
      const returned = hit.editor.setDocumentData(JSON.parse(work.baseJson));
      if (returned && typeof returned.then === 'function') await returned;
    } catch (err) {
      return { ok: false, reason: 'set-failed: ' + errorText(err) };
    }
    return { ok: true, reason: null };
  }

  w.__blogStudioEditor = { version: BRIDGE_VERSION, probe, fill, restore, imagesBegin, imagePaste, imagesFinish, imagesCancel };
});
