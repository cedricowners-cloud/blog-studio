// 사진을 본문의 이미지 자리에 끼워 넣는 계산과, 에디터 안에서 사진을 붙여넣는 흐름을 시험한다.
// 뒤쪽 시험은 빌드한 editor-bridge.js 를 가짜 글쓰기 화면에서 돌린다. 먼저 npm run build 가 필요하다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseMarkup } from '../lib/blocks/parse-markup.ts';
import { DEFAULT_PALETTE } from '../lib/color.ts';
import { buildComponents, imagePlaceholderText } from '../lib/editor/build.ts';
import { allImages, baseName, isUploaded, placeImages } from '../lib/editor/images.ts';

const body = (markup: string): any[] => buildComponents(parseMarkup(markup).blocks, DEFAULT_PALETTE).map((c, i) => ({ id: `SE-c${i}`, ...c }));
/** 가짜 화면(다른 실행 환경)에서 만든 값은 그대로 견줄 수 없다. 글자로 바꿨다가 되돌려서 견준다. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const photo = (fileName: string, over: Record<string, unknown> = {}) => ({
  id: 'SE-img-' + fileName,
  '@ctype': 'image',
  src: 'https://blogfiles.example/' + fileName,
  fileName,
  represent: false,
  ...over,
});
const texts = (components: any[]) =>
  components.map((c) => (c['@ctype'] === 'image' ? `<${c.fileName}>` : c['@ctype'] === 'text' ? c.value.map((p: any) => p.nodes.map((n: any) => n.value).join('')).join('|') : c['@ctype']));

let counter = 0;
const newId = () => `SE-new-${(counter += 1)}`;

const MARKUP = '첫 문단\n[IMG: 하나 - 첫 사진]\n가운데 문단\n둘째 줄\n[IMG: 둘]\n끝 문단\n[hr]\n[IMG: 셋 - 마지막]';
const SLOTS = [imagePlaceholderText('하나', '첫 사진'), imagePlaceholderText('둘', ''), imagePlaceholderText('셋', '마지막')];

test('사진 자리: 자리마다 사진을 끼우고, 글 덩어리는 그 앞뒤로 나눈다', () => {
  const base = body(MARKUP);
  assert.deepEqual(base.map((c) => c['@ctype']), ['text', 'horizontalLine', 'text']);

  const result = placeImages(
    base,
    [photo('b.png'), photo('a.jpg'), photo('c.jpg')],
    [
      { text: SLOTS[0] as string, fileName: 'a.jpg' },
      { text: SLOTS[1] as string, fileName: 'b.png' },
      { text: SLOTS[2] as string, fileName: 'c.jpg' },
    ],
    newId,
  );
  assert.deepEqual(texts(result.components), ['첫 문단', '<a.jpg>', '가운데 문단|둘째 줄', '<b.png>', '끝 문단', 'horizontalLine', '<c.jpg>']);
  assert.equal(result.placed, 3);
  assert.deepEqual(result.emptySlots, []);
  assert.deepEqual(result.appended, []);

  // 쪼갠 첫 조각은 원래 id, 나머지는 새 id. 겹치는 id 가 없다
  const ids = result.components.map((c) => c.id);
  assert.equal(ids[0], 'SE-c0');
  assert.equal(new Set(ids).size, ids.length);
  // 대표 사진은 글에서 가장 먼저 나오는 한 장
  assert.deepEqual(result.components.filter((c) => c['@ctype'] === 'image').map((c) => c.represent), [true, false, false]);
  // 원래 문서와 올라온 사진은 바뀌지 않는다
  assert.deepEqual(texts(base), [`첫 문단|${SLOTS[0]}|가운데 문단|둘째 줄|${SLOTS[1]}|끝 문단`, 'horizontalLine', SLOTS[2]]);
});

test('사진 자리: 사진이 없는 자리는 글자로 남기고, 무엇이 비었는지 알려 준다', () => {
  const result = placeImages(
    body(MARKUP),
    [photo('b.png')],
    [
      { text: SLOTS[0] as string, fileName: null },
      { text: SLOTS[1] as string, fileName: 'b.png' },
      { text: SLOTS[2] as string, fileName: 'c.jpg' }, // 골랐지만 올라오지 않은 사진
    ],
    newId,
  );
  assert.deepEqual(texts(result.components), [`첫 문단|${SLOTS[0]}|가운데 문단|둘째 줄`, '<b.png>', '끝 문단', 'horizontalLine', SLOTS[2]]);
  assert.equal(result.placed, 1);
  assert.deepEqual(result.emptySlots, [SLOTS[0], SLOTS[2]]);
});

test('사진 자리: 자리를 찾지 못한 사진은 버리지 않고 글 끝에 붙인다', () => {
  // 본문에는 자리가 없는데(글을 손으로 고친 경우) 사진은 올라왔다
  const result = placeImages(body('문단 하나\n문단 둘'), [photo('a.jpg'), photo('b.png')], [{ text: SLOTS[0] as string, fileName: 'a.jpg' }], newId);
  assert.deepEqual(texts(result.components), ['문단 하나|문단 둘', '<a.jpg>', '<b.png>']);
  assert.equal(result.placed, 0);
  assert.deepEqual(result.emptySlots, [SLOTS[0]]);
  assert.deepEqual(result.appended, ['a.jpg', 'b.png']);
});

test('사진 자리: 네이버가 확장자를 바꿔도 같은 사진으로 알아보고, 같은 글자의 자리는 순서대로 짝짓는다', () => {
  const same = imagePlaceholderText('사진', '');
  const result = placeImages(
    body('[IMG: 사진]\n사이 글\n[IMG: 사진]'),
    [photo('bs-1.jpeg'), photo('BS-2.JPG')],
    [
      { text: same, fileName: 'bs-1.png' },
      { text: same, fileName: 'bs-2.jpg' },
    ],
    newId,
  );
  assert.deepEqual(texts(result.components), ['<bs-1.jpeg>', '사이 글', '<BS-2.JPG>']);
  assert.equal(baseName('Photo.Final.JPG'), 'photo.final');
});

test('사진 자리: 묶음 안의 사진도 세고, 다 올라갔는지는 주소로 본다', () => {
  const comps = [photo('a.jpg'), { '@ctype': 'imageStrip', images: [photo('b.jpg'), photo('c.jpg', { src: 'blob:temp' })] }, { '@ctype': 'text', value: [] }];
  assert.deepEqual(allImages(comps).map((c) => c.fileName), ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.deepEqual(allImages(comps).map(isUploaded), [true, true, false]);
  assert.equal(isUploaded({ src: 'data:image/png;base64,AAAA' }), false);
  assert.equal(isUploaded({}), false);
});

// ───────────── 에디터 안에서 붙여넣기 (가짜 글쓰기 화면) ─────────────

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, '..', 'dist', 'chrome-mv3', 'editor-bridge.js');
const skip = existsSync(bundle) ? false : 'dist 가 없어요. npm run build 를 먼저 해 주세요';

const titleComp = () => ({
  id: 'SE-title', layout: 'default',
  title: [{ id: 'SE-p', nodes: [{ id: 'SE-n', value: '제목', '@ctype': 'textNode' }], '@ctype': 'paragraph' }],
  '@ctype': 'documentTitle',
});

/** 사진을 붙여넣으면 임시 주소의 사진 부품을 만들고, 조금 뒤에 진짜 주소로 바꾸는 가짜 에디터 */
class FakeEditor {
  data: any;
  pastes: string[] = [];
  /** 이 이름의 사진은 끝까지 올라가지 않는다 */
  neverUploads = new Set<string>();
  /** 붙여넣기를 아예 받지 않는다 */
  deaf = false;
  constructor(components: any[]) {
    this.data = { document: { version: '2.10.2', components }, documentId: '' };
  }
  getDocumentData() {
    return JSON.parse(JSON.stringify(this.data));
  }
  setDocumentData(next: any) {
    this.data = JSON.parse(JSON.stringify(next));
  }
  receivePaste(file: { name: string }) {
    if (this.deaf) return;
    this.pastes.push(file.name);
    const id = `SE-up-${this.pastes.length}`;
    const comps: any[] = this.data.document.components;
    // 진짜 에디터처럼 커서 자리의 글 덩어리를 망가뜨린다: 마지막 글 덩어리의 꾸밈을 지운다.
    const lastText = [...comps].reverse().find((c) => c['@ctype'] === 'text');
    if (lastText) for (const p of lastText.value) for (const n of p.nodes) delete n.style;
    comps.push({ id, '@ctype': 'image', src: 'blob:https://blog.naver.com/temp', fileName: file.name, represent: false, imageLoaded: false });
    if (this.neverUploads.has(file.name)) return;
    setTimeout(() => {
      const comp = this.data.document.components.find((c: any) => c.id === id);
      if (comp) Object.assign(comp, { src: 'https://blogfiles.example/' + file.name, path: '/x/' + file.name, domain: 'https://blogfiles.example' });
    }, 30);
  }
}

