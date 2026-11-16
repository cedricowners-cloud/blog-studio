import type { Palette } from './blocks/types';

// 색을 다루는 작은 도우미. 이 파일은 다른 파일의 값을 가져다 쓰지 않는다 (타입만 가져온다).

/** 기본 색. 긍정 강조의 기본값은 blog_studio 카드 디자인의 기본 대표색과 같다. */
export const DEFAULT_PALETTE: Palette = {
  positive: '#1e3a8a',
  negative: '#d92d20',
  highlight: '#fff3a3',
};

/** "#abc", "ABCDEF" 같은 값을 "#aabbcc" 모양으로 맞춘다. 색이 아니면 null. */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return '#' + raw.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(raw)) return '#' + raw;
  return null;
}

/** 저장해 둔 값에서 쓸 수 있는 색만 골라 기본값과 합친다. */
export function resolvePalette(saved: Partial<Record<keyof Palette, unknown>> | null | undefined): Palette {
  const pick = (key: keyof Palette): string => {
    const value = saved ? saved[key] : undefined;
    return (typeof value === 'string' && normalizeHex(value)) || DEFAULT_PALETTE[key];
  };
  return { positive: pick('positive'), negative: pick('negative'), highlight: pick('highlight') };
}

function luminance(hex: string): number {
  const n = normalizeHex(hex) ?? '#000000';
  const channel = (start: number) => {
    const v = parseInt(n.slice(start, start + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** 두 색의 명암 대비 (1 ~ 21). 글자는 4.5 이상이어야 읽기 편하다. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 흰 바탕에서 글자색으로 읽기 편한지 */
export function readableOnWhite(hex: string): { ok: boolean; ratio: number } {
  const ratio = contrastRatio(hex, '#ffffff');
  return { ok: ratio >= 4.5, ratio: Math.round(ratio * 10) / 10 };
}
