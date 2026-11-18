// 카드의 모양(디자인). 같은 내용을 여덟 가지 모양으로 그린다.
//   기본        : 웹의 카드(web/components/card-preview.tsx)와 같은 모양
//   잡지        : 큰 번호를 연하게 깔고, 핵심 문장을 색 상자에 넣는다
//   색 띠       : 위쪽을 브랜드 색으로 채우고 소제목을 흰 글자로 쓴다
//   부드러운 상자: 연한 바탕 위에 둥근 흰 상자
//   진한 바탕   : 어두운 바탕에 흰 글자
//   옆 번호     : 왼쪽에 색 기둥을 세우고 번호를 크게 쓴다
//   메모지      : 종이 색 바탕, 형광펜으로 그은 제목
//   가운데 정렬 : 글을 가운데로 모으고 핵심 문장을 크게 쓴다
// 모든 모양은 브랜드 색 하나에서 나머지 색을 만들어 쓴다. 글씨체 파일은 넣지 않는다.
import type { Card } from './parser.ts';
import {
  drawBlocks,
  drawStack,
  fit,
  fitStack,
  measureBlocks,
  measureStack,
  mixColor,
  roundRect,
  sectionNumber,
  text,
  totalHeight,
  type Block,
  type Item,
  type KnownNumbers,
  type Measured,
} from './draw.ts';

export type CardDesign = 'classic' | 'magazine' | 'band' | 'soft' | 'dark' | 'side' | 'note' | 'quote';

export const CARD_DESIGNS: Record<CardDesign, { label: string }> = {
  magazine: { label: '잡지' },
  band: { label: '색 띠' },
  soft: { label: '부드러운 상자' },
  dark: { label: '진한 바탕' },
  side: { label: '옆 번호' },
  note: { label: '메모지' },
  quote: { label: '가운데 정렬' },
  classic: { label: '기본' },
};

export const isCardDesign = (value: unknown): value is CardDesign => typeof value === 'string' && Object.hasOwn(CARD_DESIGNS, value);

export interface CardStyle {
  width: number;
  height: number;
  primary: string;
  primaryTo: string;
  background: string;
  textDark: string;
  textMuted: string;
  brandName: string;
  fontFamily: string;
  design: CardDesign;
}

export interface Env {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** 1080 을 기준으로 한 배율 */
  base: number;
  pad: number;
  inner: number;
  family: string;
  style: CardStyle;
  known: KnownNumbers;
}

type CoverCard = Extract<Card, { type: 'cover' }>;
type ContentCard = Extract<Card, { type: 'content' }>;

interface Design {
  cover(env: Env, card: CoverCard): void;
  content(env: Env, card: ContentCard): void;
}

const WHITE = '#ffffff';
const MARKER = '#fde68a';

function fillRect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** 위아래 사이의 가운데에 놓을 때의 시작 높이 */
const middle = (top: number, bottom: number, height: number): number => top + Math.max(0, (bottom - top - height) / 2);

/** 아래에 작게 쓰는 브랜드 이름 */
function brandLine(env: Env, color: string, width: number, more: Partial<Block> = {}): { items: Measured[]; height: number } {
  const { ctx, base, family, style } = env;
  if (!style.brandName) return { items: [], height: 0 };
  const items = measureBlocks(ctx, [{ text: style.brandName, size: 24, weight: 500, color, lineHeight: 1.3, spacing: 1, gap: 0, ...more }], width, base, family);
  return { items, height: totalHeight(items) };
}

/** 글 더미를 높이에 맞춰 줄이고, 위아래 가운데에 그린다 */
function centered(env: Env, items: Item[], x: number, width: number, top: number, bottom: number): void {
  const { ctx, base, family, known } = env;
  const { stack, k } = fitStack(ctx, items, width, bottom - top, base, family);
  drawStack(ctx, stack, x, middle(top, bottom, stack.height), width, k, family, known);
}

// ── 기본: 웹의 카드와 같은 모양. 목록 카드와 마무리 카드도 이 모양으로 그린다 ──

