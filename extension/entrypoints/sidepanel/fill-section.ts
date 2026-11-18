import { browser } from 'wxt/browser';
import { parseMarkup } from '../../lib/blocks/parse-markup';
import type { Block, Palette } from '../../lib/blocks/types';
import { copyBlocks } from '../../lib/clipboard';
import { DEFAULT_PALETTE, normalizeHex, readableOnWhite, resolvePalette } from '../../lib/color';
import { buildComponents, imagePlaceholderText } from '../../lib/editor/build';
import { prepareImage, type PreparedImage } from '../../lib/editor/image-file';
import { beginImages, cancelImages, fillEditor, finishImages, getNaverTab, pasteImage, restoreEditor } from '../../lib/editor/run';
import type { FillResult, ImagesFinishResult } from '../../lib/editor/types';
import { createCardMaker } from './cards-section';
import { errorText, guarded, h, num, type Tone } from './dom';

// 2·3단계(E2, E3) 화면: 본문을 네이버 글쓰기 화면에 채운다.
// 본문은 직접 붙여넣거나, 글쓰기·SEO 화면에서 [채우기로 보내기]로 넘겨받는다.
// 웹과 연결하는 E4 단계에서 "발행 대기 글 목록"이 더해진다.
// 본문의 이미지 자리([IMG: 설명])마다 내 컴퓨터의 사진을 골라 두면, 글을 채운 뒤 그 자리에 넣는다.
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
  hidden: '글쓰기 탭이 화면에 보이지 않아요. 그 탭을 보고 있는 상태에서 다시 눌러 주세요. 사진은 보이는 탭에만 붙여넣을 수 있어요.',
  'no-paste-target': '에디터에서 사진을 받는 곳을 찾지 못했어요. 네이버가 에디터를 바꿨을 수 있어요. 사진은 네이버 화면에서 직접 넣어 주세요.',
  'no-upload': '사진이 네이버에 올라가지 않았어요. 글은 사진을 넣기 전의 모습으로 돌려놓았어요. 잠시 뒤에 [사진만 넣기]로 다시 해 주세요.',
  'nothing-pasted': '사진을 한 장도 붙여넣지 못했어요. 글은 그대로예요.',
  'not-started': '사진 넣기가 중간에 끊겼어요. [사진만 넣기]로 다시 해 주세요.',
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
  /**
   * 글쓰기나 SEO 화면에서 만든 글을 넘겨받는다.
   * images 가 있으면 자리 이름이 같은 사진 자리에 그 사진을 미리 골라 둔다 (사진 리뷰: "사진1" → 첫 번째 사진).
   */
  setContent(title: string, body: string, images?: Map<string, PreparedImage>): void;
}

export interface FillDeps {
  openSettings: () => void;
}

