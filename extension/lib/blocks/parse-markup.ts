import type { Block, ParsedBody, Run, Tone } from './types';

/**
 * blog_studio 본문 마크업 → 블록 목록.
 *
 * 규칙은 `local_agent/lib/naver_editor.py`의 parse_content 와 같게 맞췄다 (한 줄씩 본다).
 * 거기에 없던 것 두 가지를 더했다: 마크다운 표, 그리고 `[IMG: 자리 - 설명]` 이미지 자리.
 *
 * 임시 위치다. 설계 문서의 G0 단계에서 `web/lib/core/`로 옮겨 웹과 같이 쓴다.
 * 이 파일은 다른 파일의 값을 가져다 쓰지 않는다 (타입만 가져온다).
 */

const INLINE_TOKEN = /(\[\/?(?:bold|italic|underline|pos|neg|mark)\]|\*\*)/;
const LEFTOVER_TAG = /\[\/?(?:h2|h3|bold|italic|underline|pos|neg|mark|quote\d*|center|right|img|hr\d*)\]/g;

/**
 * 한 줄 안의 꾸밈을 글자 조각으로 나눈다.
 * 굵게·기울임·밑줄, 그리고 색 강조: [pos] 긍정, [neg] 부정, [mark] 형광펜.
 * 색 강조는 뜻만 적는다. 실제 색은 채울 때 설정에서 가져온다.
 */
export function parseInline(text: string, warnings: string[] = []): Run[] {
  const runs: Run[] = [];
  const active: { bold: boolean; italic: boolean; underline: boolean; tone: Tone | null; highlight: boolean } = {
    bold: false,
    italic: false,
    underline: false,
    tone: null,
    highlight: false,
  };
  for (const part of text.split(INLINE_TOKEN)) {
    if (!part) continue;
    if (part === '**') active.bold = !active.bold;
    else if (part === '[bold]') active.bold = true;
    else if (part === '[/bold]') active.bold = false;
    else if (part === '[italic]') active.italic = true;
    else if (part === '[/italic]') active.italic = false;
    else if (part === '[underline]') active.underline = true;
    else if (part === '[/underline]') active.underline = false;
    else if (part === '[pos]') active.tone = 'positive';
    else if (part === '[neg]') active.tone = 'negative';
    else if (part === '[/pos]' || part === '[/neg]') active.tone = null;
    else if (part === '[mark]') active.highlight = true;
    else if (part === '[/mark]') active.highlight = false;
    else {
      let value = part;
      if (LEFTOVER_TAG.test(value)) {
        warnings.push(`짝이 맞지 않는 태그를 지웠어요: ${(value.match(LEFTOVER_TAG) ?? []).join(' ')}`);
        value = value.replace(LEFTOVER_TAG, '');
      }
      LEFTOVER_TAG.lastIndex = 0;
      if (!value) continue;
      const run: Run = { text: value };
      if (active.bold) run.bold = true;
      if (active.italic) run.italic = true;
      if (active.underline) run.underline = true;
      if (active.tone) run.tone = active.tone;
      if (active.highlight) run.highlight = true;
      runs.push(run);
    }
  }
  return runs;
}

function isTableLine(line: string): boolean {
  return /^\|.*\|$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim().replace(/\*\*/g, '').replace(LEFTOVER_TAG, ''));
}

