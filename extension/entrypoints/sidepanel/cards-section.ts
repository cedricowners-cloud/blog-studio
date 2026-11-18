import { browser } from 'wxt/browser';
import type { PreparedImage } from '../../lib/editor/image-file';
import { llmGenerate, resolveMaxTokens } from '../../lib/llm/client';
import {
  applyRewrites,
  blogCards,
  bodyShape,
  buildCards,
  buildRewritePrompt,
  knownNumbers,
  missingRewrites,
  numbersNotInBody,
  parseRewrites,
  rewritePayload,
  type Card,
} from '../../lib/cards/parser';
import {
  cardStyle,
  cardToImage,
  CARD_DESIGNS,
  CARD_SIZES,
  drawCard,
  drawCardSmall,
  isCardDesign,
  type CardDesign,
  type CardSize,
} from '../../lib/cards/render';
import { loadCardFont } from '../../lib/cards/font';
import { applyCardSlots, withoutImageSlots, type SlotCard } from '../../lib/cards/slots';
import { addUsage, loadPack } from '../../lib/store';
import { createAiPicker } from './ai-picker';
import { errorText, field, guarded, h, option, setMessage, type Tone } from './dom';

// 블로그용 카드 만들기. 본문의 소제목마다 요약 카드를 한 장씩 그리고, 글 맨 위에 표지 카드를 둔다.
// 카드의 내용은 웹의 카드 기능과 같은 방식으로 만든다 (lib/cards/parser.ts).
// 만든 카드는 채우기 화면의 사진 자리에 들어가고, 글을 채울 때 사진과 같은 방법으로 올라간다.

export interface CardMakerDeps {
  getTitle: () => string;
  getBody: () => string;
  /** 내 브랜드 색. 채우기 화면의 색 설정에서 정한 긍정 강조 색이다 */
  getBrandColor: () => string;
  /** 카드 자리를 넣은 본문과 카드 그림을 채우기 화면에 넘긴다. 자리 이름 → 그림 */
  apply: (body: string, images: Map<string, PreparedImage>) => void;
  openSettings: () => void;
}

interface CardItem {
  card: Card;
  /** 내용 카드가 놓일 소제목. 카드의 글을 고쳐도 자리는 이 소제목 아래다 */
  anchor: string;
  included: boolean;
}

interface CardOptions {
  size: CardSize;
  design: CardDesign;
  brandName: string;
  includeCover: boolean;
  useAi: boolean;
}

const OPTIONS_KEY = 'cardOptions';
// AI로 다듬기는 기본으로 끈다. 카드의 숫자와 말이 본문과 달라지지 않게 하려는 것이다 (DESIGN-detail.md 4.3).
const DEFAULT_OPTIONS: CardOptions = { size: 'square', design: 'magazine', brandName: '', includeCover: true, useAi: false };

// 모양을 고르는 칸의 작은 그림에 쓰는 보기 카드
const SAMPLE_CARD: Card = {
  type: 'content',
  section_label: 'POINT 01',
  heading: '소제목이 들어가요',
  lead: '핵심 문장은 10년, 5,000만 원처럼 숫자가 돋보여요.',
  body_text: '설명 글이 이어져요.',
};

