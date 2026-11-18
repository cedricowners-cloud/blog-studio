// 카드를 그림으로 그린다. 크기와 색을 정하고, 고른 모양(designs.ts)으로 캔버스에 그린다.
// 웹은 화면을 찍어서 그림을 만들고, 여기서는 캔버스에 바로 그린다. 그래서 줄바꿈 자리가 조금 다를 수 있다.
//   - 글이 넘치면 글자 크기를 조금씩 줄여서 카드 안에 들어가게 한다.
//   - 글씨체는 확장에 넣어 둔 Pretendard 를 쓴다 (font.ts 가 불러온다). 불러오지 못하면 컴퓨터의 기본 고딕으로 그린다.
import type { PreparedImage } from '../editor/image-file.ts';
import type { Card } from './parser.ts';
import { drawDesign, type CardDesign, type CardStyle } from './designs.ts';
import { mixColor, type KnownNumbers } from './draw.ts';

export { mixColor, splitNumbers, sectionNumber, wrapText } from './draw.ts';
export { CARD_DESIGNS, isCardDesign, type CardDesign, type CardStyle } from './designs.ts';

export type CardSize = 'square' | 'wide';

export const CARD_SIZES: Record<CardSize, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: '정사각형 (1080×1080)' },
  wide: { width: 1200, height: 900, label: '가로형 (1200×900)' },
};

const FONT_FAMILY = 'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

/** 카드의 크기, 색, 모양을 정한다. 주된 색은 내 브랜드 색이다 */
export function cardStyle(size: CardSize, brandColor: string, brandName: string, design: CardDesign = 'classic'): CardStyle {
  const { width, height } = CARD_SIZES[size];
  return {
    width,
    height,
    primary: brandColor,
    primaryTo: mixColor(brandColor, '#ffffff', 0.14),
    background: '#ffffff',
    textDark: '#0f172a',
    textMuted: '#475569',
    brandName: brandName.trim(),
    fontFamily: FONT_FAMILY,
    design,
  };
}

/**
 * 카드 한 장을 캔버스에 그린다.
 * known 은 강조해도 되는 숫자(제목과 본문에 있는 숫자)다. null 이면 모든 숫자를 강조한다.
 */
export function drawCard(canvas: HTMLCanvasElement, card: Card, style: CardStyle, known: KnownNumbers = null): void {
  const { width: W, height: H } = style;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('카드를 그리지 못했어요.');
  // 웹의 카드는 1080 을 기준으로 만든 모양이다. 짧은 쪽에 맞춰 줄이거나 늘린다.
  const base = Math.min(W, H) / 1080;
  const pad = 80 * base;
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  drawDesign({ ctx, W, H, base, pad, inner: W - pad * 2, family: style.fontFamily, style, known }, card);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

/** 카드를 작게 그린다 (모양을 고르는 칸의 작은 그림). 크게 그린 뒤 줄여서 글자가 뭉개지지 않게 한다 */
export function drawCardSmall(target: HTMLCanvasElement, card: Card, style: CardStyle, pixelWidth: number, known: KnownNumbers = null): void {
  const full = document.createElement('canvas');
  drawCard(full, card, style, known);
  target.width = pixelWidth;
  target.height = Math.round((pixelWidth * style.height) / style.width);
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('카드를 그리지 못했어요.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, target.width, target.height);
}

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('카드 그림을 읽지 못했어요.'));
    reader.readAsDataURL(blob);
  });

/** 카드를 그려서 에디터에 넣을 수 있는 사진으로 만든다 */
export async function cardToImage(card: Card, style: CardStyle, order: number, label: string, known: KnownNumbers = null): Promise<PreparedImage> {
  const canvas = document.createElement('canvas');
  drawCard(canvas, card, style, known);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('카드 그림을 만들지 못했어요.');
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    name: `bs-card-${stamp}-${order}.png`,
    originalName: label,
    dataUrl: await readAsDataUrl(blob),
    width: style.width,
    height: style.height,
    bytes: blob.size,
  };
}
