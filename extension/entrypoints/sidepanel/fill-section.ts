import { browser } from 'wxt/browser';
import { parseMarkup } from '../../lib/blocks/parse-markup';
import type { Block, Palette } from '../../lib/blocks/types';
import { copyBlocks } from '../../lib/clipboard';
import { DEFAULT_PALETTE, normalizeHex, readableOnWhite, resolvePalette } from '../../lib/color';
import { buildComponents } from '../../lib/editor/build';
import { fillEditor, getNaverTab, restoreEditor } from '../../lib/editor/run';
import type { FillResult } from '../../lib/editor/types';
import { guarded, h, type Tone } from './dom';

// 2·3단계(E2, E3) 화면: 본문을 네이버 글쓰기 화면에 채운다.
// 본문은 직접 붙여넣거나, 글쓰기·SEO 화면에서 [채우기로 보내기]로 넘겨받는다.
// 웹과 연결하는 E4 단계에서 "발행 대기 글 목록"이 더해진다.
// 저장이나 발행은 하지 않는다.

const SAMPLE_TITLE = '채우기 시험 글';

const SAMPLE_BODY = `[h2]큰 소제목입니다[/h2]
보통 문단입니다. 이 안에 [bold]굵은 글자[/bold]와 [italic]기울인 글자[/italic], [underline]밑줄 친 글자[/underline]가 있습니다.
같은 묶음의 두 번째 문단입니다.

[h3]색 강조[/h3]
[pos]긍정 강조[/pos]는 내 브랜드 색으로 들어갑니다.
[neg]부정 강조[/neg]는 빨간색으로 들어갑니다.
[mark]형광펜[/mark]은 배경색으로 들어갑니다.

[h3]작은 소제목입니다[/h3]
[center]가운데로 맞춘 줄입니다.[/center]
[right]오른쪽으로 맞춘 줄입니다.[/right]

[h3]인용구 6종[/h3]
[quote]1번 기본 (quote)[/quote]
[quote2]2번 라인 (quote2)[/quote2]
[quote3]3번 말풍선 (quote3)[/quote3]
[quote4]4번 포스트잇 (quote4)[/quote4]
[quote5]5번 모서리 (quote5)[/quote5]
[quote6]6번 밑줄 (quote6)[/quote6]

[h3]구분선 8종[/h3]
아래는 구분선 1번 (hr)
[hr]
아래는 구분선 2번 (hr2)
[hr2]
아래는 구분선 3번 (hr3)
[hr3]
아래는 구분선 4번 (hr4)
[hr4]
아래는 구분선 5번 (hr5)
[hr5]
아래는 구분선 6번 (hr6)
[hr6]
아래는 구분선 7번 (hr7)
[hr7]
아래는 구분선 8번 (hr8)
[hr8]

[h3]표[/h3]
| 구분 | 내용 | 비고 |
|---|---|---|
| 첫째 | 표의 첫 줄입니다 | 굵은 머리 줄 아래 |
| 둘째 | 표의 둘째 줄입니다 | |

[IMG: 섹션1 - 이미지가 들어갈 자리]
마지막 문단입니다.`;

const REASONS: Record<string, string> = {
  'no-editor': '이 탭에서 에디터를 찾지 못했어요. 네이버 블로그 글쓰기 화면인지 확인해 주세요.',
  'no-setDocumentData': '에디터에 문서를 넣는 기능이 없어요. [복사하기]를 써 주세요.',
  'draft-prompt': '"작성 중인 글" 안내가 떠 있어요. 글쓰기 화면에서 먼저 선택해 주세요.',
  'unexpected-document': '에디터의 문서 모양이 예상과 달라요. [복사하기]를 써 주세요.',
  'no-backup': '되돌릴 사본이 없어요. 이 탭에서 채우기를 한 적이 없거나, 탭을 새로 고쳤어요.',
};

function explain(reason: string | null): string {
  if (!reason) return '';
  if (REASONS[reason]) return REASONS[reason];
  const [kind, ...rest] = reason.split(': ');
  const detail = rest.join(': ');
  if (kind === 'read-failed') return '문서를 읽다가 오류가 났어요: ' + detail;
  if (kind === 'set-failed') return '문서를 넣다가 오류가 났어요. 넣기 전 상태로 돌려놓았어요: ' + detail;
  if (kind === 'verify-failed') return '넣은 뒤 다시 읽다가 오류가 났어요: ' + detail;
  return reason;
}