export function createCardMaker(deps: CardMakerDeps): HTMLElement {
  let options: CardOptions = { ...DEFAULT_OPTIONS };
  let items: CardItem[] = [];

  const sizeSelect = h('select', { class: 'field' }, ...(Object.keys(CARD_SIZES) as CardSize[]).map((size) => option(size, CARD_SIZES[size].label)));
  const brandInput = h('input', { type: 'text', class: 'field', placeholder: '예: 가나다 경영연구소 (비워도 돼요)' });
  const coverCheck = h('input', { type: 'checkbox' });
  const aiCheck = h('input', { type: 'checkbox' });
  const picker = createAiPicker(deps.openSettings);
  const aiRow = h('div', null, picker.element);
  const makeButton = h('button', { type: 'button', class: 'primary' }, '카드 만들기');
  const applyButton = h('button', { type: 'button', class: 'primary' }, '카드를 글에 넣기');
  const message = h('p', { class: 'message' });
  const list = h('div', { class: 'stack' });
  // [카드를 글에 넣기]는 카드들 아래에 둔다. 카드를 다 읽고 고친 다음에 누르는 버튼이기 때문이다.
  // 눌렀을 때의 안내도 버튼 바로 아래에 보여 준다 (위쪽 안내는 화면 밖으로 밀려나 있다).
  const applyMessage = h('p', { class: 'message' });
  const applyRow = h('div', null, h('div', { class: 'buttons' }, applyButton), applyMessage);
  applyRow.hidden = true;

  const say = (text: string, tone: Tone = '') => setMessage(message, text, tone);
  const sayApply = (text: string, tone: Tone = '') => setMessage(applyMessage, text, tone);
  const style = () => cardStyle(options.size, deps.getBrandColor(), options.brandName, options.design);
  /** 눈에 띄게 해도 되는 숫자: 제목과 본문에 있는 숫자뿐이다 */
  const known = () => knownNumbers(deps.getTitle(), deps.getBody());

  // 카드 모양을 고르는 칸. 모양마다 작은 그림을 보여 주고, 누르면 그 모양으로 바뀐다.
  const designPicks = new Map<CardDesign, { button: HTMLButtonElement; canvas: HTMLCanvasElement }>();
  const designGrid = h('div', { class: 'design-grid' });
  for (const design of Object.keys(CARD_DESIGNS) as CardDesign[]) {
    const canvas = h('canvas', { class: 'design-thumb' });
    const button = h('button', { type: 'button', class: 'design-pick' }, canvas, h('span', null, CARD_DESIGNS[design].label));
    button.addEventListener('click', () => {
      options = { ...options, design };
      saveOptions();
      showDesign();
      drawList();
    });
    designPicks.set(design, { button, canvas });
    designGrid.append(button);
  }

  function showDesign(): void {
    for (const [design, { button }] of designPicks) {
      const on = design === options.design;
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('on', on);
    }
  }

  /** 작은 그림을 지금의 크기와 색으로 다시 그린다 */
  function drawThumbs(): void {
    for (const [design, { canvas }] of designPicks) {
      try {
        drawCardSmall(canvas, SAMPLE_CARD, cardStyle(options.size, deps.getBrandColor(), options.brandName, design), 240);
      } catch {
        // 작은 그림을 못 그려도 모양을 고르는 데는 지장이 없다.
      }
    }
  }

  const saveOptions = () => void browser.storage.local.set({ [OPTIONS_KEY]: options });

  function readOptions(): void {
    options = { ...options, size: sizeSelect.value as CardSize, brandName: brandInput.value, includeCover: coverCheck.checked, useAi: aiCheck.checked };
    aiRow.hidden = !options.useAi;
    saveOptions();
  }

  function showOptions(): void {
    showDesign();
    sizeSelect.value = options.size;
    brandInput.value = options.brandName;
    coverCheck.checked = options.includeCover;
    aiCheck.checked = options.useAi;
    aiRow.hidden = !options.useAi;
  }

  /** 카드 한 장의 미리보기와 고치는 칸 */
  function cardRow(item: CardItem, order: number): HTMLElement {
    const canvas = h('canvas', { class: 'card-canvas' });
    const warning = h('p', { class: 'hint small warn' });
    const redraw = () => {
      try {
        drawCard(canvas, item.card, style(), known());
      } catch (err) {
        say(errorText(err), 'bad');
      }
      const missing = numbersNotInBody(item.card, deps.getTitle(), deps.getBody());
      warning.textContent = missing.length > 0 ? `본문에 없는 숫자가 있어요: ${missing.join(', ')}. 본문과 같은지 확인해 주세요.` : '';
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const input = (label: string, value: string, rows: number, onChange: (text: string) => void) => {
      const el = rows > 1 ? h('textarea', { class: 'field prose', rows: String(rows) }) : h('input', { type: 'text', class: 'field' });
      el.value = value;
      el.addEventListener('input', () => {
        onChange(el.value);
        clearTimeout(timer);
        timer = setTimeout(redraw, 250);
      });
      return field(label, el);
    };

    const card = item.card;
    const fields: HTMLElement[] =
      card.type === 'cover'
        ? [
            input('위의 작은 글', card.eyebrow, 1, (t) => (card.eyebrow = t)),
            input('큰 제목', card.main_title, 2, (t) => (card.main_title = t)),
            input('아래 글', card.sub_title ?? '', 1, (t) => (card.sub_title = t)),
          ]
        : card.type === 'content'
          ? [
              input('소제목', card.heading, 1, (t) => (card.heading = t)),
              input('핵심 문장', card.lead, 2, (t) => (card.lead = t)),
              input('설명', card.body_text, 3, (t) => (card.body_text = t)),
            ]
          : [];

    const include = h('input', { type: 'checkbox' });
    include.checked = item.included;
    include.addEventListener('change', () => {
      item.included = include.checked;
    });

    redraw();
    return h('div', { class: 'card-row' },
      h('label', { class: 'check' }, include, h('span', null, card.type === 'cover' ? '표지 카드 (글 맨 위)' : `카드 ${order} · "${item.anchor}" 아래`)),
      canvas,
      warning,
      h('details', { class: 'more' }, h('summary', null, '글 고치기'), ...fields),
    );
  }

  function drawList(): void {
    list.replaceChildren();
    let order = 0;
    for (const item of items) {
      if (item.card.type === 'content') order += 1;
      list.append(cardRow(item, order));
    }
    applyRow.hidden = items.length === 0;
  }

  /** 내용 카드의 문구를 AI로 다듬는다. 실패하면 규칙으로 만든 문구를 그대로 쓴다. */
  async function rewriteWithAi(title: string, built: ReturnType<typeof buildCards>): Promise<{ cards: Card[]; note: string }> {
    const pack = await loadPack();
    const payload = rewritePayload(built.cards, built.usedSections);
    const prompt = pack ? buildRewritePrompt(pack, title, payload) : null;
    if (!prompt) {
      // 묶음은 있는데 카드 문구 다듬기가 없으면 예전 묶음이다. 새로 받으면 된다.
      const why = pack
        ? ' 받아 둔 프롬프트가 예전 것이라 AI로 다듬지 못했어요. 설정에서 [프롬프트 새로 받기]를 눌러 주세요.'
        : ' AI로 다듬으려면 프롬프트가 있어야 해요 (설정에서 로그인).';
      return { cards: built.cards, note: `${why} 지금은 본문의 문장을 그대로 썼어요.` };
    }
    const ai = picker.current();
    if (!ai) return { cards: built.cards, note: ' AI 키가 없어서 본문의 문장을 그대로 썼어요.' };

    const ask = async () => {
      const result = await llmGenerate(prompt, {
        provider: ai.provider,
        model: ai.model,
        apiKey: ai.key,
        temperature: 0.5,
        maxTokens: resolveMaxTokens(8000, 4096, ai.modelInfo),
      });
      await addUsage(ai.provider, result.usage);
      return parseRewrites(result.text);
    };
    try {
      const rewrites = await ask();
      if (!rewrites || rewrites.size === 0) return { cards: built.cards, note: ' AI의 답을 알아보지 못해서 본문의 문장을 그대로 썼어요.' };
      // 빠뜨린 카드가 있으면 한 번 더 묻고, 빠졌던 것만 채운다.
      if (missingRewrites(rewrites, payload.length).length > 0) {
        const retry = await ask().catch(() => null);
        if (retry) for (const [index, value] of retry) if (!rewrites.has(index)) rewrites.set(index, value);
      }
      const left = missingRewrites(rewrites, payload.length).length;
      return { cards: applyRewrites(built.cards, rewrites), note: left > 0 ? ` 카드 ${left}장은 AI가 다듬지 못해 본문의 문장을 그대로 썼어요.` : ' AI가 문구를 다듬었어요.' };
    } catch (err) {
      return { cards: built.cards, note: ` AI로 다듬지 못했어요 (${errorText(err)}). 본문의 문장을 그대로 썼어요.` };
    }
  }

  makeButton.addEventListener('click', () =>
    guarded(makeButton, (m) => say(m, 'bad'), async () => {
      readOptions();
      sayApply('');
      await loadCardFont();
      const title = deps.getTitle().trim();
      const body = deps.getBody();
      if (!title || !body.trim()) {
        say('제목과 본문을 먼저 적어 주세요. 카드는 제목과 본문의 소제목으로 만들어요.', 'warn');
        return;
      }
      // 카드의 문구는 이미지 자리를 뺀 글로 만든다. 자리 표시가 카드에 찍히지 않게 한다.
      const source = withoutImageSlots(body);
      const shape = bodyShape(source);
      const built = buildCards({ title, body: source });
      let cards = built.cards;
      let note = '';
      if (options.useAi && shape !== 'paragraphs' && built.usedSections.length > 0) {
        say('AI가 카드의 문구를 다듬는 중이에요…');
        ({ cards, note } = await rewriteWithAi(title, built));
      }
      const chosen = blogCards({ cards, usedSections: built.usedSections }, shape, options.includeCover);
      const anchors = built.cards.filter((card) => card.type === 'content').map((card) => (card.type === 'content' ? card.heading : ''));
      let n = 0;
      items = chosen.map((card) => ({ card: { ...card }, anchor: card.type === 'content' ? (anchors[n++] ?? '') : '', included: true }));
      drawList();
      if (items.length === 0) {
        say('만들 카드가 없어요. 본문에 소제목([h2] 또는 ##)이 있어야 소제목마다 카드를 만들어요.', 'warn');
        return;
      }
      const contents = items.filter((item) => item.card.type === 'content').length;
      const noHeadings = shape === 'paragraphs' ? ' 본문에 소제목이 없어서 표지 카드만 만들었어요.' : '';
      say(`카드 ${items.length}장을 만들었어요 (표지 ${items.length - contents}장, 소제목 카드 ${contents}장).${note}${noHeadings} 글을 읽어 보고 고친 뒤 카드들 아래의 [카드를 글에 넣기]를 눌러 주세요.`, 'ok');
    }),
  );

  applyButton.addEventListener('click', () =>
    guarded(applyButton, (m) => sayApply(m, 'bad'), async () => {
      readOptions();
      await loadCardFont();
      const picked = items.filter((item) => item.included);
      if (picked.length === 0) {
        sayApply('넣을 카드를 하나 이상 골라 주세요.', 'warn');
        return;
      }
      const slotCards: SlotCard[] = picked.map((item) =>
        item.card.type === 'cover'
          ? { kind: 'cover', alt: item.card.main_title }
          : { kind: 'content', anchor: item.anchor, alt: item.card.type === 'content' ? item.card.heading : '' },
      );
      const slotted = applyCardSlots(deps.getBody(), slotCards);
      const images = new Map<string, PreparedImage>();
      const currentStyle = style();
      const numbers = known();
      let lost = 0;
      for (const [index, item] of picked.entries()) {
        const name = slotted.names[index];
        if (!name) {
          lost += 1;
          continue;
        }
        const label = item.card.type === 'cover' ? '표지 카드' : `카드: ${item.anchor}`;
        images.set(name, await cardToImage(item.card, currentStyle, index + 1, label, numbers));
      }
      deps.apply(slotted.body, images);
      sayApply(
        `카드 ${images.size}장을 글의 사진 자리에 넣었어요. [채우기]를 누르면 글과 함께 올라가요.` +
          (lost > 0 ? ` ${lost}장은 본문에서 소제목을 찾지 못해 넣지 못했어요 (본문을 고쳤다면 카드를 다시 만들어 주세요).` : ''),
        lost > 0 ? 'warn' : 'ok',
      );
    }),
  );

  for (const el of [sizeSelect, brandInput, coverCheck, aiCheck]) {
    el.addEventListener('change', () => {
      readOptions();
      drawList();
      if (root.open) drawThumbs();
    });
  }

  void browser.storage.local.get(OPTIONS_KEY).then((saved) => {
    const value = saved[OPTIONS_KEY] as Partial<CardOptions> | undefined;
    if (value) {
      options = {
        size: value.size === 'wide' ? 'wide' : 'square',
        design: isCardDesign(value.design) ? value.design : DEFAULT_OPTIONS.design,
        brandName: typeof value.brandName === 'string' ? value.brandName : '',
        includeCover: value.includeCover !== false,
        useAi: value.useAi === true,
      };
    }
    showOptions();
    if (root.open) drawThumbs();
  });
  showOptions();

  const root = h('details', { class: 'more' },
    h('summary', null, '블로그용 카드 만들기'),
    h('p', { class: 'hint small' }, '글 맨 위에 표지 카드를, 소제목마다 요약 카드를 한 장씩 만들어요. 색은 아래 "색 설정"의 긍정 강조 색(내 브랜드 색)을 써요.'),
    h('div', { class: 'labeled' }, h('span', { class: 'label' }, '카드 모양 (눌러서 골라요. 카드를 만든 뒤에 바꿔도 돼요)'), designGrid),
    field('카드 크기', sizeSelect),
    field('브랜드 이름 (카드 아래에 작게 들어가요)', brandInput),
    h('label', { class: 'check' }, coverCheck, h('span', null, '표지 카드 넣기 (대표 사진이 돼요)')),
    h('label', { class: 'check' }, aiCheck, h('span', null, 'AI로 문구 다듬기 (AI를 한두 번 불러요. 끄면 본문의 문장을 그대로 써요. 켜면 숫자가 본문과 같은지 꼭 확인해 주세요)')),
    aiRow,
    h('div', { class: 'buttons' }, makeButton),
    message,
    list,
    applyRow,
  );
  // 작은 그림은 이 칸을 열 때 그린다. 그 사이에 브랜드 색을 바꿨을 수 있어서 열 때마다 다시 그린다.
  // 카드의 글씨체를 먼저 불러온다. 불러오기 전에 그리면 컴퓨터의 글씨체로 그려진다.
  root.addEventListener('toggle', () => {
    if (!root.open) return;
    void loadCardFont().then(() => {
      drawThumbs();
      if (items.length > 0) drawList();
    });
  });
  return root;
}
