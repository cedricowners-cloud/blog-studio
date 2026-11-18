import { browser } from 'wxt/browser';
import { aiCopy, prepareImage, type PreparedImage } from '../../lib/editor/image-file';
import { LLMError, llmGenerate, resolveMaxTokens, type LLMImage } from '../../lib/llm/client';
import type { PromptPack } from '../../lib/prompts/pack';
import {
  arrangePhotos,
  buildReviewPrompt,
  canReview,
  countUnsure,
  MAX_PHOTOS,
  parseReview,
  photoSlotName,
  PURCHASES,
  type Purchase,
} from '../../lib/review/photo';
import { addUsage, loadPack, loadVoice, onStoreChange } from '../../lib/store';
import { createAiPicker } from './ai-picker';
import { errorText, field, h, num, option, seconds, setMessage, type Tone } from './dom';

// 사진 리뷰 화면: 내가 찍은 제품 사진과 짧은 메모로 리뷰 글을 만든다.
//   1. 사진을 고른다 (고른 순서가 사진 번호다).
//   2. 제품 이름과 메모(가격, 좋았던 점, 아쉬운 점)를 적는다.
//   3. AI가 사진을 보고 글을 쓰고, 사진을 넣을 자리를 글 속에 정한다.
//   4. [채우기로 보내기]를 누르면 글과 사진이 함께 채우기 화면으로 간다.
// 지키는 것:
//   - 사진과 메모는 사용자가 고른 AI 회사로만 보낸다. 작게 줄인 사본을 보낸다.
//   - AI는 사진에 보이는 것과 메모에 적힌 것만 사실로 쓴다. 모르는 것은 "확인 필요"로 남긴다.
//   - 제품을 제공받았으면 글 맨 위에 밝히게 한다.

export interface ReviewDeps {
  sendToFill: (title: string, body: string, images?: Map<string, PreparedImage>) => void;
  openSettings: () => void;
}

interface ReviewForm {
  product: string;
  notes: string;
  purchase: Purchase;
  useVoice: boolean;
}

const FORM_KEY = 'reviewForm';

const PURCHASE_LABELS: Record<Purchase, string> = {
  own: '내 돈으로 샀어요',
  sponsored: '제품이나 대가를 받았어요 (협찬, 체험단)',
  none: '글에서 말하지 않을게요',
};

/** 모델의 한도를 알 때 바라는 값과, 모를 때 쓰는 값 */
const WANTED_MAX_TOKENS = 16000;
const FALLBACK_MAX_TOKENS = 8192;

