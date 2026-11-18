// 카드를 그릴 때 쓰는 도구: 색 섞기, 줄바꿈, 숫자 찾기, 글 덩어리를 재고 그리기.
// mixColor, wrapText, splitNumbers, sectionNumber 는 값만 다뤄서 화면 없이도 시험할 수 있다.
// 나머지는 캔버스가 있어야 한다.

/** 두 색을 섞는다. ratio 가 0 이면 a, 1 이면 b */
export function mixColor(a: string, b: string, ratio: number): string {
  const parse = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const n = parseInt(m ? (m[1] as string) : '000000', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = parse(a) as [number, number, number];
  const [br, bg, bb] = parse(b) as [number, number, number];
  const mix = (x: number, y: number) => Math.round(x + (y - x) * ratio).toString(16).padStart(2, '0');
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

/**
 * 글을 정해진 너비 안에서 여러 줄로 나눈다. 한국어 글이 낱말 가운데에서 잘리지 않게 빈칸에서 나눈다.
 * 낱말 하나가 너비보다 길면 그 낱말만 글자 단위로 나눈다. 줄바꿈 글자는 그대로 지킨다.
 */
export function wrapText(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      // 낱말 하나가 너무 길면 글자 단위로 나눈다.
      let piece = '';
      for (const ch of word) {
        if (piece && measure(piece + ch) > maxWidth) {
          lines.push(piece);
          piece = ch;
        } else {
          piece += ch;
        }
      }
      line = piece;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** 강조해도 되는 숫자들. null 이면 가리지 않고 모든 숫자를 강조한다 */
export type KnownNumbers = ReadonlySet<string> | null;

export interface Segment {
  text: string;
  strong: boolean;
}

// 숫자와, 바로 붙은 단위까지 ("5,000만 원", "10년", "3.5%")
const NUMBER = /\d+(?:[,.]\d+)*(?:\s?(?:천만|백만|만|억|조|천|백))?(?:\s?(?:원|%|퍼센트|년|개월|월|일|명|개|배|회|세|건|가지|시간|분|위|차))?/g;

/**
 * 한 줄을 "숫자"와 "나머지"로 나눈다. 카드에서 숫자를 눈에 띄게 하려고 쓴다.
 * known 이 있으면 그 안에 있는 숫자만 강조한다. 본문에 없는 숫자를 돋보이게 하지 않으려는 것이다.
 */
export function splitNumbers(line: string, known: KnownNumbers): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of line.matchAll(NUMBER)) {
    const index = match.index ?? 0;
    const digits = /^\d+(?:[,.]\d+)*/.exec(match[0])?.[0] ?? '';
    if (known && !known.has(digits.replace(/,/g, ''))) continue;
    if (index > last) out.push({ text: line.slice(last, index), strong: false });
    out.push({ text: match[0], strong: true });
    last = index + match[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), strong: false });
  return out.length > 0 ? out : [{ text: line, strong: false }];
}

/** "POINT 01" 에서 "01" 을 꺼낸다. 번호가 없으면 빈 글 */
export function sectionNumber(label: string): string {
  return /(\d+)\s*$/.exec(label.trim())?.[1] ?? '';
}

export interface Block {
  text: string;
  size: number;
  weight: number;
  color: string;
  lineHeight: number;
  spacing?: number;
  alpha?: number;
  /** 아래쪽 여백 */
  gap: number;
  /** 글 아래에 긋는 줄 */
  rule?: { thickness: number; gap: number; color: string };
  align?: 'left' | 'center';
  /** 숫자를 눈에 띄게: 글자색을 바꾸거나(color) 형광펜을 긋는다(marker) */
  emphasis?: { color?: string; marker?: string };
  /** 줄마다 글자 아래쪽에 까는 색 띠 (형광펜으로 그은 제목) */
  underlay?: string;
}

export interface Measured {
  block: Block;
  lines: string[];
  height: number;
}

type Ctx = CanvasRenderingContext2D;

export function measureBlocks(ctx: Ctx, blocks: Block[], width: number, k: number, family: string): Measured[] {
  return blocks
    .filter((block) => block.text.trim())
    .map((block) => {
      const px = block.size * k;
      ctx.font = `${block.weight} ${px}px ${family}`;
      ctx.letterSpacing = `${(block.spacing ?? 0) * k}px`;
      const lines = wrapText((text) => ctx.measureText(text).width, block.text, width);
      const rule = block.rule ? (block.rule.gap + block.rule.thickness) * k : 0;
      return { block, lines, height: lines.length * px * block.lineHeight + rule + block.gap * k };
    });
}

