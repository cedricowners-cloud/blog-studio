import type { Block, Palette, Run } from './blocks/types';

/**
 * 복사하기: 채우기가 안 될 때 쓰는 대체 방법 (설계 문서 4.2).
 * 블록 목록을 단순한 HTML 로 바꿔 클립보드에 넣는다. 사용자가 본문에 붙여넣는다.
 * 네이버 에디터의 내부 구조에 기대지 않는다.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runsToHtml(runs: Run[], palette: Palette): string {
  return runs
    .map((run) => {
      let html = escapeHtml(run.text);
      const css: string[] = [];
      if (run.tone) css.push(`color:${palette[run.tone]}`);
      if (run.highlight) css.push(`background-color:${palette.highlight}`);
      if (css.length > 0) html = `<span style="${css.join(';')}">${html}</span>`;
      if (run.underline) html = `<u>${html}</u>`;
      if (run.italic) html = `<i>${html}</i>`;
      if (run.bold || run.tone) html = `<b>${html}</b>`;
      return html;
    })
    .join('');
}

function runsToText(runs: Run[]): string {
  return runs.map((run) => run.text).join('');
}

export function blocksToHtml(blocks: Block[], palette: Palette): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading': {
          const size = block.level === 2 ? 24 : 19;
          return `<p><b><span style="font-size:${size}px">${escapeHtml(block.text)}</span></b></p>`;
        }
        case 'paragraph': {
          const align = block.align && block.align !== 'left' ? ` style="text-align:${block.align}"` : '';
          return `<p${align}>${runsToHtml(block.runs, palette) || '<br>'}</p>`;
        }
        case 'quote':
          return `<blockquote>${runsToHtml(block.runs, palette)}</blockquote>`;
        case 'divider':
          return '<hr>';
        case 'table': {
          const rows = block.rows
            .map((row, rowIndex) => {
              const tag = block.headerRow && rowIndex === 0 ? 'th' : 'td';
              return '<tr>' + row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('') + '</tr>';
            })
            .join('');
          return `<table border="1" style="border-collapse:collapse">${rows}</table>`;
        }
        case 'image':
          return `<p style="text-align:center">[이미지 자리: ${escapeHtml(block.slot)}${block.alt ? ' - ' + escapeHtml(block.alt) : ''}]</p>`;
      }
    })
    .join('\n');
}

export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return block.text;
        case 'paragraph':
        case 'quote':
          return runsToText(block.runs);
        case 'divider':
          return '────────';
        case 'table':
          return block.rows.map((row) => row.join('\t')).join('\n');
        case 'image':
          return `[이미지 자리: ${block.slot}${block.alt ? ' - ' + block.alt : ''}]`;
      }
    })
    .join('\n');
}

/** 블록 목록을 서식이 있는 글로 클립보드에 넣는다. */
export async function copyBlocks(blocks: Block[], palette: Palette): Promise<void> {
  const html = blocksToHtml(blocks, palette);
  const text = blocksToText(blocks);
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    }),
  ]);
}