export function drawClassic(env: Env, card: Card): void {
  const { ctx, W, H, base, pad, inner, family, style } = env;

  if (card.type === 'cover' || card.type === 'closing') {
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, card.type === 'cover' ? style.primary : style.textDark);
    gradient.addColorStop(1, card.type === 'cover' ? style.primaryTo : mixColor(style.textDark, WHITE, 0.1));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    const head: Block[] = card.type === 'cover' ? [{ text: card.eyebrow, size: 36, weight: 600, color: WHITE, lineHeight: 1.2, spacing: 8, alpha: 0.9, gap: 0 }] : [];
    const foot: Block[] = [];
    if (card.type === 'cover' && card.sub_title) foot.push({ text: card.sub_title, size: 38, weight: 400, color: WHITE, lineHeight: 1.4, alpha: 0.85, gap: style.brandName ? 28 : 0 });
    if (card.type === 'closing') foot.push({ text: card.cta, size: 38, weight: 400, color: WHITE, lineHeight: 1.4, alpha: 0.85, gap: style.brandName ? 28 : 0 });
    if (style.brandName) foot.push({ text: style.brandName, size: 26, weight: 400, color: WHITE, lineHeight: 1.3, spacing: 1, alpha: 0.7, gap: 0 });

    const headItems = measureBlocks(ctx, head, inner, base, family);
    const footItems = measureBlocks(ctx, foot, inner, base, family);
    const headEnd = drawBlocks(ctx, headItems, pad, pad, inner, base, family);
    const footHeight = totalHeight(footItems);
    drawBlocks(ctx, footItems, pad, H - pad - footHeight, inner, base, family);

    // 제목은 위아래 글 사이의 한가운데에 둔다.
    const middleTop = headEnd + 40 * base;
    const middleBottom = H - pad - footHeight - 40 * base;
    const title: Block[] = [{ text: card.type === 'cover' ? card.main_title : card.message, size: card.type === 'cover' ? 88 : 60, weight: 800, color: WHITE, lineHeight: 1.25, gap: 0 }];
    const fitted = fit(ctx, title, inner, middleBottom - middleTop, base, family);
    const titleHeight = totalHeight(fitted.items);
    drawBlocks(ctx, fitted.items, pad, middleTop + Math.max(0, (middleBottom - middleTop - titleHeight) / 2), inner, fitted.k, family);
    return;
  }

  ctx.fillStyle = card.type === 'list' ? mixColor(style.background, style.textDark, 0.03) : style.background;
  ctx.fillRect(0, 0, W, H);

  const blocks: Block[] =
    card.type === 'content'
      ? [
          { text: card.section_label, size: 32, weight: 700, color: style.primary, lineHeight: 1.2, spacing: 4, gap: 30 },
          { text: card.heading, size: 72, weight: 800, color: style.textDark, lineHeight: 1.3, gap: 50, rule: { thickness: 8, gap: 30, color: style.primary } },
          { text: card.lead, size: 50, weight: 700, color: style.textDark, lineHeight: 1.5, gap: 40 },
          { text: card.body_text, size: 36, weight: 400, color: style.textMuted, lineHeight: 1.7, gap: 0 },
        ]
      : [
          { text: card.section_label, size: 32, weight: 700, color: style.primary, lineHeight: 1.2, spacing: 4, gap: 30 },
          { text: card.heading, size: 72, weight: 800, color: style.textDark, lineHeight: 1.3, gap: 60 },
          ...card.items.slice(0, 5).map((item, i): Block => ({ text: `${i + 1}. ${item}`, size: 44, weight: 500, color: style.textDark, lineHeight: 1.4, gap: 36 })),
        ];

  // 아래쪽에 브랜드 이름을 작게 둔다. 그만큼 글이 들어갈 높이가 줄어든다.
  const brand: Block[] = style.brandName ? [{ text: style.brandName, size: 24, weight: 500, color: style.textMuted, lineHeight: 1.3, spacing: 1, alpha: 0.8, gap: 0 }] : [];
  const brandItems = measureBlocks(ctx, brand, inner, base, family);
  const brandHeight = totalHeight(brandItems);
  const available = H - pad * 2 - (brandHeight > 0 ? brandHeight + 30 * base : 0);
  const fitted = fit(ctx, blocks, inner, available, base, family);
  drawBlocks(ctx, fitted.items, pad, pad, inner, fitted.k, family);
  if (brandHeight > 0) drawBlocks(ctx, brandItems, pad, H - pad - brandHeight, inner, base, family);
}