export const totalHeight = (items: Measured[]): number => items.reduce((sum, item) => sum + item.height, 0);

function drawLine(ctx: Ctx, line: string, x: number, middle: number, width: number, px: number, block: Block, known: KnownNumbers): void {
  if (!block.align && !block.emphasis && !block.underlay) {
    ctx.fillStyle = block.color;
    ctx.fillText(line, x, middle);
    return;
  }
  const lineWidth = ctx.measureText(line).width;
  let cx = block.align === 'center' ? x + (width - lineWidth) / 2 : x;
  if (block.underlay && line.trim()) {
    ctx.fillStyle = block.underlay;
    ctx.fillRect(cx - px * 0.08, middle + px * 0.02, lineWidth + px * 0.16, px * 0.46);
  }
  if (!block.emphasis) {
    ctx.fillStyle = block.color;
    ctx.fillText(line, cx, middle);
    return;
  }
  for (const segment of splitNumbers(line, known)) {
    const w = ctx.measureText(segment.text).width;
    if (segment.strong && block.emphasis.marker) {
      ctx.fillStyle = block.emphasis.marker;
      ctx.fillRect(cx - px * 0.05, middle - px * 0.04, w + px * 0.1, px * 0.52);
    }
    ctx.fillStyle = segment.strong && block.emphasis.color ? block.emphasis.color : block.color;
    ctx.fillText(segment.text, cx, middle);
    cx += w;
  }
}

export function drawBlocks(ctx: Ctx, items: Measured[], x: number, y: number, width: number, k: number, family: string, known: KnownNumbers = null): number {
  let top = y;
  for (const { block, lines } of items) {
    const px = block.size * k;
    const lineBox = px * block.lineHeight;
    ctx.font = `${block.weight} ${px}px ${family}`;
    ctx.letterSpacing = `${(block.spacing ?? 0) * k}px`;
    ctx.globalAlpha = block.alpha ?? 1;
    ctx.textBaseline = 'middle';
    for (const line of lines) {
      drawLine(ctx, line, x, top + lineBox / 2, width, px, block, known);
      top += lineBox;
    }
    ctx.globalAlpha = 1;
    if (block.rule) {
      top += block.rule.gap * k;
      ctx.fillStyle = block.rule.color;
      ctx.fillRect(x, top, width, block.rule.thickness * k);
      top += block.rule.thickness * k;
    }
    top += block.gap * k;
  }
  ctx.letterSpacing = '0px';
  return top;
}

/** 글이 정해진 높이에 들어갈 때까지 글자 크기를 조금씩 줄인다 */
export function fit(ctx: Ctx, blocks: Block[], width: number, maxHeight: number, base: number, family: string): { items: Measured[]; k: number } {
  let k = base;
  let items = measureBlocks(ctx, blocks, width, k, family);
  for (let step = 0; step < 14 && totalHeight(items) > maxHeight; step += 1) {
    k *= 0.94;
    items = measureBlocks(ctx, blocks, width, k, family);
  }
  return { items, k };
}

// ── 쌓기: 글, 알약 모양 딱지, 줄, 상자를 위에서 아래로 쌓는다 ──

/** 글 한 덩어리. indent 만큼 들여 쓰고, bullet 이 있으면 그 자리에 체크 표시를 그린다 */
export type TextItem = { kind: 'text'; indent?: number; bullet?: string } & Block;
export interface PillItem {
  kind: 'pill';
  text: string;
  size: number;
  weight: number;
  color: string;
  fill: string;
  padX: number;
  padY: number;
  spacing?: number;
  gap: number;
  align?: 'left' | 'center';
}
export interface RuleItem {
  kind: 'rule';
  /** 줄의 길이. 없으면 끝까지 */
  width?: number;
  thickness: number;
  color: string;
  gap: number;
  align?: 'left' | 'center';
}
export interface BoxItem {
  kind: 'box';
  blocks: Block[];
  fill: string;
  /** 왼쪽에 세우는 색 막대 */
  bar?: string;
  radius?: number;
  padX: number;
  padY: number;
  gap: number;
}
export type Item = TextItem | PillItem | RuleItem | BoxItem;

export const text = (value: string, size: number, weight: number, color: string, more: Partial<TextItem> = {}): TextItem => ({
  kind: 'text',
  text: value,
  size,
  weight,
  color,
  lineHeight: 1.4,
  gap: 0,
  ...more,
});

interface Part {
  item: Item;
  inner: Measured[];
  /** 아래 여백을 뺀 높이 */
  height: number;
  gap: number;
  /** 알약 딱지의 너비 */
  width: number;
}

