// 실행: npm test  (Node 24 가 .ts 파일을 바로 돌린다)
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseInline, parseMarkup } from '../lib/blocks/parse-markup.ts';
import { buildComponents, flattenText } from '../lib/editor/build.ts';
import { contrastRatio, DEFAULT_PALETTE, normalizeHex, readableOnWhite, resolvePalette } from '../lib/color.ts';

const here = dirname(fileURLToPath(import.meta.url));

const BODY = `[h2]큰 소제목[/h2]
보통 글 [bold]굵게[/bold] [italic]기울임[/italic] [underline]밑줄[/underline] 끝
둘째 문단

### 작은 소제목
[quote]기본[/quote]
[quote2]라인[/quote2]
[quote3]말풍선[/quote3]
[hr]
[center]가운데[/center]
앞글 [right]오른쪽[/right] 뒷글
[hr2]
| 구분 | 내용 |
|---|---|
| 첫째 | 값 |
| 둘째 | |
---
[IMG: 섹션1 - 설명 글]
[img_placeholder: 아직]
**마크다운 굵게** 와 보통`;

test('마크업을 블록으로 나눈다', () => {
  const { blocks, warnings } = parseMarkup(BODY);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    [
      'heading', 'paragraph', 'paragraph', 'paragraph', 'heading',
      'quote', 'quote', 'quote', 'divider',
      'paragraph', 'paragraph', 'paragraph', 'paragraph',
      'divider', 'table', 'divider', 'image', 'paragraph',
    ],
  );
  assert.deepEqual(blocks[0], { kind: 'heading', level: 2, text: '큰 소제목' });
  assert.deepEqual(blocks[4], { kind: 'heading', level: 3, text: '작은 소제목' });
  assert.deepEqual(blocks[1], {
    kind: 'paragraph',
    runs: [
      { text: '보통 글 ' },
      { text: '굵게', bold: true },
      { text: ' ' },
      { text: '기울임', italic: true },
      { text: ' ' },
      { text: '밑줄', underline: true },
      { text: ' 끝' },
    ],
  });
  assert.deepEqual(blocks[3], { kind: 'paragraph', runs: [] }, '빈 줄은 빈 문단');
  assert.deepEqual(blocks.slice(5, 8).map((b) => (b.kind === 'quote' ? b.style : 0)), [1, 2, 3]);
  assert.deepEqual(blocks[9], { kind: 'paragraph', runs: [{ text: '가운데' }], align: 'center' });
  assert.deepEqual(blocks[10], { kind: 'paragraph', runs: [{ text: '앞글' }] });
  assert.deepEqual(blocks[11], { kind: 'paragraph', runs: [{ text: '오른쪽' }], align: 'right' });
  assert.deepEqual(blocks[13], { kind: 'divider', style: 2 });
  assert.deepEqual(blocks[14], {
    kind: 'table',
    rows: [['구분', '내용'], ['첫째', '값'], ['둘째', '']],
    headerRow: true,
  });
  assert.deepEqual(blocks[16], { kind: 'image', slot: '섹션1', alt: '설명 글' });
  assert.deepEqual(blocks[17], { kind: 'paragraph', runs: [{ text: '마크다운 굵게', bold: true }, { text: ' 와 보통' }] });
});

test('짝이 맞지 않는 태그는 지우고 알려 준다', () => {
  const warnings: string[] = [];
  const runs = parseInline('앞 [/h2] 뒤', warnings);
  assert.deepEqual(runs, [{ text: '앞  뒤' }]);
  assert.equal(warnings.length, 1);
});

