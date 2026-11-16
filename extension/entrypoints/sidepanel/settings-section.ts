import { browser } from 'wxt/browser';
import { listModels, pickDefaultModel, PROVIDERS, type LLMProvider } from '../../lib/llm/client';
import { COMMON_KEY_NOTES, PROVIDER_GUIDES } from '../../lib/llm/providers';
import { describePack, validatePack } from '../../lib/prompts/pack';
import { loadKeys, loadPack, loadUsageToday, onStoreChange, saveKey, savePack, type SavedKey } from '../../lib/store';
import { errorText, guarded, h, num, option, setMessage } from './dom';

// 설정 화면: 프롬프트 묶음 불러오기, AI 키 넣기.
// 키는 이 컴퓨터의 확장 저장소에만 둔다. 화면에 다시 보여 주지 않는다 (끝 4자리만).

function packCard(): HTMLElement {
  const state = h('p', { class: 'message' });
  const message = h('p', { class: 'message' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json' });
  fileInput.hidden = true;
  const loadButton = h('button', { type: 'button', class: 'primary' }, '프롬프트 묶음 불러오기');
  const removeButton = h('button', { type: 'button' }, '지우기');

  async function draw(): Promise<void> {
    const pack = await loadPack();
    if (pack) setMessage(state, '불러온 묶음: ' + describePack(pack), 'ok');
    else setMessage(state, '아직 불러오지 않았어요. 글을 만들려면 먼저 불러와 주세요.', 'warn');
    removeButton.hidden = !pack;
  }

  loadButton.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () =>
    guarded(loadButton, (m) => setMessage(message, m, 'bad'), async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setMessage(message, '이 파일을 읽지 못했어요. 프롬프트 묶음 파일(.json)이 맞는지 확인해 주세요.', 'bad');
        return;
      }
      const check = validatePack(parsed);
      if (!check.ok) {
        setMessage(message, '프롬프트 묶음이 아니에요: ' + check.errors.join(' / '), 'bad');
        return;
      }
      await savePack(check.pack);
      setMessage(message, '불러왔어요. 이제 글쓰기와 SEO 8단계를 쓸 수 있어요.', 'ok');
      await draw();
    }),
  );

  removeButton.addEventListener('click', () =>
    guarded(removeButton, (m) => setMessage(message, m, 'bad'), async () => {
      await savePack(null);
      setMessage(message, '지웠어요.');
      await draw();
    }),
  );

  onStoreChange(['pack'], () => void draw());
  void draw();

  return h('section', { class: 'card' },
    h('h2', null, '프롬프트'),
    h('p', { class: 'hint' },
      '내 프롬프트(글쓰기 방식 6개, SEO 8단계)는 확장 안에 들어 있지 않아요. 묶음 파일을 한 번 불러오면 이 컴퓨터에 저장돼요.',
    ),
    state,
    h('div', { class: 'buttons' }, loadButton, removeButton, fileInput),
    message,
    h('details', null,
      h('summary', null, '묶음 파일은 어디에 있나요?'),
      h('p', { class: 'hint' }, 'blog_studio 폴더 안의 extension/prompt-pack/blog-studio-prompts.json 이에요.'),
      h('p', { class: 'hint' }, '웹의 프롬프트를 고친 뒤에는 extension 폴더에서 npm run prompts 로 다시 만들고, 여기서 다시 불러와 주세요.'),
    ),
  );
}