export function createFillSection(deps: FillDeps): FillSection {
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

  // ───────── 사진: 본문의 이미지 자리마다 사진을 골라 둔다 ─────────
  /** 이미지 자리의 순서(0부터) → 고른 사진 */
  const chosen = new Map<number, PreparedImage>();
  const imageBox = h('div', { class: 'notice' });
  const imageMessage = h('p', { class: 'message' });

  const imageSlots = () =>
    parseMarkup(bodyInput.value).blocks.flatMap((block) => (block.kind === 'image' ? [block] : []));

  async function pickFor(index: number, file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      chosen.set(index, await prepareImage(file, index + 1));
      imageMessage.textContent = '';
    } catch (err) {
      imageMessage.textContent = errorText(err);
      imageMessage.className = 'message bad';
    }
    drawImages();
  }

  function drawImages(): void {
    const slots = imageSlots();
    for (const index of [...chosen.keys()]) if (index >= slots.length) chosen.delete(index);
    imageBox.replaceChildren();

    const addSlot = h('button', { type: 'button' }, '사진 자리 더하기');
    addSlot.addEventListener('click', () => {
      bodyInput.value = bodyInput.value.replace(/\s*$/, '') + '\n\n[IMG: 사진]\n';
      drawImages();
    });

    if (slots.length === 0) {
      imageBox.append(
        h('p', { class: 'label' }, '사진'),
        h('p', { class: 'hint small' }, '본문에 [IMG: 설명] 줄을 넣으면 그 자리에 사진을 넣을 수 있어요. 지금은 사진 자리가 없어요.'),
        h('div', { class: 'buttons' }, addSlot),
        imageMessage,
      );
      return;
    }

    const many = h('input', { type: 'file', accept: 'image/*', multiple: 'multiple' });
    many.hidden = true;
    const manyButton = h('button', { type: 'button' }, '여러 장 한꺼번에 고르기');
    manyButton.addEventListener('click', () => many.click());
    many.addEventListener('change', () => {
      void (async () => {
        const files = [...(many.files ?? [])];
        many.value = '';
        // 아직 사진이 없는 자리부터 순서대로 채운다.
        const empty = slots.map((_, i) => i).filter((i) => !chosen.has(i));
        for (const [n, file] of files.entries()) {
          const index = empty[n];
          if (index === undefined) break;
          await pickFor(index, file);
        }
      })();
    });

    const rows = slots.map((slot, index) => {
      const image = chosen.get(index);
      const input = h('input', { type: 'file', accept: 'image/*' });
      input.hidden = true;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.value = '';
        void pickFor(index, file);
      });
      const pick = h('button', { type: 'button' }, image ? '바꾸기' : '사진 고르기');
      pick.addEventListener('click', () => input.click());
      const remove = h('button', { type: 'button', class: 'link muted' }, '빼기');
      remove.addEventListener('click', () => {
        chosen.delete(index);
        drawImages();
      });
      const thumb = h('div', { class: 'thumb' });
      if (image) {
        const preview = h('img', { alt: '' });
        preview.src = image.dataUrl;
        thumb.append(preview);
      }
      const label = slot.alt ? `${slot.slot} - ${slot.alt}` : slot.slot;
      return h('div', { class: 'slot-row' },
        thumb,
        h('div', { class: 'slot-text' },
          h('span', null, `${index + 1}. ${label}`),
          h('span', { class: 'hint small' },
            image ? `${image.originalName} · ${image.width}×${image.height} · ${num(Math.round(image.bytes / 1024))}KB` : '사진을 고르지 않았어요. 자리는 글자로 남아요.',
          ),
        ),
        h('div', { class: 'slot-buttons' }, pick, image ? remove : null, input),
      );
    });

    imageBox.append(
      h('p', { class: 'label' }, `사진 (자리 ${slots.length}곳 · 고른 사진 ${chosen.size}장)`),
      h('p', { class: 'hint small' }, '자리마다 내 컴퓨터의 사진을 골라 두면, 글을 채운 뒤 그 자리에 넣어요. 큰 사진은 긴 쪽 2000픽셀로 줄이고, 촬영 위치 같은 정보는 빼고 올려요.'),
      ...rows,
      h('div', { class: 'buttons' }, manyButton, addSlot, many),
      imageMessage,
    );
  }

  /**
   * 카드를 글에 넣는다: 카드 자리가 들어간 본문으로 바꾸고, 자리 이름이 같은 곳에 카드 그림을 둔다.
   * 본문에 자리가 새로 끼어들면 자리의 순서가 밀린다. 먼저 골라 둔 사진은 같은 자리를 다시 찾아 준다.
   */
  function applyCards(body: string, images: Map<string, PreparedImage>): void {
    const keyOf = (slot: { slot: string; alt: string }) => `${slot.slot}|${slot.alt}`;
    const occurrence = (list: { slot: string; alt: string }[], index: number) =>
      list.slice(0, index).filter((slot) => keyOf(slot) === keyOf(list[index] as { slot: string; alt: string })).length;

    const before = imageSlots();
    const kept = [...chosen.entries()].flatMap(([index, image]) => {
      const slot = before[index];
      return slot ? [{ key: keyOf(slot), nth: occurrence(before, index), image }] : [];
    });

    bodyInput.value = body;
    chosen.clear();
    const after = imageSlots();
    after.forEach((slot, index) => {
      const card = images.get(slot.slot);
      if (card) {
        chosen.set(index, card);
        return;
      }
      const old = kept.find((item) => item.key === keyOf(slot) && item.nth === occurrence(after, index));
      if (old) chosen.set(index, old.image);
    });
    drawImages();
    imageBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const cardMaker = createCardMaker({
    getTitle: () => titleInput.value,
    getBody: () => bodyInput.value,
    getBrandColor: () => palette.positive,
    apply: applyCards,
    openSettings: deps.openSettings,
  });

  let slotTimer: ReturnType<typeof setTimeout> | undefined;
  bodyInput.addEventListener('input', () => {
    clearTimeout(slotTimer);
    slotTimer = setTimeout(drawImages, 400);
  });

  function describeImages(result: ImagesFinishResult, wanted: number): { text: string; tone: Tone } {
    if (result.ok && result.placed === wanted && result.appended === 0) {
      return { text: `사진 ${wanted}장을 자리에 넣었어요.`, tone: 'ok' };
    }
    const parts = [`사진 ${wanted}장 중 ${result.placed}장을 자리에 넣었어요.`];
    if (result.uploaded < wanted) parts.push(`${wanted - result.uploaded}장은 네이버에 올라가지 않았어요.`);
    if (result.appended > 0) parts.push(`${result.appended}장은 자리를 찾지 못해 글 끝에 붙였어요.`);
    if (!result.ok && result.reason === 'mismatch') parts.push('넣은 뒤 다시 읽어 보니 사진 수가 달라요. 화면에서 확인해 주세요.');
    return { text: parts.join(' '), tone: 'warn' };
  }

  /**
   * 고른 사진을 글쓰기 화면의 이미지 자리에 넣는다. 글이 먼저 채워져 있어야 한다 (자리가 글자로 들어가 있어야 한다).
   * 넣을 사진이 없으면 아무 일도 하지 않고 null 을 돌려준다.
   */
  async function runImages(tabId: number): Promise<{ text: string; tone: Tone } | null> {
    const slots = imageSlots();
    const picks = slots.map((_, index) => chosen.get(index)).filter((image): image is PreparedImage => !!image);
    if (picks.length === 0) return null;

    setStatus('사진을 넣을 준비를 하는 중이에요…');
    const start = await beginImages(tabId);
    if (!start) return { text: '글쓰기 화면에서 응답이 없어요. 탭을 새로 고친 뒤 다시 해 주세요.', tone: 'bad' };
    if (!start.ok) return { text: explain(start.reason), tone: 'bad' };

    const problems: string[] = [];
    try {
      for (const [n, image] of picks.entries()) {
        setStatus(`사진을 올리는 중이에요 (${n + 1}/${picks.length}). 글쓰기 탭을 보고 있어 주세요.`);
        const pasted = await pasteImage(tabId, start.frameId, { name: image.name, dataUrl: image.dataUrl });
        if (!pasted || !pasted.ok) {
          problems.push(`${image.originalName}: ${explain(pasted ? pasted.reason : 'no-editor')}`);
          if (pasted?.reason === 'hidden') break;
        }
      }
      setStatus('네이버에 사진이 올라가기를 기다리는 중이에요. 글쓰기 탭을 보고 있어 주세요.');
      const finished = await finishImages(tabId, start.frameId, {
        slots: slots.map((slot, index) => ({ text: imagePlaceholderText(slot.slot, slot.alt), fileName: chosen.get(index)?.name ?? null })),
        timeoutMs: 60_000 + picks.length * 30_000,
      });
      if (!finished) return { text: '글쓰기 화면에서 응답이 없어요. 화면에서 사진이 들어갔는지 확인해 주세요.', tone: 'bad' };

      report.append(
        h('details', null,
          h('summary', null, '사진 넣기 기록'),
          h('p', { class: 'mono' }, [`붙여넣기를 받은 곳: ${start.target}`, ...finished.log, ...problems].join(' / ')),
        ),
      );
      if (finished.reason && finished.reason !== 'mismatch') return { text: explain(finished.reason), tone: 'bad' };
      return describeImages(finished, picks.length);
    } catch (err) {
      // 중간에 끊기면 쪼개진 글을 붙여넣기 전의 모습으로 돌려놓는다.
      await cancelImages(tabId, start.frameId).catch(() => {});
      return { text: '사진을 넣다가 멈췄어요. 글은 사진을 넣기 전의 모습으로 돌려놓았어요. (' + errorText(err) + ')', tone: 'bad' };
    }
  }

  const sampleButton = h('button', { type: 'button' }, '시험 글 불러오기');
  const imagesButton = h('button', { type: 'button' }, '사진만 넣기');
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
    if (!result.ok) {
      setStatus('채웠지만 다른 곳이 있어요. 아래를 확인해 주세요. 사진은 넣지 않았어요.', 'warn');
      return;
    }
    const filled = `글을 채웠어요 (부품 ${result.sentCount}개).`;
    const images = await runImages(tab.id);
    if (!images) setStatus(filled + ' 넣은 것과 다시 읽은 것이 같아요.', 'ok');
    else setStatus(`${filled} ${images.text}`, images.tone);
  }

  imagesButton.addEventListener('click', () =>
    guarded(imagesButton, (m) => setStatus(m, 'bad'), async () => {
      if (chosen.size === 0) {
        setStatus('넣을 사진을 먼저 골라 주세요.', 'warn');
        return;
      }
      const tab = await getNaverTab();
      if (!tab) {
        setStatus('지금 보고 있는 탭이 네이버 블로그가 아니에요. 글쓰기 화면을 연 탭에서 눌러 주세요.', 'warn');
        return;
      }
      report.replaceChildren();
      const images = await runImages(tab.id);
      if (images) setStatus(images.text, images.tone);
    }),
  );

  sampleButton.addEventListener('click', () => {
    titleInput.value = SAMPLE_TITLE;
    bodyInput.value = SAMPLE_BODY;
    chosen.clear();
    drawImages();
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
  drawImages();

  const element = h('section', { class: 'card' },
    h('h2', null, '글 채우기'),
    h('p', { class: 'hint' }, '네이버 글쓰기 화면에 글을 채워요. 저장이나 발행은 하지 않아요. 발행은 직접 눌러 주세요.'),
    titleInput,
    bodyInput,
    imageBox,
    cardMaker,
    colorSettings,
    h('div', { class: 'buttons' }, sampleButton, fillButton, imagesButton, copyButton, restoreButton),
    status,
    report,
  );

  return {
    element,
    setContent(title, body, images) {
      titleInput.value = title;
      bodyInput.value = body;
      chosen.clear();
      let placed = 0;
      if (images) {
        imageSlots().forEach((slot, index) => {
          const image = images.get(slot.slot);
          if (!image) return;
          chosen.set(index, image);
          placed += 1;
        });
      }
      drawImages();
      report.replaceChildren();
      setStatus(
        placed > 0
          ? `글과 사진 ${placed}장을 가져왔어요. 네이버 글쓰기 화면을 연 탭에서 [채우기]를 누르면 글을 채우고 사진을 자리에 넣어요.`
          : '글을 가져왔어요. 네이버 글쓰기 화면을 연 탭에서 [채우기]를 눌러 주세요.',
        'ok',
      );
    },
  };
}