test('블록을 에디터 부품으로 바꾼다', () => {
  const comps = buildComponents(parseMarkup(BODY).blocks, DEFAULT_PALETTE);
  assert.deepEqual(
    comps.map((c) => `${c['@ctype']}/${c.layout}`),
    [
      'text/default',
      'quotation/default', 'quotation/quotation_line', 'quotation/quotation_bubble',
      'horizontalLine/default',
      'text/default',
      'horizontalLine/line1',
      'table/default',
      'horizontalLine/default',
      'text/default',
    ],
  );

  // 연달아 나온 소제목과 문단은 한 부품에 모인다.
  const first = comps[0] as { value: any[] };
  assert.equal(first.value.length, 5);
  assert.deepEqual(first.value[0].nodes[0], {
    value: '큰 소제목',
    style: { fontSizeCode: 'fs24', bold: true, '@ctype': 'nodeStyle' },
    '@ctype': 'textNode',
  });
  assert.deepEqual(first.value[1].nodes[1], { value: '굵게', style: { bold: true, '@ctype': 'nodeStyle' }, '@ctype': 'textNode' });
  assert.deepEqual(first.value[1].nodes[0], { value: '보통 글 ', '@ctype': 'textNode' }, '꾸밈이 없으면 style 이 없다');
  assert.deepEqual(first.value[3], { nodes: [{ value: '', '@ctype': 'textNode' }], '@ctype': 'paragraph' }, '빈 문단');
  assert.equal(first.value[4].nodes[0].style.fontSizeCode, 'fs19');

  const aligned = comps[5] as { value: any[] };
  assert.deepEqual(aligned.value[0].style, { align: 'center', '@ctype': 'paragraphStyle' });
  assert.equal(aligned.value[1].style, undefined, '왼쪽 정렬은 style 이 없다');
  assert.deepEqual(aligned.value[2].style, { align: 'right', '@ctype': 'paragraphStyle' });

  const table = comps[7] as { rows: any[]; columnCount: number };
  assert.equal(table.columnCount, 2);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[0].cells[0].width, 50);
  assert.equal(table.rows[0].cells[0].value[0].nodes[0].style.bold, true, '머리 줄은 굵게');
  assert.equal(table.rows[1].cells[0].value[0].nodes[0].style, undefined);
  assert.equal(table.rows[2].cells[1].value, null, '빈 칸은 null');

  assert.equal(flattenText(comps[9]), '[이미지 자리: 섹션1 - 설명 글]마크다운 굵게 와 보통');
  assert.ok(!JSON.stringify(comps).includes('"id"'), '여기서는 id 를 붙이지 않는다');
});

// 내 에디터에서 읽은 견본과 모양이 같은지 견준다. 견본 파일은 git 에 없으니, 없으면 건너뛴다.
const fixtureDir = join(here, '..', 'fixtures');
const sampleFiles = existsSync(fixtureDir)
  ? readdirSync(fixtureDir).filter((f) => /^editor-sample-.*\.json$/.test(f)).sort()
  : [];