function providerCard(provider: LLMProvider): HTMLElement {
  const guide = PROVIDER_GUIDES[provider];
  const badge = h('span', { class: 'badge' });
  const keyInput = h('input', { type: 'password', class: 'field', autocomplete: 'off', spellcheck: 'false' });
  const modelSelect = h('select', { class: 'field' });
  const modelRow = h('label', { class: 'labeled' }, h('span', { class: 'label' }, '쓸 모델'), modelSelect);
  const message = h('p', { class: 'message' });
  const usageLine = h('p', { class: 'hint small' });
  const openButton = h('button', { type: 'button' }, '키 발급 페이지 열기');
  const checkButton = h('button', { type: 'button', class: 'primary' }, '확인');
  const removeButton = h('button', { type: 'button' }, '키 지우기');

  let saved: SavedKey | null = null;

  async function draw(): Promise<void> {
    saved = (await loadKeys())[provider] ?? null;
    if (saved) {
      badge.textContent = saved.model ? '쓸 수 있어요' : '모델을 골라 주세요';
      badge.className = 'badge ' + (saved.model ? 'ok' : 'warn');
      keyInput.placeholder = `저장된 키가 있어요 (끝자리 ${saved.key.slice(-4)}). 바꾸려면 새 키를 붙여넣어요`;
    } else {
      badge.textContent = '키 없음';
      badge.className = 'badge';
      keyInput.placeholder = '여기에 키를 붙여넣어요';
    }
    const models = saved?.models ?? [];
    modelSelect.replaceChildren(...models.map((m) => option(m.id, m.label === m.id ? m.id : `${m.label} (${m.id})`, m.id === saved?.model)));
    modelRow.hidden = models.length === 0;
    removeButton.hidden = !saved;

    const used = (await loadUsageToday())[provider];
    usageLine.textContent = used
      ? `오늘 쓴 양: 보낸 글 ${num(used.input)}토큰 · 받은 글 ${num(used.output)}토큰 · ${num(used.calls)}번. 요금은 발급 페이지의 사용량 화면에서 확인해 주세요.`
      : '오늘은 아직 쓰지 않았어요.';
  }

  openButton.addEventListener('click', () => void browser.tabs.create({ url: guide.keyUrl }));

  checkButton.addEventListener('click', () =>
    guarded(checkButton, (m) => setMessage(message, m, 'bad'), async () => {
      const key = keyInput.value.trim() || saved?.key || '';
      if (!key) {
        setMessage(message, '키를 붙여넣고 눌러 주세요.', 'warn');
        return;
      }
      setMessage(message, '키를 확인하는 중이에요…');
      let models;
      try {
        models = await listModels(provider, key);
      } catch (err) {
        setMessage(message, errorText(err), 'bad');
        return;
      }
      if (models.length === 0) {
        setMessage(message, '키는 맞지만 쓸 수 있는 글쓰기 모델이 없어요. 발급 페이지에서 결제나 권한을 확인해 주세요.', 'warn');
        return;
      }
      const keep = saved && saved.key === key && models.some((m) => m.id === saved?.model) ? saved.model : '';
      const model = keep || pickDefaultModel(provider, models);
      await saveKey(provider, { key, model, models, checkedAt: new Date().toISOString() });
      keyInput.value = '';
      await draw();
      setMessage(message, `확인했어요. 쓸 수 있는 모델 ${models.length}개 · 고른 모델 ${model}`, 'ok');
    }),
  );

  modelSelect.addEventListener('change', () => {
    if (!saved) return;
    void saveKey(provider, { ...saved, model: modelSelect.value }).then(draw);
  });

  removeButton.addEventListener('click', () =>
    guarded(removeButton, (m) => setMessage(message, m, 'bad'), async () => {
      await saveKey(provider, null);
      keyInput.value = '';
      setMessage(message, '키를 지웠어요.');
      await draw();
    }),
  );

  onStoreChange(['usage'], () => void draw());
  void draw();

  return h('section', { class: 'card' },
    h('h2', null, guide.name, ' ', badge),
    h('ol', { class: 'steps' }, ...guide.steps.map((s) => h('li', null, s))),
    ...guide.notes.map((n) => h('p', { class: 'hint small' }, n)),
    h('div', { class: 'buttons' }, openButton),
    keyInput,
    h('div', { class: 'buttons' }, checkButton, removeButton),
    modelRow,
    message,
    usageLine,
  );
}

export function createSettingsSection(): HTMLElement {
  return h('div', { class: 'stack' },
    packCard(),
    h('section', { class: 'card' },
      h('h2', null, 'AI 키'),
      h('p', { class: 'hint' }, '쓰고 싶은 AI 하나만 넣어도 돼요. 키를 붙여넣고 [확인]을 누르면 쓸 수 있는 모델을 보여 줘요. 확인에는 돈이 들지 않아요.'),
      ...COMMON_KEY_NOTES.map((n) => h('p', { class: 'hint small' }, n)),
    ),
    ...PROVIDERS.map(providerCard),
  );
}