export function createReviewSection(deps: ReviewDeps): HTMLElement {
  let pack: PromptPack | null = null;
  let voiceCard: string | null = null;
  let photos: PreparedImage[] = [];
  let stopper: AbortController | null = null;

  const needPack = h('div', { class: 'notice' });
  const goSettings = h('button', { type: 'button' }, '설정 열기');
  goSettings.addEventListener('click', deps.openSettings);

  const picked = h('div', { class: 'photo-grid' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: 'multiple' });
  fileInput.hidden = true;
  const pickButton = h('button', { type: 'button' }, '사진 고르기');
  const photoMessage = h('p', { class: 'message' });

  const productInput = h('input', { type: 'text', class: 'field', placeholder: '예: 베이직기어 도킹스테이션' });
  const notesInput = h('textarea', {
    class: 'field prose',
    rows: '5',
    placeholder: '예: 5만 9천 원, 쿠팡에서 샀어요. 노트북에 모니터 두 대를 연결하려고 샀어요. 열이 덜 나서 좋았고, 선이 짧은 점은 아쉬웠어요. 2주 썼어요.',
  });
  const purchaseSelect = h('select', { class: 'field' }, ...PURCHASES.map((value) => option(value, PURCHASE_LABELS[value])));
  const voiceCheck = h('input', { type: 'checkbox' });
  const voiceNote = h('span', null, '');
  const picker = createAiPicker(deps.openSettings);
  const makeButton = h('button', { type: 'button', class: 'primary' }, '리뷰 글 만들기');
  const stopButton = h('button', { type: 'button' }, '멈추기');
  stopButton.hidden = true;
  const message = h('p', { class: 'message' });
  const resultBox = h('div', { class: 'stack' });

  const say = (text: string, tone: Tone = '') => setMessage(message, text, tone);

  const readForm = (): ReviewForm => ({
    product: productInput.value,
    notes: notesInput.value,
    purchase: purchaseSelect.value as Purchase,
    useVoice: voiceCheck.checked,
  });
  const saveForm = () => void browser.storage.local.set({ [FORM_KEY]: readForm() });
  for (const el of [productInput, notesInput, purchaseSelect, voiceCheck]) el.addEventListener('change', saveForm);

  function drawPhotos(): void {
    picked.replaceChildren(
      ...photos.map((photo, index) => {
        const remove = h('button', { type: 'button', class: 'photo-remove', 'aria-label': `사진 ${index + 1} 빼기` }, '빼기');
        remove.addEventListener('click', () => {
          photos = photos.filter((item) => item !== photo);
          drawPhotos();
        });
        const image = h('img', { src: photo.dataUrl, alt: photo.originalName });
        return h('div', { class: 'photo-cell' }, image, h('span', { class: 'photo-number' }, `사진 ${index + 1}`), remove);
      }),
    );
    pickButton.textContent = photos.length > 0 ? '사진 더 고르기' : '사진 고르기';
    setMessage(photoMessage, photos.length > 0 ? `사진 ${photos.length}장을 골랐어요 (${MAX_PHOTOS}장까지). 번호는 고른 순서예요.` : '', '');
  }

  pickButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    void (async () => {
      const problems: string[] = [];
      for (const file of files) {
        if (photos.length >= MAX_PHOTOS) {
          problems.push(`사진은 ${MAX_PHOTOS}장까지 넣을 수 있어요. 나머지는 넣지 않았어요.`);
          break;
        }
        try {
          photos = [...photos, await prepareImage(file, photos.length + 1)];
        } catch (err) {
          problems.push(errorText(err));
        }
      }
      drawPhotos();
      if (problems.length > 0) setMessage(photoMessage, problems.join(' '), 'warn');
    })();
  });

  function showVoice(): void {
    voiceCheck.disabled = !voiceCard;
    if (!voiceCard) voiceCheck.checked = false;
    voiceNote.textContent = voiceCard
      ? '내 말투로 쓰기 ("내 말투" 탭에서 정리한 말투를 써요)'
      : '내 말투로 쓰기 (아직 정리한 말투가 없어요. "내 말투" 탭에서 내 글을 모아 정리하면 쓸 수 있어요)';
  }

  function showPackState(): void {
    const ready = pack !== null && canReview(pack);
    needPack.hidden = ready;
    needPack.replaceChildren(
      h('p', { class: 'message warn' },
        pack
          ? '받아 둔 프롬프트가 예전 것이라 사진 리뷰를 쓸 수 없어요. 설정에서 [프롬프트 새로 받기]를 눌러 주세요.'
          : '프롬프트가 아직 없어요. 설정에서 로그인하면 받아 와요.',
      ),
      h('div', { class: 'buttons' }, goSettings),
    );
    makeButton.disabled = !ready || stopper !== null;
  }

  /** 만든 글을 보여 주고, 고쳐서 채우기로 보낼 수 있게 한다 */
  function showResult(titles: string[], body: string, used: PreparedImage[], notes: string[], summary: string): void {
    const titleInput = h('input', { type: 'text', class: 'field' });
    titleInput.value = titles[0] ?? productInput.value.trim();
    const bodyArea = h('textarea', { class: 'field prose', rows: '16' });
    bodyArea.value = body;
    const unsure = h('p', { class: 'message' });
    const drawUnsure = () => {
      const count = countUnsure(bodyArea.value);
      setMessage(unsure, count > 0 ? `"확인 필요"가 ${count}곳 있어요. AI가 알 수 없었던 내용이에요. 채우기 전에 직접 고쳐 주세요.` : '', count > 0 ? 'warn' : '');
    };
    bodyArea.addEventListener('input', drawUnsure);
    drawUnsure();

    const others = titles.slice(1).map((title) => {
      const button = h('button', { type: 'button', class: 'link' }, title);
      button.addEventListener('click', () => {
        titleInput.value = title;
      });
      return h('li', null, button);
    });

    const fillButton = h('button', { type: 'button', class: 'primary' }, '채우기로 보내기');
    fillButton.addEventListener('click', () => {
      const images = new Map<string, PreparedImage>();
      used.forEach((photo, index) => images.set(photoSlotName(index + 1), photo));
      deps.sendToFill(titleInput.value.trim(), bodyArea.value, images);
    });

    resultBox.replaceChildren(
      h('section', { class: 'card' },
        h('h2', null, '만든 리뷰 글'),
        h('p', { class: 'hint small' }, summary),
        ...notes.map((note) => h('p', { class: 'message warn' }, note)),
        unsure,
        field('제목', titleInput),
        others.length > 0 ? h('div', null, h('p', { class: 'hint small' }, '다른 제목 (누르면 바뀌어요)'), h('ul', { class: 'plain' }, ...others)) : null,
        field('본문 ([IMG: 사진1 - …] 줄이 사진이 들어갈 자리예요)', bodyArea),
        h('p', { class: 'hint small' }, 'AI가 쓴 글이에요. 내가 실제로 겪은 것과 다른 곳이 없는지 읽어 보고 고쳐 주세요.'),
        h('div', { class: 'buttons' }, fillButton),
      ),
    );
  }

  async function make(): Promise<void> {
    if (!pack || !canReview(pack)) return;
    const form = readForm();
    if (photos.length === 0) {
      say('사진을 한 장 이상 골라 주세요.', 'warn');
      return;
    }
    if (!form.product.trim()) {
      say('제품 이름을 적어 주세요.', 'warn');
      return;
    }
    const ai = picker.current();
    if (!ai) {
      say('AI 키가 없어요. 설정에서 키를 넣고 [확인]을 눌러 주세요.', 'warn');
      return;
    }
    const used = [...photos];
    const built = buildReviewPrompt(pack, { ...form, photoCount: used.length, voiceCard: form.useVoice ? voiceCard : null });
    if (!built) return;

    stopper = new AbortController();
    const startedAt = Date.now();
    let chars = 0;
    let waiting = '사진을 보내려고 줄이는 중';
    const draw = () => say(`${waiting || (chars > 0 ? `받은 글 ${num(chars)}자` : 'AI가 사진을 보는 중')} · ${seconds(Date.now() - startedAt)} · 만드는 동안 이 창을 닫지 마세요`);
    const ticker = setInterval(draw, 1000);
    makeButton.disabled = true;
    stopButton.hidden = false;
    resultBox.replaceChildren();
    draw();

    try {
      const images: LLMImage[] = [];
      for (const [index, photo] of used.entries()) images.push({ ...(await aiCopy(photo)), label: built.labels[index] });
      waiting = '';
      const result = await llmGenerate(
        built.prompt,
        {
          provider: ai.provider,
          model: ai.model,
          apiKey: ai.key,
          temperature: 0.7,
          maxTokens: resolveMaxTokens(WANTED_MAX_TOKENS, FALLBACK_MAX_TOKENS, ai.modelInfo),
          signal: stopper.signal,
          onProgress: (count) => {
            chars = count;
            waiting = '';
          },
          onRetry: (waitMs, why) => {
            waiting = `${why} · ${seconds(waitMs)} 뒤에 다시 시도`;
          },
        },
        images,
      );
      await addUsage(ai.provider, result.usage);

      const parsed = parseReview(result.text);
      if (!parsed) {
        say('AI의 답에서 글을 찾지 못했어요. 한 번 더 눌러 주세요.', 'bad');
        return;
      }
      const plan = arrangePhotos(parsed.body, used.length);
      const notes: string[] = [];
      if (result.stopReason === 'length') notes.push('글이 길어서 끝까지 받지 못했어요. 끝부분을 확인해 주세요.');
      if (plan.appended.length > 0) notes.push(`AI가 글에 넣지 않은 사진 ${plan.appended.length}장(${plan.appended.map((n) => `사진 ${n}`).join(', ')})은 글 끝에 붙였어요. 자리를 옮기려면 본문에서 그 줄을 옮겨 주세요.`);
      if (plan.dropped > 0) notes.push(`쓸 수 없는 사진 자리 ${plan.dropped}곳은 지웠어요 (없는 번호이거나 두 번 쓴 번호).`);
      showResult(
        parsed.titles,
        plan.body,
        used,
        notes,
        `사진 ${used.length}장 · ${seconds(Date.now() - startedAt)} · 모델 ${ai.model} · 보낸 양 ${num(result.usage.input_tokens)}토큰 · 받은 글 ${num(result.usage.output_tokens)}토큰`,
      );
      say('다 만들었어요. 아래에서 읽어 보고 고친 뒤 [채우기로 보내기]를 눌러 주세요.', 'ok');
    } catch (err) {
      const hint = err instanceof LLMError && err.kind === 'bad-request' ? ' 이 모델이 사진을 읽지 못할 수도 있어요. 설정에서 다른 모델을 골라 보세요.' : '';
      say(errorText(err) + hint, 'bad');
    } finally {
      clearInterval(ticker);
      stopper = null;
      stopButton.hidden = true;
      showPackState();
    }
  }

  makeButton.addEventListener('click', () => void make());
  stopButton.addEventListener('click', () => stopper?.abort());

  async function refresh(): Promise<void> {
    pack = await loadPack();
    voiceCard = (await loadVoice()).card?.text?.trim() || null;
    showPackState();
    showVoice();
  }
  onStoreChange(['pack', 'voice'], () => void refresh());

  void browser.storage.local.get(FORM_KEY).then(async (saved) => {
    const value = saved[FORM_KEY] as Partial<ReviewForm> | undefined;
    await refresh();
    if (value) {
      productInput.value = typeof value.product === 'string' ? value.product : '';
      notesInput.value = typeof value.notes === 'string' ? value.notes : '';
      purchaseSelect.value = PURCHASES.includes(value.purchase as Purchase) ? (value.purchase as Purchase) : 'own';
      voiceCheck.checked = value.useVoice !== false && voiceCard !== null;
    } else {
      voiceCheck.checked = voiceCard !== null;
    }
  });
  drawPhotos();

  const form = h('section', { class: 'card' },
    h('h2', null, '사진으로 리뷰 쓰기'),
    h('p', { class: 'hint' }, '내가 찍은 제품 사진과 짧은 메모를 주면, AI가 사진을 보고 리뷰 글을 써요. 사진이 들어갈 자리도 글 속에 정해 줘요.'),
    needPack,
    h('div', { class: 'labeled' },
      h('span', { class: 'label' }, '제품 사진'),
      picked,
      h('div', { class: 'buttons' }, pickButton),
      fileInput,
      photoMessage,
      h('span', { class: 'hint small' }, '사진과 메모는 아래에서 고른 AI 회사로 보내요 (작게 줄인 사본). 얼굴, 주소, 송장처럼 보이면 안 되는 것이 찍힌 사진은 빼 주세요.'),
    ),
    field('제품 이름', productInput),
    field('메모 (가격, 산 곳, 쓴 기간, 좋았던 점, 아쉬운 점. 적은 것만 사실로 써요)', notesInput, '메모가 없으면 AI는 사진에 보이는 것만 쓰고, 모르는 곳은 "확인 필요"로 남겨요.'),
    field('이 제품은', purchaseSelect, '제품이나 대가를 받고 쓰는 글은 그 사실을 글 첫머리에 밝혀야 해요. 고르면 AI가 맨 위에 적어요.'),
    h('label', { class: 'check' }, voiceCheck, voiceNote),
    h('div', { class: 'labeled' }, h('span', { class: 'label' }, '글을 쓸 AI (사진을 읽을 수 있는 모델이어야 해요)'), picker.element),
    h('div', { class: 'buttons' }, makeButton, stopButton),
    message,
  );

  return h('div', { class: 'stack' }, form, resultBox);
}