test('만든 부품의 칸이 견본과 같다', { skip: sampleFiles.length ? false : '견본 파일이 없어요' }, () => {
  // 견본이 여러 개면 모두 합쳐서 본다.
  const sampleComps: any[] = sampleFiles.flatMap(
    (f) => JSON.parse(readFileSync(join(fixtureDir, f), 'utf8')).document.document.components,
  );
  const built: any[] = buildComponents(parseMarkup(BODY).blocks, DEFAULT_PALETTE);
  const keysOf = (o: any) => Object.keys(o).filter((k) => k !== 'id').sort();

  for (const ctype of ['text', 'quotation', 'horizontalLine', 'table']) {
    const mine = built.find((c) => c['@ctype'] === ctype);
    const theirs = sampleComps.find((c) => c['@ctype'] === ctype);
    assert.ok(mine && theirs, `${ctype} 부품이 양쪽에 있어야 한다`);
    assert.deepEqual(keysOf(mine), keysOf(theirs), `${ctype} 의 칸`);
  }

  // 문단, 글자 조각, 꾸밈의 칸은 견본에 나온 것만 쓴다.
  const seen = { paragraph: new Set<string>(), textNode: new Set<string>(), nodeStyle: new Set<string>(), paragraphStyle: new Set<string>(), tableCell: new Set<string>(), tableRow: new Set<string>() };
  const walk = (node: any, into: typeof seen) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, into));
    if (!node || typeof node !== 'object') return;
    const bucket = (into as any)[node['@ctype']] as Set<string> | undefined;
    if (bucket) Object.keys(node).filter((k) => k !== 'id').forEach((k) => bucket.add(k));
    Object.values(node).forEach((v) => walk(v, into));
  };
  walk(sampleComps, seen);
  const mine = { paragraph: new Set<string>(), textNode: new Set<string>(), nodeStyle: new Set<string>(), paragraphStyle: new Set<string>(), tableCell: new Set<string>(), tableRow: new Set<string>() };
  walk(built, mine);
  for (const kind of Object.keys(mine) as (keyof typeof mine)[]) {
    for (const key of mine[kind]) {
      assert.ok(seen[kind].has(key), `${kind} 에 견본에 없는 칸을 썼다: ${key}`);
    }
  }

  // 인용구와 구분선의 모양 이름도 견본에 나온 것이어야 한다.
  const layouts = (ctype: string, list: any[]) => new Set(list.filter((c) => c['@ctype'] === ctype).map((c) => c.layout));
  for (const ctype of ['quotation', 'horizontalLine']) {
    for (const layout of layouts(ctype, built)) {
      assert.ok(layouts(ctype, sampleComps).has(layout), `${ctype} 모양 ${layout} 이 견본에 없다`);
    }
  }
});

test('색 강조: 뜻을 읽고 설정의 색으로 바꾼다', () => {
  const { blocks, warnings } = parseMarkup('[pos]좋은 점[/pos]과 [neg]주의할 점[/neg], 그리고 [mark]꼭 기억[/mark]할 것\n[quote][neg]불가[/neg]합니다[/quote]');
  assert.deepEqual(warnings, []);
  assert.deepEqual(blocks[0], {
    kind: 'paragraph',
    runs: [
      { text: '좋은 점', tone: 'positive' },
      { text: '과 ' },
      { text: '주의할 점', tone: 'negative' },
      { text: ', 그리고 ' },
      { text: '꼭 기억', highlight: true },
      { text: '할 것' },
    ],
  });
  const palette = { positive: '#0a7d4f', negative: '#cc0000', highlight: '#ffee99' };
  const comps: any[] = buildComponents(blocks, palette);
  const nodes = comps[0].value[0].nodes;
  assert.deepEqual(nodes[0].style, { fontColor: '#0a7d4f', bold: true, '@ctype': 'nodeStyle' }, '색 강조는 굵게와 같이');
  assert.deepEqual(nodes[2].style, { fontColor: '#cc0000', bold: true, '@ctype': 'nodeStyle' });
  assert.deepEqual(nodes[4].style, { backgroundColor: '#ffee99', '@ctype': 'nodeStyle' }, '형광펜은 굵게를 더하지 않는다');
  assert.equal(nodes[1].style, undefined);
  assert.equal(comps[1].value[0].nodes[0].style.fontColor, '#cc0000', '인용구 안에서도 된다');
});

test('색 도우미', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('1E3A8A'), '#1e3a8a');
  assert.equal(normalizeHex('빨강'), null);
  assert.deepEqual(resolvePalette({ positive: '#00FF00', negative: 12 as unknown as string }), {
    positive: '#00ff00',
    negative: DEFAULT_PALETTE.negative,
    highlight: DEFAULT_PALETTE.highlight,
  });
  assert.deepEqual(resolvePalette(undefined), DEFAULT_PALETTE);
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(readableOnWhite(DEFAULT_PALETTE.positive).ok, true);
  assert.equal(readableOnWhite(DEFAULT_PALETTE.negative).ok, true);
  assert.equal(readableOnWhite('#ffe600').ok, false, '밝은 노랑은 글자색으로 읽기 어렵다');
});