function load(editor: FakeEditor, options: { visible?: boolean; buffer?: boolean } = {}) {
  function SmartEditor() {}
  (SmartEditor as any)._editors = { blogpc001: editor };
  const target = { dispatchEvent: (event: any) => editor.receivePaste(event.clipboardData.files[0]) };
  const paragraph = {
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, height: 20 }),
    dispatchEvent() {},
  };
  class FakeTransfer {
    files: any[] = [];
    items = { add: (file: any) => void this.files.push(file) };
  }
  class FakeEvent {
    type: string;
    clipboardData: any;
    constructor(type: string, init: any = {}) {
      this.type = type;
      this.clipboardData = init.clipboardData;
    }
  }
  const win: any = {
    SmartEditor,
    File,
    atob,
    DataTransfer: FakeTransfer,
    ClipboardEvent: FakeEvent,
    PointerEvent: FakeEvent,
    MouseEvent: FakeEvent,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  };
  win.top = win;
  const hasBuffer = options.buffer !== false;
  const context = {
    window: win,
    document: {
      visibilityState: options.visible === false ? 'hidden' : 'visible',
      querySelector: (sel: string) => (hasBuffer && sel.includes('input_buffer') ? { contentDocument: { querySelector: () => target, body: target } } : null),
      querySelectorAll: (sel: string) => (sel === '.se-text-paragraph' ? [paragraph] : []),
      createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    },
    location: { href: 'https://blog.naver.com/someone/postwrite' },
    getComputedStyle: () => ({ position: 'static' }),
    crypto: globalThis.crypto,
    console, setTimeout, JSON, Object, Array, String, Set, Map, Math, Date, Promise, Uint8Array,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(bundle, 'utf8'), context);
  return win.__blogStudioEditor;
}

