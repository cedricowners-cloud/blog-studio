// 빌드한 editor-bridge.js 를 가짜 글쓰기 화면에서 돌려 본다. 먼저 npm run build 가 필요하다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseMarkup } from '../lib/blocks/parse-markup.ts';
import { buildComponents } from '../lib/editor/build.ts';
import { DEFAULT_PALETTE } from '../lib/color.ts';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, '..', 'dist', 'chrome-mv3', 'editor-bridge.js');
const skip = existsSync(bundle) ? false : 'dist 가 없어요. npm run build 를 먼저 해 주세요';

const titleComp = (text: string) => ({
  id: 'SE-title', layout: 'default',
  title: [{ id: 'SE-p', nodes: [{ id: 'SE-n', value: text, '@ctype': 'textNode' }], '@ctype': 'paragraph' }],
  subTitle: null, align: 'left', '@ctype': 'documentTitle',
});
const emptyText = () => ({
  id: 'SE-empty', layout: 'default',
  value: [{ id: 'SE-ep', nodes: [{ id: 'SE-en', value: '', '@ctype': 'textNode' }], '@ctype': 'paragraph' }],
  '@ctype': 'text',
});

/** 진짜 에디터처럼 문서를 복사해서 주고받는 가짜 에디터 */
class FakeEditor {
  data: any;
  setCalls = 0;
  constructor(components: any[]) {
    this.data = { document: { version: '2.10.2', theme: 'default', language: 'ko-KR', id: 'doc', components, di: {} }, documentId: '' };
  }
  getDocumentData() {
    return JSON.parse(JSON.stringify(this.data));
  }
  setDocumentData(next: any) {
    this.setCalls += 1;
    this.data = JSON.parse(JSON.stringify(next));
  }
}

function load(editor: FakeEditor | null, popupText = '') {
  function SmartEditor() {}
  (SmartEditor as any)._editors = editor ? { blogpc001: editor } : {};
  const popup = { offsetParent: {}, innerText: popupText };
  const win: any = { SmartEditor };
  win.top = win;
  const context = {
    window: win,
    document: { querySelectorAll: (sel: string) => (popupText && sel.includes('popup') ? [popup] : []) },
    location: { href: 'https://blog.naver.com/someone/postwrite' },
    getComputedStyle: () => ({ position: 'static' }),
    crypto: globalThis.crypto,
    console, setTimeout, JSON, Object, Array, String, Set, Map, Math, Date, Promise,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(bundle, 'utf8'), context);
  return win;
}

const components = () => buildComponents(parseMarkup('[h2]소제목[/h2]\n문단 [bold]굵게[/bold] [pos]좋음[/pos] [neg]주의[/neg] [mark]기억[/mark]\n[quote2]인용[/quote2]\n[hr]\n| 가 | 나 |\n|---|---|\n| 1 | 2 |').blocks, DEFAULT_PALETTE);

test('빈 글쓰기 화면에 채우고, 넣은 것과 읽은 것이 같다', { skip }, async () => {
  const editor = new FakeEditor([titleComp(''), emptyText()]);
  const win = load(editor);
  const result = await win.__blogStudioEditor.fill({ title: '새 제목', components: components(), force: false });
  assert.equal(result.reason, null);
  assert.equal(result.ok, true);
  assert.equal(result.titleAfter, '새 제목');
  assert.equal(result.sentCount, 4);
  assert.equal(result.foundCount, 4);
  const body = editor.data.document.components.slice(1);
  assert.deepEqual(body.map((c: any) => c['@ctype']), ['text', 'quotation', 'horizontalLine', 'table']);
  // id 는 부품, 문단, 글자 조각, 표의 칸에 붙고 줄과 꾸밈에는 붙지 않는다.
  assert.match(body[0].id, /^SE-/);
  assert.match(body[0].value[0].id, /^SE-/);
  assert.match(body[0].value[0].nodes[0].id, /^SE-/);
  assert.equal(body[0].value[0].nodes[0].style.id, undefined);
  assert.equal(body[3].rows[0].id, undefined);
  assert.match(body[3].rows[0].cells[0].id, /^SE-/);
  assert.equal(new Set(JSON.stringify(body).match(/SE-[0-9a-f-]{36}/g)).size, JSON.stringify(body).match(/"id"/g)?.length, 'id 는 서로 달라야 한다');
  assert.equal(editor.data.document.version, '2.10.2', '문서의 다른 칸은 그대로 둔다');
});