function clampStyle(raw: string | undefined, max: number): number {
  const n = raw ? parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

export function parseMarkup(body: string): ParsedBody {
  const blocks: Block[] = [];
  const warnings: string[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');

  const pushText = (text: string, align?: 'center' | 'right') => {
    const runs = parseInline(text, warnings);
    if (runs.length === 0) return;
    blocks.push(align ? { kind: 'paragraph', runs, align } : { kind: 'paragraph', runs });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();

    // 빈 줄은 빈 문단이 된다 (에디터에서 한 줄 띄기).
    if (!line) {
      blocks.push({ kind: 'paragraph', runs: [] });
      continue;
    }

    // 이미지를 아직 만들지 못했다는 표시. 본문에 남기지 않는다.
    if (/^\[img_placeholder[^\]]*\]$/.test(line)) continue;

    // 이미지 자리: [IMG: 자리 - 설명]
    const slot = /^\[IMG:\s*([^\]]*)\]$/.exec(line);
    if (slot) {
      const [name, ...rest] = (slot[1] ?? '').split(' - ');
      blocks.push({ kind: 'image', slot: (name ?? '').trim() || '이미지', alt: rest.join(' - ').trim() });
      continue;
    }

    // 예전 방식의 이미지: [img]/내/컴퓨터/경로[/img]. 경로의 파일은 확장이 읽을 수 없다.
    const legacyImage = /^\[img\](.*?)\[\/img\]$/.exec(line);
    if (legacyImage) {
      const path = (legacyImage[1] ?? '').trim();
      blocks.push({ kind: 'image', slot: path.split('/').pop() || '이미지', alt: '' });
      warnings.push(`컴퓨터 경로로 적힌 이미지는 자리만 남겨요: ${path}`);
      continue;
    }

    // 구분선: [hr] [hr2] [hr3] …, 마크다운의 --- *** ___
    const hr = /^\[hr(\d*)\]$/.exec(line);
    if (hr) {
      blocks.push({ kind: 'divider', style: clampStyle(hr[1], 8) });
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(line)) {
      blocks.push({ kind: 'divider', style: 1 });
      continue;
    }

    // 소제목: [h2]…[/h2] [h3]…[/h3], 마크다운의 ## ###
    const h = /^\[h([23])\](.*?)\[\/h[23]\]$/.exec(line);
    if (h) {
      const text = (h[2] ?? '').trim();
      if (text) blocks.push({ kind: 'heading', level: h[1] === '2' ? 2 : 3, text });
      continue;
    }
    const md = /^(#{2,6})\s+(.*)$/.exec(line);
    if (md) {
      const text = (md[2] ?? '').replace(/\*\*/g, '').trim();
      if (text) blocks.push({ kind: 'heading', level: (md[1] ?? '').length === 2 ? 2 : 3, text });
      continue;
    }

    // 마크다운 표: |로 시작해서 |로 끝나는 줄이 이어진 것
    if (isTableLine(line)) {
      const rows: string[][] = [];
      let headerRow = false;
      let j = i;
      while (j < lines.length && isTableLine((lines[j] ?? '').trim())) {
        const current = (lines[j] ?? '').trim();
        if (isTableSeparator(current)) {
          if (rows.length === 1) headerRow = true;
        } else {
          rows.push(splitTableRow(current));
        }
        j += 1;
      }
      i = j - 1;
      if (rows.length > 0) {
        const width = Math.max(...rows.map((r) => r.length));
        blocks.push({
          kind: 'table',
          rows: rows.map((r) => [...r, ...new Array<string>(width - r.length).fill('')]),
          headerRow,
        });
      }
      continue;
    }

    // 가운데·오른쪽 정렬: 줄 어디에 있든 앞뒤 글과 나눈다.
    const align = /\[(center|right)\](.*?)\[\/\1\]/.exec(line);
    if (align) {
      pushText(line.slice(0, align.index).trim());
      pushText((align[2] ?? '').trim(), align[1] === 'center' ? 'center' : 'right');
      pushText(line.slice(align.index + align[0].length).trim());
      continue;
    }

    // 인용구: [quote]…[/quote] [quote2] [quote3] …
    const quote = /\[quote(\d*)\](.*?)\[\/quote\d*\]/.exec(line);
    if (quote) {
      pushText(line.slice(0, quote.index).trim());
      const runs = parseInline((quote[2] ?? '').trim(), warnings);
      if (runs.length) blocks.push({ kind: 'quote', style: clampStyle(quote[1], 6), runs });
      pushText(line.slice(quote.index + quote[0].length).trim());
      continue;
    }

    pushText(line);
  }

  // 맨 앞과 맨 뒤의 빈 문단은 뺀다.
  const isBlank = (b: Block | undefined) => !!b && b.kind === 'paragraph' && b.runs.length === 0;
  while (isBlank(blocks[0])) blocks.shift();
  while (isBlank(blocks[blocks.length - 1])) blocks.pop();

  return { blocks, warnings: [...new Set(warnings)] };
}