/** 색 강조가 몇 곳인지, 한 문단에 여러 곳 쓴 데가 있는지 센다. */
function countColors(blocks: Block[]): { positive: number; negative: number; highlight: number; crowded: number } {
  const out = { positive: 0, negative: 0, highlight: 0, crowded: 0 };
  for (const b of blocks) {
    if (b.kind !== 'paragraph' && b.kind !== 'quote') continue;
    let inThisBlock = 0;
    for (const run of b.runs) {
      if (run.tone) {
        out[run.tone] += 1;
        inThisBlock += 1;
      }
      if (run.highlight) {
        out.highlight += 1;
        inThisBlock += 1;
      }
    }
    if (inThisBlock > 1) out.crowded += 1;
  }
  return out;
}

const COLOR_FIELDS: { key: keyof Palette; label: string; isText: boolean }[] = [
  { key: 'positive', label: '긍정 강조 (브랜드 색)', isText: true },
  { key: 'negative', label: '부정 강조', isText: true },
  { key: 'highlight', label: '형광펜 배경', isText: false },
];

function countKinds(blocks: Block[]): string {
  const names: Record<Block['kind'], string> = {
    heading: '소제목',
    paragraph: '문단',
    quote: '인용구',
    divider: '구분선',
    table: '표',
    image: '이미지 자리',
  };
  const counts = new Map<string, number>();
  for (const b of blocks) {
    if (b.kind === 'paragraph' && b.runs.length === 0) continue; // 빈 줄은 세지 않는다
    counts.set(names[b.kind], (counts.get(names[b.kind]) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, n]) => `${name} ${n}`).join(' · ');
}

export interface FillSection {
  element: HTMLElement;
  /** 글쓰기나 SEO 화면에서 만든 글을 넘겨받는다 */
  setContent(title: string, body: string): void;
}