// 1×1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const filled = () => [titleComp(), ...body('[bold]굵은 첫 문단[/bold]\n[IMG: 하나 - 첫 사진]\n가운데 문단\n[IMG: 둘]\n끝 문단')];
const slotsFor = (first: string | null, second: string | null) => [
  { text: SLOTS[0] as string, fileName: first },
  { text: SLOTS[1] as string, fileName: second },
];

test('사진 넣기: 붙여넣어 올린 뒤, 붙여넣기 전의 글에 사진만 끼워 넣는다', { skip }, async () => {
  const editor = new FakeEditor(filled());
  const bridge = load(editor);

  const begin = bridge.imagesBegin();
  assert.deepEqual({ ok: begin.ok, target: begin.target, existing: begin.existing }, { ok: true, target: 'buffer', existing: 0 });
  assert.equal((await bridge.imagePaste({ name: 'bs-1.png', dataUrl: PNG })).appeared, true);
  assert.equal((await bridge.imagePaste({ name: 'bs-2.png', dataUrl: PNG })).appeared, true);
  assert.deepEqual(editor.pastes, ['bs-1.png', 'bs-2.png']);

  const result = await bridge.imagesFinish({ slots: slotsFor('bs-1.png', 'bs-2.png'), timeoutMs: 5000 });
  assert.equal(result.reason, null);
  assert.deepEqual(
    { ok: result.ok, pasted: result.pasted, uploaded: result.uploaded, placed: result.placed, appended: result.appended, foundAfter: result.foundAfter },
    { ok: true, pasted: 2, uploaded: 2, placed: 2, appended: 0, foundAfter: 2 },
  );

  const comps = editor.data.document.components;
  assert.deepEqual(texts(comps.slice(1)), ['굵은 첫 문단', '<bs-1.png>', '가운데 문단', '<bs-2.png>', '끝 문단']);
  assert.equal(comps[0]['@ctype'], 'documentTitle');
  // 붙여넣을 때 에디터가 지운 꾸밈이 되살아나 있다 (붙여넣기 전의 문서를 썼기 때문이다)
  assert.equal(comps[1].value[0].nodes[0].style.bold, true);
  // 사진은 네이버가 준 주소 그대로다
  assert.equal(comps[2].src, 'https://blogfiles.example/bs-1.png');
  assert.deepEqual([comps[2].represent, comps[4].represent], [true, false]);
});