// ── 잡지 ──

const magazine: Design = {
  cover(env, card) {
    const { ctx, W, H, base, pad, inner, family, style } = env;
    fillRect(ctx, WHITE, 0, 0, W, H);
    // 오른쪽 아래의 둥근 색 면
    ctx.fillStyle = mixColor(style.primary, WHITE, 0.9);
    ctx.beginPath();
    ctx.moveTo(W, H);
    ctx.arc(W, H, Math.min(W, H) * 0.52, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();

    const head = measureStack(ctx, [text(card.eyebrow, 32, 700, style.primary, { spacing: 6, lineHeight: 1.2, gap: 22 }), { kind: 'rule', width: 90, thickness: 8, color: style.primary, gap: 0 }], inner, base, family);
    const headEnd = drawStack(ctx, head, pad, pad, inner, base, family);

    const foot: Block[] = [];
    if (card.sub_title) foot.push({ text: card.sub_title, size: 42, weight: 500, color: style.textMuted, lineHeight: 1.4, gap: style.brandName ? 24 : 0 });
    if (style.brandName) foot.push({ text: style.brandName, size: 24, weight: 500, color: style.textMuted, lineHeight: 1.3, spacing: 1, gap: 0 });
    const footItems = measureBlocks(ctx, foot, inner, base, family);
    const footHeight = totalHeight(footItems);
    drawBlocks(ctx, footItems, pad, H - pad - footHeight, inner, base, family);

    centered(env, [text(card.main_title, 92, 800, style.textDark, { lineHeight: 1.25 })], pad, inner, headEnd + 40 * base, H - pad - footHeight - 40 * base);
  },
  content(env, card) {
    const { ctx, W, H, base, pad, inner, family, style } = env;
    fillRect(ctx, WHITE, 0, 0, W, H);
    const number = sectionNumber(card.section_label);
    if (number) {
      ctx.font = `800 ${300 * base}px ${family}`;
      ctx.fillStyle = mixColor(style.primary, WHITE, 0.87);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(number, W - pad * 0.7, pad * 0.4);
      ctx.textAlign = 'left';
    }
    const brand = brandLine(env, style.textMuted, inner);
    let bottom = H - pad;
    if (brand.height > 0) {
      drawBlocks(ctx, brand.items, pad, H - pad - brand.height, inner, base, family);
      const lineY = H - pad - brand.height - 24 * base;
      fillRect(ctx, mixColor(style.textDark, WHITE, 0.88), pad, lineY, inner, 2 * base);
      bottom = lineY - 30 * base;
    }
    centered(
      env,
      [
        text(card.heading, 78, 800, style.textDark, { lineHeight: 1.3, gap: 44 }),
        {
          kind: 'box',
          fill: mixColor(style.primary, WHITE, 0.92),
          bar: style.primary,
          padX: 40,
          padY: 34,
          gap: 36,
          blocks: [text(card.lead, 52, 700, style.textDark, { lineHeight: 1.5, emphasis: { color: style.primary } })],
        },
        text(card.body_text, 42, 400, style.textMuted, { lineHeight: 1.7 }),
      ],
      pad,
      inner,
      pad,
      bottom,
    );
  },
};

// ── 색 띠 ──

const band: Design = {
  cover(env, card) {
    const { ctx, W, H, base, pad, inner, family, style } = env;
    const blockHeight = H * 0.66;
    fillRect(ctx, WHITE, 0, 0, W, H);
    fillRect(ctx, style.primary, 0, 0, W, blockHeight);
    const head = measureBlocks(ctx, [{ text: card.eyebrow, size: 32, weight: 700, color: WHITE, lineHeight: 1.2, spacing: 6, alpha: 0.9, gap: 0 }], inner, base, family);
    const headEnd = drawBlocks(ctx, head, pad, pad, inner, base, family);
    // 제목은 색 면의 아래쪽에 붙인다.
    const titleTop = headEnd + 30 * base;
    const titleBottom = blockHeight - pad * 0.8;
    const fitted = fit(ctx, [{ text: card.main_title, size: 88, weight: 800, color: WHITE, lineHeight: 1.25, gap: 0 }], inner, titleBottom - titleTop, base, family);
    drawBlocks(ctx, fitted.items, pad, Math.max(titleTop, titleBottom - totalHeight(fitted.items)), inner, fitted.k, family);

    const brand = brandLine(env, style.textMuted, inner);
    if (brand.height > 0) drawBlocks(ctx, brand.items, pad, H - pad * 0.8 - brand.height, inner, base, family);
    const lowerBottom = H - pad * 0.8 - (brand.height > 0 ? brand.height + 20 * base : 0);
    centered(env, [text(card.sub_title ?? '', 46, 700, style.textDark, { lineHeight: 1.4 })], pad, inner, blockHeight + pad * 0.5, lowerBottom);
  },
  content(env, card) {
    const { ctx, W, H, base, pad, inner, family, style, known } = env;
    const top: Item[] = [
      { kind: 'pill', text: sectionNumber(card.section_label) || card.section_label, size: 30, weight: 800, color: style.primary, fill: WHITE, padX: 28, padY: 10, gap: 26 },
      text(card.heading, 72, 800, WHITE, { lineHeight: 1.3 }),
    ];
    const lower: Item[] = [
      text(card.lead, 54, 700, style.textDark, { lineHeight: 1.55, emphasis: { marker: MARKER }, gap: 32 }),
      text(card.body_text, 42, 400, style.textMuted, { lineHeight: 1.7 }),
    ];
    const brand = brandLine(env, style.textMuted, inner);
    const bandPadTop = pad * 0.9;
    const bandPadBottom = pad * 0.75;
    const lowerPad = pad * 0.7;
    const reserve = lowerPad + (brand.height > 0 ? brand.height + 20 * base : 0);

    let k = base;
    let a = measureStack(ctx, top, inner, k, family);
    let b = measureStack(ctx, lower, inner, k, family);
    for (let step = 0; step < 14 && bandPadTop + a.height + bandPadBottom + lowerPad + b.height + reserve > H; step += 1) {
      k *= 0.94;
      a = measureStack(ctx, top, inner, k, family);
      b = measureStack(ctx, lower, inner, k, family);
    }
    const bandHeight = Math.max(H * 0.34, bandPadTop + a.height + bandPadBottom);
    fillRect(ctx, WHITE, 0, 0, W, H);
    fillRect(ctx, style.primary, 0, 0, W, bandHeight);
    drawStack(ctx, a, pad, middle(0, bandHeight, a.height), inner, k, family, known);
    drawStack(ctx, b, pad, middle(bandHeight + lowerPad, H - reserve, b.height), inner, k, family, known);
    if (brand.height > 0) drawBlocks(ctx, brand.items, pad, H - lowerPad - brand.height, inner, base, family);
  },
};

// ── 부드러운 상자 ──

/** 연한 바탕과 둥근 흰 상자를 그리고, 상자 안에 글을 쓸 자리를 돌려준다 */
function softPanel(env: Env): { x: number; width: number; top: number; bottom: number; tint: string } {
  const { ctx, W, H, base, family, style } = env;
  const tint = mixColor(style.primary, WHITE, 0.9);
  fillRect(ctx, tint, 0, 0, W, H);
  const margin = 56 * base;
  const brand = brandLine(env, style.textMuted, W - margin * 2, { align: 'center' });
  const panelBottom = H - margin - (brand.height > 0 ? brand.height + 22 * base : 0);
  ctx.fillStyle = WHITE;
  roundRect(ctx, margin, margin, W - margin * 2, panelBottom - margin, 44 * base);
  ctx.fill();
  if (brand.height > 0) drawBlocks(ctx, brand.items, margin, middle(panelBottom, H, brand.height), W - margin * 2, base, family);
  const padding = 72 * base;
  return { x: margin + padding, width: W - (margin + padding) * 2, top: margin + padding * 0.85, bottom: panelBottom - padding * 0.85, tint };
}

const soft: Design = {
  cover(env, card) {
    const { style } = env;
    const area = softPanel(env);
    centered(
      env,
      [
        { kind: 'pill', text: card.eyebrow, size: 26, weight: 700, color: style.primary, fill: area.tint, padX: 24, padY: 10, spacing: 3, gap: 34 },
        text(card.main_title, 84, 800, style.textDark, { lineHeight: 1.28, gap: 34 }),
        text(card.sub_title ?? '', 42, 400, style.textMuted, { lineHeight: 1.5 }),
      ],
      area.x,
      area.width,
      area.top,
      area.bottom,
    );
  },
  content(env, card) {
    const { style } = env;
    const area = softPanel(env);
    centered(
      env,
      [
        { kind: 'pill', text: card.section_label, size: 26, weight: 700, color: style.primary, fill: area.tint, padX: 24, padY: 10, spacing: 3, gap: 30 },
        text(card.heading, 68, 800, style.textDark, { lineHeight: 1.3, gap: 38 }),
        text(card.lead, 50, 700, style.textDark, { lineHeight: 1.5, indent: 72, bullet: style.primary, emphasis: { color: style.primary }, gap: 22 }),
        text(card.body_text, 40, 400, style.textMuted, { lineHeight: 1.7, indent: 72 }),
      ],
      area.x,
      area.width,
      area.top,
      area.bottom,
    );
  },
};

// ── 진한 바탕 ──

function darkBase(env: Env): { background: string; accent: string; soft: string; bottom: number } {
  const { ctx, W, H, base, pad, inner, family, style } = env;
  const background = mixColor(style.primary, '#0b1020', 0.8);
  fillRect(ctx, background, 0, 0, W, H);
  ctx.fillStyle = mixColor(background, WHITE, 0.05);
  ctx.beginPath();
  ctx.arc(W * 0.94, H * 0.06, Math.min(W, H) * 0.34, 0, Math.PI * 2);
  ctx.fill();
  const brand = brandLine(env, mixColor(background, WHITE, 0.55), inner);
  if (brand.height > 0) drawBlocks(ctx, brand.items, pad, H - pad - brand.height, inner, base, family);
  return {
    background,
    accent: mixColor(style.primary, WHITE, 0.6),
    soft: mixColor(background, WHITE, 0.8),
    bottom: H - pad - (brand.height > 0 ? brand.height + 30 * base : 0),
  };
}

const dark: Design = {
  cover(env, card) {
    const { pad, inner } = env;
    const tone = darkBase(env);
    centered(
      env,
      [
        text(card.eyebrow, 32, 700, tone.accent, { spacing: 6, lineHeight: 1.2, gap: 30 }),
        text(card.main_title, 90, 800, WHITE, { lineHeight: 1.25, gap: 40 }),
        { kind: 'rule', width: 110, thickness: 8, color: tone.accent, gap: 40 },
        text(card.sub_title ?? '', 42, 400, tone.soft, { lineHeight: 1.5 }),
      ],
      pad,
      inner,
      pad,
      tone.bottom,
    );
  },
  content(env, card) {
    const { pad, inner } = env;
    const tone = darkBase(env);
    centered(
      env,
      [
        text(card.section_label, 30, 700, tone.accent, { spacing: 5, lineHeight: 1.2, gap: 26 }),
        text(card.heading, 76, 800, WHITE, { lineHeight: 1.3, gap: 36 }),
        { kind: 'rule', width: 110, thickness: 8, color: tone.accent, gap: 44 },
        text(card.lead, 54, 700, WHITE, { lineHeight: 1.5, emphasis: { color: '#fcd34d' }, gap: 32 }),
        text(card.body_text, 42, 400, tone.soft, { lineHeight: 1.7 }),
      ],
      pad,
      inner,
      pad,
      tone.bottom,
    );
  },
};

// ── 옆 번호 ──

/** 왼쪽 색 기둥을 그리고, 오른쪽에 글을 쓸 자리를 돌려준다 */
function sideArea(env: Env): { stripWidth: number; x: number; width: number; bottom: number } {
  const { ctx, W, H, base, pad, family, style } = env;
  const stripWidth = 230 * base;
  fillRect(ctx, WHITE, 0, 0, W, H);
  fillRect(ctx, style.primary, 0, 0, stripWidth, H);
  const x = stripWidth + 64 * base;
  const width = W - x - pad * 0.9;
  const brand = brandLine(env, style.textMuted, width);
  if (brand.height > 0) drawBlocks(ctx, brand.items, x, H - pad - brand.height, width, base, family);
  return { stripWidth, x, width, bottom: H - pad - (brand.height > 0 ? brand.height + 30 * base : 0) };
}

const side: Design = {
  cover(env, card) {
    const { ctx, H, base, pad, family, style } = env;
    const area = sideArea(env);
    // 기둥에는 작은 글을 세로로 쓴다.
    ctx.save();
    ctx.translate(area.stripWidth / 2, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `700 ${36 * base}px ${family}`;
    ctx.letterSpacing = `${12 * base}px`;
    ctx.fillStyle = WHITE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(card.eyebrow, 0, 0);
    ctx.restore();
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
    centered(
      env,
      [
        text(card.main_title, 84, 800, style.textDark, { lineHeight: 1.25, gap: 36 }),
        { kind: 'rule', thickness: 4, color: mixColor(style.primary, WHITE, 0.7), gap: 32 },
        text(card.sub_title ?? '', 42, 400, style.textMuted, { lineHeight: 1.5 }),
      ],
      area.x,
      area.width,
      pad,
      area.bottom,
    );
  },
  content(env, card) {
    const { ctx, base, pad, family, style } = env;
    const area = sideArea(env);
    const number = sectionNumber(card.section_label);
    const word = card.section_label.replace(/\s*\d+\s*$/, '').trim();
    ctx.fillStyle = WHITE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (word) {
      ctx.globalAlpha = 0.8;
      ctx.font = `700 ${24 * base}px ${family}`;
      ctx.fillText(word, area.stripWidth / 2, pad);
      ctx.globalAlpha = 1;
    }
    if (number) {
      ctx.font = `800 ${120 * base}px ${family}`;
      ctx.fillText(number, area.stripWidth / 2, pad + 44 * base);
    }
    ctx.textAlign = 'left';
    centered(
      env,
      [
        text(card.heading, 68, 800, style.textDark, { lineHeight: 1.3, gap: 30 }),
        { kind: 'rule', thickness: 4, color: mixColor(style.primary, WHITE, 0.7), gap: 36 },
        text(card.lead, 50, 700, style.textDark, { lineHeight: 1.5, emphasis: { color: style.primary }, gap: 28 }),
        text(card.body_text, 40, 400, style.textMuted, { lineHeight: 1.7 }),
      ],
      area.x,
      area.width,
      pad,
      area.bottom,
    );
  },
};

// ── 메모지 ──

const INK = '#1c1917';
const INK_SOFT = '#57534e';

/** 종이 바탕, 테두리, 위의 테이프를 그리고 글을 쓸 자리를 돌려준다 */
function notePaper(env: Env): { x: number; width: number; top: number; bottom: number; highlight: string } {
  const { ctx, W, H, base, family, style } = env;
  fillRect(ctx, '#fbf6ea', 0, 0, W, H);
  const frame = 34 * base;
  ctx.strokeStyle = '#e6dcc6';
  ctx.lineWidth = 3 * base;
  ctx.strokeRect(frame, frame, W - frame * 2, H - frame * 2);
  ctx.save();
  ctx.translate(W / 2, frame);
  ctx.rotate(-0.05);
  ctx.globalAlpha = 0.85;
  fillRect(ctx, mixColor(style.primary, WHITE, 0.7), -110 * base, -27 * base, 220 * base, 54 * base);
  ctx.restore();
  ctx.globalAlpha = 1;
  const x = 104 * base;
  const width = W - x * 2;
  const brand = brandLine(env, '#78716c', width);
  if (brand.height > 0) drawBlocks(ctx, brand.items, x, H - x * 0.85 - brand.height, width, base, family);
  return { x, width, top: x, bottom: H - x * 0.85 - (brand.height > 0 ? brand.height + 28 * base : 0), highlight: mixColor(style.primary, WHITE, 0.8) };
}

const note: Design = {
  cover(env, card) {
    const { style } = env;
    const area = notePaper(env);
    centered(
      env,
      [
        text(card.eyebrow, 30, 700, style.primary, { spacing: 5, lineHeight: 1.2, gap: 26 }),
        text(card.main_title, 86, 800, INK, { lineHeight: 1.38, underlay: area.highlight, gap: 40 }),
        text(card.sub_title ?? '', 42, 400, INK_SOFT, { lineHeight: 1.5 }),
      ],
      area.x,
      area.width,
      area.top,
      area.bottom,
    );
  },
  content(env, card) {
    const { style } = env;
    const area = notePaper(env);
    centered(
      env,
      [
        text(card.section_label, 28, 700, style.primary, { spacing: 4, lineHeight: 1.2, gap: 24 }),
        text(card.heading, 72, 800, INK, { lineHeight: 1.4, underlay: area.highlight, gap: 42 }),
        text(card.lead, 52, 700, INK, { lineHeight: 1.55, emphasis: { marker: MARKER }, gap: 28 }),
        text(card.body_text, 41, 400, INK_SOFT, { lineHeight: 1.7 }),
      ],
      area.x,
      area.width,
      area.top,
      area.bottom,
    );
  },
};

// ── 가운데 정렬 ──

const quote: Design = {
  cover(env, card) {
    const { ctx, W, H, base, pad, family, style } = env;
    fillRect(ctx, style.primary, 0, 0, W, H);
    const frame = 40 * base;
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 3 * base;
    ctx.strokeRect(frame, frame, W - frame * 2, H - frame * 2);
    ctx.globalAlpha = 1;
    const x = pad + 30 * base;
    const width = W - x * 2;
    const brand = brandLine(env, WHITE, width, { align: 'center', alpha: 0.7 });
    if (brand.height > 0) drawBlocks(ctx, brand.items, x, H - pad - 10 * base - brand.height, width, base, family);
    centered(
      env,
      [
        text(card.eyebrow, 30, 700, WHITE, { spacing: 6, lineHeight: 1.2, alpha: 0.9, align: 'center', gap: 30 }),
        text(card.main_title, 88, 800, WHITE, { lineHeight: 1.3, align: 'center', gap: 36 }),
        { kind: 'rule', width: 84, thickness: 6, color: WHITE, align: 'center', gap: 36 },
        text(card.sub_title ?? '', 42, 400, WHITE, { lineHeight: 1.5, alpha: 0.85, align: 'center' }),
      ],
      x,
      width,
      pad + 20 * base,
      H - pad - 10 * base - (brand.height > 0 ? brand.height + 30 * base : 0),
    );
  },
  content(env, card) {
    const { ctx, W, H, base, pad, inner, family, style } = env;
    fillRect(ctx, WHITE, 0, 0, W, H);
    fillRect(ctx, style.primary, 0, 0, W, 20 * base);
    // 큰 따옴표를 연하게 깐다.
    ctx.font = `700 ${340 * base}px Georgia, "Times New Roman", serif`;
    ctx.fillStyle = mixColor(style.primary, WHITE, 0.88);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('“', W / 2, pad * 0.6);
    ctx.textAlign = 'left';
    const brand = brandLine(env, style.textMuted, inner, { align: 'center' });
    if (brand.height > 0) drawBlocks(ctx, brand.items, pad, H - pad - brand.height, inner, base, family);
    centered(
      env,
      [
        text(card.section_label, 28, 700, style.primary, { spacing: 5, lineHeight: 1.2, align: 'center', gap: 20 }),
        text(card.heading, 56, 800, style.textDark, { lineHeight: 1.35, align: 'center', gap: 28 }),
        { kind: 'rule', width: 84, thickness: 6, color: style.primary, align: 'center', gap: 44 },
        text(card.lead, 60, 800, style.textDark, { lineHeight: 1.5, align: 'center', emphasis: { color: style.primary }, gap: 32 }),
        text(card.body_text, 40, 400, style.textMuted, { lineHeight: 1.7, align: 'center' }),
      ],
      pad,
      inner,
      pad + 40 * base,
      H - pad - (brand.height > 0 ? brand.height + 30 * base : 0),
    );
  },
};

const DESIGNS: Record<Exclude<CardDesign, 'classic'>, Design> = { magazine, band, soft, dark, side, note, quote };

/** 카드 한 장을 고른 모양으로 그린다. 목록 카드와 마무리 카드는 기본 모양으로 그린다 */
export function drawDesign(env: Env, card: Card): void {
  const design = env.style.design;
  if (design === 'classic' || (card.type !== 'cover' && card.type !== 'content')) {
    drawClassic(env, card);
    return;
  }
  if (card.type === 'cover') DESIGNS[design].cover(env, card);
  else DESIGNS[design].content(env, card);
}