export interface Stack {
  parts: Part[];
  /** 마지막 덩어리의 아래 여백은 빼고 센 높이 */
  height: number;
}

const BAR_WIDTH = 10;

export function measureStack(ctx: Ctx, items: Item[], width: number, k: number, family: string): Stack {
  const parts: Part[] = [];
  for (const item of items) {
    if (item.kind === 'text') {
      const inner = measureBlocks(ctx, [item], width - (item.indent ?? 0) * k, k, family);
      if (inner.length === 0) continue;
      parts.push({ item, inner, height: totalHeight(inner) - item.gap * k, gap: item.gap * k, width: 0 });
    } else if (item.kind === 'pill') {
      if (!item.text.trim()) continue;
      ctx.font = `${item.weight} ${item.size * k}px ${family}`;
      ctx.letterSpacing = `${(item.spacing ?? 0) * k}px`;
      const textWidth = ctx.measureText(item.text).width;
      ctx.letterSpacing = '0px';
      parts.push({ item, inner: [], height: (item.size * 1.2 + item.padY * 2) * k, gap: item.gap * k, width: textWidth + item.padX * 2 * k });
    } else if (item.kind === 'rule') {
      parts.push({ item, inner: [], height: item.thickness * k, gap: item.gap * k, width: 0 });
    } else {
      const innerWidth = width - item.padX * 2 * k - (item.bar ? BAR_WIDTH * k : 0);
      const inner = measureBlocks(ctx, item.blocks, innerWidth, k, family);
      if (inner.length === 0) continue;
      const last = inner[inner.length - 1] as Measured;
      parts.push({ item, inner, height: totalHeight(inner) - last.block.gap * k + item.padY * 2 * k, gap: item.gap * k, width: 0 });
    }
  }
  const height = parts.reduce((sum, part, i) => sum + part.height + (i < parts.length - 1 ? part.gap : 0), 0);
  return { parts, height };
}

export function fitStack(ctx: Ctx, items: Item[], width: number, maxHeight: number, base: number, family: string): { stack: Stack; k: number } {
  let k = base;
  let stack = measureStack(ctx, items, width, k, family);
  for (let step = 0; step < 14 && stack.height > maxHeight; step += 1) {
    k *= 0.94;
    stack = measureStack(ctx, items, width, k, family);
  }
  return { stack, k };
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 동그라미 안의 체크 표시 */
function drawCheck(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.24;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.12, cy + r * 0.36);
  ctx.lineTo(cx + r * 0.48, cy - r * 0.32);
  ctx.stroke();
}

export function drawStack(ctx: Ctx, stack: Stack, x: number, y: number, width: number, k: number, family: string, known: KnownNumbers = null): number {
  let top = y;
  for (const part of stack.parts) {
    const { item } = part;
    if (item.kind === 'text') {
      const indent = (item.indent ?? 0) * k;
      if (item.bullet) {
        const px = item.size * k;
        drawCheck(ctx, x + px * 0.5, top + (px * item.lineHeight) / 2, px * 0.44, item.bullet);
      }
      drawBlocks(ctx, part.inner, x + indent, top, width - indent, k, family, known);
    } else if (item.kind === 'pill') {
      const left = item.align === 'center' ? x + (width - part.width) / 2 : x;
      ctx.fillStyle = item.fill;
      roundRect(ctx, left, top, part.width, part.height, part.height / 2);
      ctx.fill();
      ctx.font = `${item.weight} ${item.size * k}px ${family}`;
      ctx.letterSpacing = `${(item.spacing ?? 0) * k}px`;
      ctx.fillStyle = item.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, left + item.padX * k, top + part.height / 2);
      ctx.letterSpacing = '0px';
    } else if (item.kind === 'rule') {
      const length = item.width === undefined ? width : Math.min(width, item.width * k);
      const left = item.align === 'center' ? x + (width - length) / 2 : x;
      ctx.fillStyle = item.color;
      ctx.fillRect(left, top, length, part.height);
    } else {
      const bar = item.bar ? BAR_WIDTH * k : 0;
      ctx.fillStyle = item.fill;
      roundRect(ctx, x, top, width, part.height, item.bar ? 0 : (item.radius ?? 0) * k);
      ctx.fill();
      if (item.bar) {
        ctx.fillStyle = item.bar;
        ctx.fillRect(x, top, bar, part.height);
      }
      drawBlocks(ctx, part.inner, x + bar + item.padX * k, top + item.padY * k, width - bar - item.padX * 2 * k, k, family, known);
    }
    top += part.height + part.gap;
  }
  return top;
}