export function createFillSection(): FillSection {
  const titleInput = h('input', { type: 'text', placeholder: '제목', class: 'field' });
  const bodyInput = h('textarea', { rows: '10', placeholder: '본문 (blog_studio 마크업)', class: 'field' });
  const status = h('p', { class: 'message' });
  const report = h('div', null);

  const setStatus = (text: string, tone: Tone = '') => {
    status.textContent = text;
    status.className = 'message ' + tone;
  };

  // 색 설정: 사람마다 다르다. 이 컴퓨터의 확장 저장소에 둔다.
  let palette: Palette = { ...DEFAULT_PALETTE };
  const colorInputs = new Map<keyof Palette, HTMLInputElement>();
  const colorNotes = new Map<keyof Palette, HTMLElement>();

  const refreshColorNotes = () => {
    for (const field of COLOR_FIELDS) {
      const note = colorNotes.get(field.key);
      if (!note) continue;
      if (!field.isText) {
        note.textContent = palette[field.key];
        note.className = 'hint';
        continue;
      }
      const { ok, ratio } = readableOnWhite(palette[field.key]);
      note.textContent = ok
        ? `${palette[field.key]} · 읽기 편해요 (대비 ${ratio})`
        : `${palette[field.key]} · 흰 바탕에서 읽기 어려울 수 있어요 (대비 ${ratio}, 4.5 이상 권장)`;
      note.className = ok ? 'hint' : 'hint warn';
    }
  };

  const colorRows = COLOR_FIELDS.map((field) => {
    const input = h('input', { type: 'color', value: palette[field.key], class: 'swatch' });
    const note = h('span', { class: 'hint' });
    colorInputs.set(field.key, input);
    colorNotes.set(field.key, note);
    input.addEventListener('input', () => {
      const hex = normalizeHex(input.value);
      if (!hex) return;
      palette = { ...palette, [field.key]: hex };
      refreshColorNotes();
      void browser.storage.local.set({ palette });
    });
    return h('div', { class: 'color-row' }, input, h('span', null, field.label), note);
  });

  const resetColors = h('button', { type: 'button' }, '기본 색으로');
  resetColors.addEventListener('click', () => {
    palette = { ...DEFAULT_PALETTE };
    for (const [key, input] of colorInputs) input.value = palette[key];
    refreshColorNotes();
    void browser.storage.local.set({ palette });
  });

  const colorSettings = h('details', { class: 'colors' },
    h('summary', null, '색 설정'),
    h('p', { class: 'hint' }, '글에는 [pos] 긍정, [neg] 부정, [mark] 형광펜처럼 뜻만 적어요. 실제 색은 여기서 정해요.'),
    ...colorRows,
    h('div', { class: 'buttons' }, resetColors),
  );

  void browser.storage.local.get('palette').then((saved) => {
    palette = resolvePalette(saved.palette as Partial<Record<keyof Palette, unknown>> | undefined);
    for (const [key, input] of colorInputs) input.value = palette[key];
    refreshColorNotes();
  });
  refreshColorNotes();

  const sampleButton = h('button', { type: 'button' }, '시험 글 불러오기');
  const fillButton = h('button', { type: 'button', class: 'primary' }, '채우기');
  const copyButton = h('button', { type: 'button' }, '복사하기');
  const restoreButton = h('button', { type: 'button' }, '채우기 전으로 되돌리기');

  function parse(): { blocks: Block[]; warnings: string[] } | null {
    const parsed = parseMarkup(bodyInput.value);
    if (parsed.blocks.length === 0) {
      setStatus('본문이 비어 있어요. [시험 글 불러오기]를 눌러 보세요.', 'warn');
      return null;
    }
    return parsed;
  }

  function describeColors(blocks: Block[]): string {
    const c = countColors(blocks);
    if (c.positive + c.negative + c.highlight === 0) return '없음';
    const text = `긍정 ${c.positive}곳 · 부정 ${c.negative}곳 · 형광펜 ${c.highlight}곳`;
    return c.crowded > 0 ? `${text} (한 문단에 여러 곳 쓴 데가 ${c.crowded}군데 있어요)` : text;
  }

  function showReport(result: FillResult, blocks: Block[], warnings: string[]): void {
    report.replaceChildren();
    const rows = h('dl', { class: 'rows' },
      h('dt', null, '넣은 내용'), h('dd', null, countKinds(blocks)),
      h('dt', null, '색 강조'), h('dd', null, describeColors(blocks)),
      h('dt', null, '부품 수'), h('dd', null, `넣은 것 ${result.sentCount}개 · 다시 읽은 것 ${result.foundCount}개`),
      h('dt', null, '제목'), h('dd', null, result.titleAfter || '(비어 있음)'),
    );
    if (result.kept > 0) {
      rows.append(h('dt', null, '남겨 둔 부품'), h('dd', null, `${result.kept}개 (지도·스티커 등은 지우지 않고 맨 아래에 뒀어요)`));
    }
    report.append(rows);

    if (result.mismatches.length > 0) {
      report.append(
        h('p', { class: 'message bad' }, '넣은 것과 다시 읽은 것이 다른 곳이 있어요.'),
        h('table', null,
          h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, '넣은 것'), h('th', null, '읽은 것'))),
          h('tbody', null,
            ...result.mismatches.map((m) =>
              h('tr', null,
                h('td', { class: 'num' }, m.index < 0 ? '제목' : String(m.index + 1)),
                h('td', null, m.expected),
                h('td', null, m.actual),
              ),
            ),
          ),
        ),
      );
    }
    if (warnings.length > 0) {
      report.append(h('p', { class: 'hint' }, '변환하면서 알아챈 점: ' + warnings.join(' / ')));
    }
    if (result.ok) {
      report.append(
        h('p', { class: 'hint' },
          '화면에서 모양을 확인해 주세요. 그다음 네이버의 [저장]으로 임시저장하고, 글을 다시 열어 그대로인지 봐 주세요.',
        ),
      );
    }
  }

  async function runFill(force: boolean): Promise<void> {
    const parsed = parse();
    if (!parsed) return;
    const tab = await getNaverTab();
    if (!tab) {
      setStatus('지금 보고 있는 탭이 네이버 블로그가 아니에요. 글쓰기 화면을 연 탭에서 눌러 주세요.', 'warn');
      return;
    }
    setStatus('채우는 중이에요…');
    const title = titleInput.value.trim();
    const result = await fillEditor(tab.id, {
      title: title || null,
      components: buildComponents(parsed.blocks, palette),
      force,
    });
    if (!result) {
      setStatus('글쓰기 화면에서 응답이 없어요. 탭을 새로 고친 뒤 다시 해 주세요.', 'bad');
      return;
    }

    if (result.reason === 'not-empty') {
      // 이미 글이 있으면 묻고 나서 덮어쓴다.
      report.replaceChildren();
      const overwrite = h('button', { type: 'button', class: 'primary' }, '덮어쓰기');
      const cancel = h('button', { type: 'button' }, '취소');
      overwrite.addEventListener('click', () =>
        guarded(overwrite, (m) => setStatus(m, 'bad'), () => runFill(true)),
      );
      cancel.addEventListener('click', () => {
        report.replaceChildren();
        setStatus('취소했어요. 글쓰기 화면은 그대로예요.');
      });
      report.append(
        h('p', { class: 'message warn' },
          `글쓰기 화면에 이미 글이 있어요 (부품 ${result.existingCount}개, 글자 ${result.existingChars}자). 덮어쓰면 지금 있는 글은 사라져요.`,
        ),
        h('p', { class: 'hint' }, '덮어쓴 뒤에도 [채우기 전으로 되돌리기]로 돌아올 수 있어요. 단, 탭을 새로 고치면 되돌릴 수 없어요.'),
        h('div', { class: 'buttons' }, overwrite, cancel),
      );
      setStatus('덮어쓸지 정해 주세요.', 'warn');
      return;
    }

    if (result.reason && result.reason !== 'mismatch') {
      report.replaceChildren();
      setStatus(explain(result.reason), 'bad');
      return;
    }

    showReport(result, parsed.blocks, parsed.warnings);
    if (result.ok) setStatus(`채웠어요. 넣은 것과 다시 읽은 것이 같아요 (부품 ${result.sentCount}개).`, 'ok');
    else setStatus('채웠지만 다른 곳이 있어요. 아래를 확인해 주세요.', 'warn');
  }

  sampleButton.addEventListener('click', () => {
    titleInput.value = SAMPLE_TITLE;
    bodyInput.value = SAMPLE_BODY;
    report.replaceChildren();
    setStatus('시험 글을 불러왔어요. 글쓰기 화면을 연 탭에서 [채우기]를 눌러 주세요.');
  });

  fillButton.addEventListener('click', () =>
    guarded(fillButton, (m) => setStatus(m, 'bad'), () => runFill(false)),
  );

  copyButton.addEventListener('click', () =>
    guarded(copyButton, (m) => setStatus(m, 'bad'), async () => {
      const parsed = parse();
      if (!parsed) return;
      await copyBlocks(parsed.blocks, palette);
      setStatus('복사했어요. 글쓰기 화면의 본문을 누르고 붙여넣어 주세요. 제목은 따로 적어 주세요.', 'ok');
    }),
  );

  restoreButton.addEventListener('click', () =>
    guarded(restoreButton, (m) => setStatus(m, 'bad'), async () => {
      const tab = await getNaverTab();
      if (!tab) {
        setStatus('지금 보고 있는 탭이 네이버 블로그가 아니에요.', 'warn');
        return;
      }
      const result = await restoreEditor(tab.id);
      report.replaceChildren();
      if (result && result.ok) setStatus('채우기 전의 글로 되돌렸어요.', 'ok');
      else setStatus(explain(result ? result.reason : 'no-editor'), 'bad');
    }),
  );

  setStatus('본문을 붙여넣거나 [시험 글 불러오기]를 눌러 주세요.');

  const element = h('section', { class: 'card' },
    h('h2', null, '글 채우기'),
    h('p', { class: 'hint' }, '네이버 글쓰기 화면에 글을 채워요. 저장이나 발행은 하지 않아요. 발행은 직접 눌러 주세요.'),
    titleInput,
    bodyInput,
    colorSettings,
    h('div', { class: 'buttons' }, sampleButton, fillButton, copyButton, restoreButton),
    status,
    report,
  );

  return {
    element,
    setContent(title, body) {
      titleInput.value = title;
      bodyInput.value = body;
      report.replaceChildren();
      setStatus('글을 가져왔어요. 네이버 글쓰기 화면을 연 탭에서 [채우기]를 눌러 주세요.', 'ok');
    },
  };
}