test('이미 글이 있으면 묻기 전에는 넣지 않는다. 덮어쓴 뒤 되돌릴 수 있다', { skip }, async () => {
  const old = { id: 'SE-old', layout: 'default', value: [{ id: 'p', nodes: [{ id: 'n', value: '쓰던 글', '@ctype': 'textNode' }], '@ctype': 'paragraph' }], '@ctype': 'text' };
  const sticker = { id: 'SE-st', layout: 'default', '@ctype': 'sticker' };
  const editor = new FakeEditor([titleComp('쓰던 제목'), old, sticker]);
  const win = load(editor);

  const refused = await win.__blogStudioEditor.fill({ title: '새 제목', components: components(), force: false });
  assert.equal(refused.reason, 'not-empty');
  assert.equal(refused.existingChars, 3, '공백을 뺀 글자 수');
  assert.equal(editor.setCalls, 0, '묻기 전에는 건드리지 않는다');

  const forced = await win.__blogStudioEditor.fill({ title: '새 제목', components: components(), force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.kept, 1, '스티커 같은 특수 부품은 남긴다');
  assert.equal(editor.data.document.components.at(-1)['@ctype'], 'sticker');
  assert.ok(!JSON.stringify(editor.data).includes('쓰던 글'));

  const restored = await win.__blogStudioEditor.restore();
  assert.equal(restored.ok, true);
  assert.ok(JSON.stringify(editor.data).includes('쓰던 글'));
  assert.ok(JSON.stringify(editor.data).includes('쓰던 제목'));
});

test('제목을 주지 않으면 제목은 그대로 둔다', { skip }, async () => {
  const editor = new FakeEditor([titleComp('남길 제목'), emptyText()]);
  const win = load(editor);
  const result = await win.__blogStudioEditor.fill({ title: null, components: components(), force: false });
  assert.equal(result.ok, true);
  assert.equal(result.titleAfter, '남길 제목');
});

test('"작성 중인 글" 안내가 떠 있으면 멈춘다', { skip }, async () => {
  const editor = new FakeEditor([titleComp(''), emptyText()]);
  const win = load(editor, '작성 중인 글이 있습니다. 이어서 작성하시겠습니까?');
  const result = await win.__blogStudioEditor.fill({ title: '제목', components: components(), force: true });
  assert.equal(result.reason, 'draft-prompt');
  assert.equal(editor.setCalls, 0);
});

test('에디터가 넣은 글을 바꿔 버리면 다른 곳을 알려 준다', { skip }, async () => {
  class Lossy extends FakeEditor {
    override setDocumentData(next: any) {
      super.setDocumentData(next);
      this.data.document.components.splice(2, 1); // 인용구를 잃어버리는 에디터
    }
  }
  const editor = new Lossy([titleComp(''), emptyText()]);
  const win = load(editor);
  const result = await win.__blogStudioEditor.fill({ title: '제목', components: components(), force: false });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatch');
  assert.ok(result.mismatches.length >= 1);
});

test('넣다가 오류가 나면 넣기 전으로 돌려놓는다', { skip }, async () => {
  class Throwing extends FakeEditor {
    override setDocumentData(next: any) {
      if (this.setCalls === 0) {
        this.setCalls += 1;
        throw new Error('boom');
      }
      super.setDocumentData(next);
    }
  }
  const editor = new Throwing([titleComp('원래 제목'), emptyText()]);
  const win = load(editor);
  const result = await win.__blogStudioEditor.fill({ title: '제목', components: components(), force: false });
  assert.match(result.reason, /^set-failed: boom/);
  assert.ok(JSON.stringify(editor.data).includes('원래 제목'));
});

test('에디터가 없는 프레임에서는 아무것도 하지 않는다', { skip }, async () => {
  const win = load(null);
  const result = await win.__blogStudioEditor.fill({ title: '제목', components: components(), force: true });
  assert.equal(result.reason, 'no-editor');
  assert.equal((await win.__blogStudioEditor.restore()).reason, 'no-editor');
});

test('에디터가 색을 버리면 색이 저장되지 않았다고 알려 준다', { skip }, async () => {
  class DropsColor extends FakeEditor {
    override setDocumentData(next: any) {
      super.setDocumentData(next);
      const strip = (n: any) => {
        if (Array.isArray(n)) return n.forEach(strip);
        if (!n || typeof n !== 'object') return;
        if (n.style) {
          delete n.style.fontColor;
          delete n.style.backgroundColor;
        }
        Object.values(n).forEach(strip);
      };
      strip(this.data);
    }
  }
  const editor = new DropsColor([titleComp(''), emptyText()]);
  const win = load(editor);
  const result = await win.__blogStudioEditor.fill({ title: '제목', components: components(), force: false });
  assert.equal(result.ok, false);
  assert.equal(result.mismatches.length, 1);
  assert.match(result.mismatches[0].expected, /^색: fontColor=#1e3a8a, fontColor=#d92d20, backgroundColor=#fff3a3$/);
  assert.equal(result.mismatches[0].actual, '색: (없음)');
});

test('에디터가 색을 그대로 두면 통과한다 (대소문자는 따지지 않는다)', { skip }, async () => {
  class UpperCases extends FakeEditor {
    override setDocumentData(next: any) {
      super.setDocumentData(next);
      const upper = (n: any) => {
        if (Array.isArray(n)) return n.forEach(upper);
        if (!n || typeof n !== 'object') return;
        if (n.style && typeof n.style.fontColor === 'string') n.style.fontColor = n.style.fontColor.toUpperCase();
        Object.values(n).forEach(upper);
      };
      upper(this.data);
    }
  }
  const editor = new UpperCases([titleComp(''), emptyText()]);
  const win = load(editor);
  const result = await win.__blogStudioEditor.fill({ title: '제목', components: components(), force: false });
  assert.equal(result.ok, true);
});