test('사진 넣기: 올라가지 않은 사진의 자리는 글자로 남긴다', { skip }, async () => {
  const editor = new FakeEditor(filled());
  editor.neverUploads.add('bs-2.png');
  const bridge = load(editor);
  bridge.imagesBegin();
  await bridge.imagePaste({ name: 'bs-1.png', dataUrl: PNG });
  await bridge.imagePaste({ name: 'bs-2.png', dataUrl: PNG });
  const result = await bridge.imagesFinish({ slots: slotsFor('bs-1.png', 'bs-2.png'), timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.deepEqual({ uploaded: result.uploaded, placed: result.placed }, { uploaded: 1, placed: 1 });
  assert.deepEqual(plain(result.emptySlots), [SLOTS[1]]);
  // 올라가다 만 사진은 문서에 남기지 않는다
  assert.deepEqual(texts(editor.data.document.components.slice(1)), ['굵은 첫 문단', '<bs-1.png>', `가운데 문단|${SLOTS[1]}|끝 문단`]);
});

test('사진 넣기: 한 장도 올라가지 않으면 붙여넣기 전의 글로 돌려놓는다', { skip }, async () => {
  const editor = new FakeEditor(filled());
  const before = JSON.stringify(editor.data);
  editor.neverUploads.add('bs-1.png');
  const bridge = load(editor);
  bridge.imagesBegin();
  await bridge.imagePaste({ name: 'bs-1.png', dataUrl: PNG });
  assert.notEqual(JSON.stringify(editor.data), before);
  const result = await bridge.imagesFinish({ slots: slotsFor('bs-1.png', null), timeoutMs: 1000 });
  assert.equal(result.reason, 'no-upload');
  assert.equal(JSON.stringify(editor.data), before);
});

test('사진 넣기: 시작할 수 없는 때를 알려 준다', { skip }, async () => {
  assert.equal(load(new FakeEditor(filled()), { visible: false }).imagesBegin().reason, 'hidden');
  assert.equal(load(new FakeEditor(filled()), { buffer: false }).imagesBegin().reason, 'no-paste-target');
  // 시작하지 않고 붙여넣거나 끝내려고 하면
  const bridge = load(new FakeEditor(filled()));
  assert.equal((await bridge.imagePaste({ name: 'x.png', dataUrl: PNG })).reason, 'not-started');
  assert.equal((await bridge.imagesFinish({ slots: [], timeoutMs: 1000 })).reason, 'not-started');
  // 사진 데이터가 이상하면 붙여넣지 않는다
  bridge.imagesBegin();
  assert.match((await bridge.imagePaste({ name: 'x.png', dataUrl: '사진 아님' })).reason, /^paste-failed/);
});

test('사진 넣기: 그만두면 붙여넣기 전의 글로 돌아간다', { skip }, async () => {
  const editor = new FakeEditor(filled());
  const before = JSON.stringify(editor.data);
  const bridge = load(editor);
  bridge.imagesBegin();
  await bridge.imagePaste({ name: 'bs-1.png', dataUrl: PNG });
  assert.deepEqual(plain(await bridge.imagesCancel()), { ok: true, reason: null });
  assert.equal(JSON.stringify(editor.data), before);
  assert.equal((await bridge.imagesFinish({ slots: [], timeoutMs: 1000 })).reason, 'not-started');
});
