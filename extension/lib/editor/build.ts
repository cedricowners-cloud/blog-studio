import type { Block, Palette, Run } from '../blocks/types';

/**
 * 블록 목록 → 네이버 에디터의 부품 목록.
 *
 * 부품의 모양은 추측하지 않았다. 내 에디터에서 직접 읽은 견본을 그대로 따랐다
 * (`docs/extension/EDITOR-NOTES.md`). 네이버가 모양을 바꾸면 견본을 다시 읽고 여기를 고친다.
 *
 * 여기서 만드는 부품에는 id 가 없다. id 는 페이지 안에서 넣기 직전에 붙인다.
 * 이 파일은 다른 파일의 값을 가져다 쓰지 않는다 (타입만 가져온다).
 */

export type EditorComponent = Record<string, unknown>;

/** 인용구 1~6번이 에디터의 어느 모양인지 */
export const QUOTE_LAYOUTS = [
  'default',
  'quotation_line',
  'quotation_bubble',
  'quotation_postit',
  'quotation_corner',
  'quotation_underline',
] as const;

/** 구분선 1~8번이 에디터의 어느 모양인지 */
export const DIVIDER_LAYOUTS = ['default', 'line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'] as const;

/** 소제목의 글자 크기. 기존 발행 프로그램과 같다 (24, 19). */
const HEADING_SIZE: Record<2 | 3, string> = { 2: 'fs24', 3: 'fs19' };

const CELL_HEIGHT = 43;

interface NodeStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSizeCode?: string;
  /** 글자색. "#rrggbb" */
  fontColor?: string;
  /** 글자 배경색(형광펜). "#rrggbb" */
  backgroundColor?: string;
}

function textNode(value: string, style?: NodeStyle): EditorComponent {
  const node: EditorComponent = { value };
  if (style && Object.keys(style).length > 0) node.style = { ...style, '@ctype': 'nodeStyle' };
  node['@ctype'] = 'textNode';
  return node;
}

function paragraph(nodes: EditorComponent[], align?: 'left' | 'center' | 'right'): EditorComponent {
  // 글자가 하나도 없는 문단도 빈 글자 조각 하나를 가진다 (견본과 같다).
  const para: EditorComponent = { nodes: nodes.length > 0 ? nodes : [textNode('')] };
  if (align && align !== 'left') para.style = { align, '@ctype': 'paragraphStyle' };
  para['@ctype'] = 'paragraph';
  return para;
}

function runsToNodes(runs: Run[], palette: Palette, extra?: NodeStyle): EditorComponent[] {
  return runs
    .filter((run) => run.text.length > 0)
    .map((run) => {
      const style: NodeStyle = { ...extra };
      if (run.bold) style.bold = true;
      if (run.italic) style.italic = true;
      if (run.underline) style.underline = true;
      if (run.tone) {
        // 색 강조는 굵게와 같이 쓴다. 색만으로 뜻을 전하지 않는다 (설계 문서 4.6).
        style.fontColor = palette[run.tone];
        style.bold = true;
      }
      if (run.highlight) style.backgroundColor = palette.highlight;
      return textNode(run.text, style);
    });
}

function pick<T>(list: readonly T[], oneBased: number): T {
  const index = Math.min(Math.max(Math.trunc(oneBased) || 1, 1), list.length) - 1;
  return list[index] as T;
}

function buildTable(rows: string[][], headerRow: boolean): EditorComponent {
  const columnCount = Math.max(1, ...rows.map((r) => r.length));
  const width = Math.round((100 / columnCount) * 100) / 100;
  return {
    layout: 'default',
    width: 100,
    rows: rows.map((cells, rowIndex) => ({
      cells: Array.from({ length: columnCount }, (_, col) => {
        const text = cells[col] ?? '';
        const bold = headerRow && rowIndex === 0;
        return {
          colSpan: 1,
          rowSpan: 1,
          width,
          height: CELL_HEIGHT,
          // 빈 칸은 견본에서 null 이었다.
          value: text ? [paragraph([textNode(text, bold ? { bold: true } : undefined)])] : null,
          '@ctype': 'tableCell',
        };
      }),
      '@ctype': 'tableRow',
    })),
    columnCount,
    borderStyleName: 'thinLine',
    '@ctype': 'table',
  };
}

/** 이미지가 들어갈 자리를 표시하는 글. E5 단계에서 실제 사진으로 바뀐다. */
export function imagePlaceholderText(slot: string, alt: string): string {
  return `[이미지 자리: ${slot}${alt ? ' - ' + alt : ''}]`;
}

/**
 * 블록 목록을 부품 목록으로 바꾼다.
 * 연달아 나오는 문단과 소제목은 하나의 글 부품에 모은다 (에디터가 그렇게 저장한다).
 * 색 강조(긍정·부정·형광펜)는 palette 의 색으로 바꾼다.
 */
export function buildComponents(blocks: Block[], palette: Palette): EditorComponent[] {
  const components: EditorComponent[] = [];
  let pending: EditorComponent[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    components.push({ layout: 'default', value: pending, '@ctype': 'text' });
    pending = [];
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'paragraph':
        pending.push(paragraph(runsToNodes(block.runs, palette), block.align));
        break;
      case 'heading':
        pending.push(paragraph([textNode(block.text, { fontSizeCode: HEADING_SIZE[block.level], bold: true })]));
        break;
      case 'image':
        pending.push(paragraph([textNode(imagePlaceholderText(block.slot, block.alt))], 'center'));
        break;
      case 'quote':
        flush();
        components.push({
          layout: pick(QUOTE_LAYOUTS, block.style),
          value: [paragraph(runsToNodes(block.runs, palette))],
          source: null,
          '@ctype': 'quotation',
        });
        break;
      case 'divider':
        flush();
        components.push({ layout: pick(DIVIDER_LAYOUTS, block.style), '@ctype': 'horizontalLine' });
        break;
      case 'table':
        flush();
        components.push(buildTable(block.rows, block.headerRow));
        break;
    }
  }
  flush();
  return components;
}

/** 부품 안의 글자를 순서대로 이어 붙인다. 넣은 것과 읽은 것을 견줄 때 쓴다. */
export function flattenText(node: unknown): string {
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (typeof node !== 'object') return '';
  const obj = node as Record<string, unknown>;
  if (obj['@ctype'] === 'textNode') return typeof obj.value === 'string' ? obj.value : '';
  let out = '';
  for (const key of Object.keys(obj)) {
    if (key === 'style') continue;
    const child = obj[key];
    if (child && typeof child === 'object') out += flattenText(child);
  }
  return out;
}
