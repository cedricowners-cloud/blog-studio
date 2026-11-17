import { llmChat, resolveMaxTokens, type ChatMessage } from '../../lib/llm/client';
import type { PackSeoStep, PromptPack, SeoPlatform } from '../../lib/prompts/pack';
import {
  advance,
  createRun,
  extractTitles,
  initialMessageFor,
  pasteResult,
  resetStep,
  resultOf,
  runAll,
  selectTitle,
  sendMessage,
  startStep,
  stepsOf,
  stepUsesVoice,
  titleCandidates as findTitles,
  voiceAddition,
  type AutoSettings,
  type ChatFn,
  type SeoMode,
  type SeoRun,
} from '../../lib/seo/engine';
import {
  addUsage,
  deleteSeoRun,
  loadPack,
  loadSeoAutoForm,
  loadSeoRuns,
  loadVoice,
  onStoreChange,
  saveSeoAutoForm,
  saveSeoRun,
} from '../../lib/store';
import { needsAnalysis, titlesOf } from '../../lib/voice/library';
import { createAiPicker } from './ai-picker';
import { errorText, field, h, num, option, seconds, setMessage, type Tone } from './dom';
import { analyzeVoice, checkNewPosts } from './voice-actions';

// SEO 8단계 글쓰기 화면. 웹의 "SEO 글쓰기"와 같은 프롬프트 8개를 같은 순서로 돌린다.
// 다른 점: AI를 내 키로 직접 부르고, 진행 상황을 이 컴퓨터에 둔다.

export interface SeoDeps {
  sendToFill: (title: string, body: string) => void;
  openSettings: () => void;
}

/** 웹에서 쓰던 값. 모델의 한도를 모를 때 쓴다 */
const WEB_MAX_TOKENS = 8192;
const WANTED_MAX_TOKENS = 16000;

/** 시작 화면에서 고르는 진행 방식. step 과 auto 는 둘 다 내 키로 AI를 부른다 */
type StartMode = 'step' | 'auto' | 'copy';

const MODE_LABELS: Record<StartMode, string> = {
  step: '한 단계씩 · 보면서 직접 진행 (내 키 사용)',
  auto: '한 번에 끝까지 · AI가 차례로 진행 (내 키 사용)',
  copy: '프롬프트를 복사해서 직접 진행 (ChatGPT, Claude 화면에 붙여넣기)',
};

const describeMode = (run: SeoRun): string =>
  run.mode === 'copy' ? '복사해서 직접 진행' : run.auto ? '한 번에 끝까지' : '한 단계씩 진행';

export function createSeoSection(deps: SeoDeps): HTMLElement {
  const root = h('div', { class: 'stack' });
  const picker = createAiPicker(deps.openSettings);

  let pack: PromptPack | null = null;
  let runs: SeoRun[] = [];
  let current: SeoRun | null = null;
  /** 지금 보고 있는 단계 */
  let viewStepId: number | null = null;
  let stopper: AbortController | null = null;
  /** 직전 답이 길이 한도에 걸려 잘렸는지 */
  let lastTruncated = false;
  /** 다시 그려도 쓰던 글이 지워지지 않게 둔다 */
  let draft = '';
  /** 한 번에 돌리는 중이면, 지금 무엇을 하는지 (상태 줄 앞에 붙인다) */
  let phase = '';
  /** 모아 둔 내 글의 수. 시작 화면에서 "내 말투로 쓰기"를 고를 수 있는지 정한다 */
  let voicePosts = 0;
  /** 한 번에 돌릴 때 적어 둔 값. 다음에 다시 적지 않게 기억한다 */
  let autoForm: Record<string, string> = {};

  const status = h('p', { class: 'message' });
  const say = (text: string, tone: Tone = '') => setMessage(status, text, tone);
  const now = () => new Date().toISOString();

  async function commit(next: SeoRun): Promise<void> {
    current = next;
    await saveSeoRun(next);
    runs = await loadSeoRuns();
  }

  /** 제목 단계의 결과에서 고를 수 있는 제목들 */
  const titleCandidates = (run: SeoRun): string[] => (pack ? findTitles(pack, run) : []);

  function toFill(output: string): void {
    if (!current) return;
    let title = current.selected_title ?? titleCandidates(current)[0] ?? '';
    let body = output;
    const firstHeading = /^\s*#\s+(.+)\n/.exec(body);
    if (firstHeading) {
      if (!title) title = (firstHeading[1] ?? '').trim();
      body = body.slice(firstHeading[0].length);
    }
    deps.sendToFill(title, body.trim());
  }

  function chatNow(): ChatFn {
    return async (messages: ChatMessage[]) => {
      const ai = picker.current();
      if (!ai) throw new Error('AI 키가 없어요. 설정에서 키를 넣고 [확인]을 눌러 주세요.');
      const startedAt = Date.now();
      let chars = 0;
      let waiting = '';
      const draw = () =>
        say(`${phase ? phase + ' · ' : ''}${waiting || (chars > 0 ? `받은 글 ${num(chars)}자` : 'AI가 생각하는 중')} · ${seconds(Date.now() - startedAt)} · 받는 동안 이 창을 닫지 마세요`);
      const ticker = setInterval(draw, 1000);
      draw();
      try {
        const result = await llmChat(messages, {
          provider: ai.provider,
          model: ai.model,
          apiKey: ai.key,
          temperature: 0.7,
          maxTokens: resolveMaxTokens(WANTED_MAX_TOKENS, WEB_MAX_TOKENS, ai.modelInfo),
          signal: stopper?.signal,
          onProgress: (count) => {
            chars = count;
            waiting = '';
          },
          onRetry: (waitMs, why) => {
            waiting = `${why} · ${seconds(waitMs)} 뒤에 다시 시도`;
          },
        });
        await addUsage(ai.provider, result.usage);
        if (!result.text.trim()) {
          throw new Error(result.stopReason === 'blocked' ? 'AI가 이 요청에 답하지 않았어요.' : 'AI가 빈 답을 보냈어요. 다시 해 주세요.');
        }
        lastTruncated = result.stopReason === 'length';
        return result.text;
      } finally {
        clearInterval(ticker);
      }
    };
  }

  /** AI를 부르는 일을 한다. 하는 동안 버튼을 잠그고, 끝나면 다시 그린다. */
  async function work(job: (run: SeoRun, chat: ChatFn) => Promise<SeoRun>, done: string): Promise<void> {
    if (!current || stopper) return;
    const run = current;
    stopper = new AbortController();
    lastTruncated = false;
    render();
    try {
      await commit(await job(run, chatNow()));
      draft = '';
      say(lastTruncated ? 'AI의 답이 길이 한도에 걸려 중간에 잘렸어요. "이어서 써 줘"라고 보내 보세요.' : done, lastTruncated ? 'warn' : 'ok');
    } catch (err) {
      say(errorText(err), 'bad');
    } finally {
      stopper = null;
      render();
    }
  }

  /**
   * 남은 단계를 끝까지 돌린다. 멈춘 곳에서 다시 부르면 이어서 한다.
   * prepareVoice 가 참이면 먼저 내 글을 확인하고 말투를 정리한다 (처음 시작할 때만).
   */
  async function runAuto(prepareVoice: boolean): Promise<void> {
    if (!current || !pack || stopper) return;
    const activePack = pack;
    const steps = stepsOf(activePack, current);
    const numberOf = (id: number) => steps.findIndex((s) => s.id === id) + 1;
    stopper = new AbortController();
    const signal = stopper.signal;
    lastTruncated = false;
    phase = '';
    const notes: string[] = [];
    render();

    try {
      let run = current;
      if (prepareVoice && run.auto) {
        say('내 글을 확인하는 중이에요…');
        let voice = await loadVoice();
        if (voice.auto_check && voice.blog_id) {
          const checked = await checkNewPosts();
          if (checked.note) notes.push(checked.note);
          voice = await loadVoice();
        }
        if (needsAnalysis(voice)) {
          const ai = picker.current();
          if (!ai) throw new Error('AI 키가 없어요. 설정에서 키를 넣고 [확인]을 눌러 주세요.');
          const startedAt = Date.now();
          const ticker = setInterval(() => say(`내 글 ${voice.posts.length}편에서 말투를 정리하는 중 · ${seconds(Date.now() - startedAt)}`), 1000);
          try {
            voice = await analyzeVoice(activePack, ai, { signal });
          } finally {
            clearInterval(ticker);
          }
          notes.push('내 글에서 말투를 새로 정리했어요.');
        }
        run = { ...run, auto: { ...run.auto, voice_card: voice.card?.text ?? '', past_titles: titlesOf(voice) } };
        await commit(run);
      }

      const outcome = await runAll(activePack, run, {
        chat: chatNow(),
        now,
        shouldStop: () => signal.aborted,
        wasTruncated: () => lastTruncated,
        onChange: async (next, step, doing) => {
          await commit(next);
          const label = `${numberOf(step.id)}/${steps.length}단계 ${step.short_label}`;
          phase = doing === 'answering' ? `${label} · AI의 질문에 대신 답하는 중` : label;
          viewStepId = step.id;
          draft = '';
          render();
        },
      });
      await commit(outcome.run);
      if (outcome.step_id !== null) viewStepId = outcome.step_id;
      const where = outcome.step_id !== null ? `${numberOf(outcome.step_id)}단계` : '';
      const extra = notes.length > 0 ? ' ' + notes.join(' ') : '';
      if (outcome.stop === 'done') {
        say('모든 단계를 끝냈어요. 단계를 눌러 결과를 읽어 보고, 본문이 있는 단계에서 [채우기로 보내기]를 눌러 주세요.' + extra, 'ok');
      } else if (outcome.stop === 'stopped') {
        say(`${where}에서 멈췄어요. [이어서 끝까지 돌리기]를 누르면 멈춘 곳부터 이어서 해요.`, 'warn');
      } else if (outcome.stop === 'truncated') {
        say(`${where}에서 AI의 답이 길이 한도에 걸려 잘렸어요. "이어서 써 줘"라고 보내거나 [이 단계 다시 하기]를 한 뒤, 이어서 돌려 주세요.`, 'warn');
      } else if (outcome.stop === 'needs-title') {
        say(`${where}에 쓸 제목을 찾지 못했어요. 제목을 직접 적고 [이 제목으로 정하기]를 누른 뒤, 이어서 돌려 주세요.`, 'warn');
      } else {
        say(`${where}는 직접 답해 주세요. 답을 보낸 뒤 [이어서 끝까지 돌리기]를 누르면 돼요.`, 'warn');
      }
    } catch (err) {
      say(errorText(err) + ' 지금까지 한 단계는 남아 있어요. [이어서 끝까지 돌리기]로 이어서 할 수 있어요.', 'bad');
    } finally {
      stopper = null;
      phase = '';
      render();
    }
  }

  /**
   * 지금 모아 둔 내 말투와 이미 쓴 글 제목을, AI에게 보낼 글로 만든다. 한 단계씩 할 때 답에 붙이는 데 쓴다.
   * 말투 카드가 없으면 null.
   */
  async function myVoiceText(activePack: PromptPack): Promise<string | null> {
    const voice = await loadVoice();
    const card = voice.card?.text.trim() ?? '';
    if (!card) return null;
    const addition = voiceAddition(activePack, card, titlesOf(voice));
    return (addition.voice + addition.past_titles).trim();
  }

  /** AI를 부르지 않는 일 */
  async function change(job: (run: SeoRun) => SeoRun, done = ''): Promise<void> {
    if (!current) return;
    try {
      await commit(job(current));
      if (done) say(done, 'ok');
    } catch (err) {
      say(errorText(err), 'bad');
    }
    render();
  }

  // ───────── 시작 화면 ─────────

  function renderStart(activePack: PromptPack): void {
    const keyword = h('input', { type: 'text', class: 'field', placeholder: '예: 법인 전환 절차' });
    const platform = h('select', { class: 'field' },
      ...(Object.entries(activePack.seo.platform_labels) as [SeoPlatform, string][]).map(([value, label]) => option(value, label, value === 'naver_blog')),
    );
    const mode = h('select', { class: 'field' },
      option('step', MODE_LABELS.step, autoForm.mode !== 'auto'),
      option('auto', MODE_LABELS.auto, autoForm.mode === 'auto'),
      option('copy', MODE_LABELS.copy),
    );
    const optional = h('input', { type: 'checkbox' });
    optional.checked = true;
    const optionalSteps = activePack.seo.steps.filter((s) => s.optional).map((s) => s.short_label);
    const aiRow = h('label', { class: 'labeled' }, h('span', { class: 'label' }, '쓸 AI'), picker.element);

    // 한 번에 돌릴 때: AI가 중간에 묻는 것을 미리 받아 둔다.
    const suggest = (id: string, items: string[]) => h('datalist', { id }, ...items.map((item) => h('option', { value: item })));
    const purpose = h('input', { type: 'text', class: 'field', list: 'seo-purposes', placeholder: '예: 상담 문의를 받고 싶어요' });
    const tone = h('input', { type: 'text', class: 'field', list: 'seo-tones', placeholder: '예: 친절하게 설명하는 말투' });
    const cta = h('input', { type: 'text', class: 'field', list: 'seo-ctas', placeholder: '예: 상담 신청하기' });
    purpose.value = autoForm.purpose ?? '';
    tone.value = autoForm.tone ?? '';
    cta.value = autoForm.cta ?? '';
    const useVoice = h('input', { type: 'checkbox' });
    useVoice.checked = voicePosts > 0 && autoForm.useVoice !== 'no';
    useVoice.disabled = voicePosts === 0;
    const askingSteps = activePack.seo.steps.filter((s) => s.has_user_turn).length;
    const autoBox = h('div', { class: 'notice' },
      h('p', { class: 'hint small' }, 'AI가 중간에 묻는 것을 여기서 미리 답해 두면, 끝까지 멈추지 않고 진행해요.'),
      field('이 글의 목적', purpose),
      field('바라는 말투', tone),
      field('읽은 사람이 했으면 하는 행동', cta),
      suggest('seo-purposes', ['브랜드를 알리고 싶어요', '상담 문의를 받고 싶어요', '서비스 가입이나 구매로 이어지게 하고 싶어요', '내 다른 글도 읽게 하고 싶어요']),
      suggest('seo-tones', ['정보를 차분하게 전하는 말투', '친절하게 설명하는 말투', '실무 경험을 담은 말투', '내 말투 그대로']),
      suggest('seo-ctas', ['상담 신청하기', '서비스 안내 보기', '다른 글 읽기', '자료 받기']),
      h('label', { class: 'check' }, useVoice,
        h('span', null, voicePosts > 0 ? `내 말투로 쓰기 (모아 둔 내 글 ${voicePosts}편에서 배워요)` : '내 말투로 쓰기'),
      ),
      voicePosts === 0 ? h('p', { class: 'hint small' }, '[내 말투] 탭에서 내 글을 모아 두면 고를 수 있어요.') : null,
      h('p', { class: 'hint small' },
        `소제목 정리는 AI가 추천한 대로 하고, 다듬기는 AI가 짚은 대로 고쳐요. AI를 ${activePack.seo.steps.length + askingSteps}번쯤 불러요. 끝난 뒤에 마음에 안 드는 단계만 다시 할 수 있어요.`,
      ),
    );

    const showByMode = () => {
      aiRow.hidden = mode.value === 'copy';
      autoBox.hidden = mode.value !== 'auto';
    };
    mode.addEventListener('change', showByMode);
    showByMode();
    const startButton = h('button', { type: 'button', class: 'primary' }, '시작');

    startButton.addEventListener('click', () => {
      void (async () => {
        try {
          const startMode = mode.value as StartMode;
          const chosenMode: SeoMode = startMode === 'copy' ? 'copy' : 'api';
          if (chosenMode === 'api' && !picker.current()) {
            say('AI 키가 없어요. 설정에서 키를 넣거나, 진행 방식을 "복사해서 직접 진행"으로 바꿔 주세요.', 'warn');
            return;
          }
          let auto: AutoSettings | null = null;
          if (startMode === 'auto') {
            const missing = [
              purpose.value.trim() ? '' : '글의 목적',
              tone.value.trim() ? '' : '바라는 말투',
              cta.value.trim() ? '' : '읽은 사람이 했으면 하는 행동',
            ].filter(Boolean);
            if (missing.length > 0) {
              say(`${missing.join(', ')}을(를) 적어 주세요. AI가 중간에 묻는 것이라 미리 받아 둬요.`, 'warn');
              return;
            }
            auto = { purpose: purpose.value.trim(), tone: tone.value.trim(), cta: cta.value.trim(), voice_card: '', past_titles: [] };
          }
          autoForm = {
            mode: startMode,
            purpose: purpose.value.trim(),
            tone: tone.value.trim(),
            cta: cta.value.trim(),
            useVoice: useVoice.checked ? 'yes' : 'no',
          };
          void saveSeoAutoForm(autoForm);

          const run = createRun({
            id: `seo-${Date.now()}`,
            platform: platform.value as SeoPlatform,
            mode: chosenMode,
            main_keyword: keyword.value,
            llm_provider: picker.current()?.provider ?? null,
            include_optional: optional.checked,
            now: now(),
            auto,
          });
          viewStepId = stepsOf(activePack, run)[0]?.id ?? null;
          draft = '';
          await commit(run);
          say('');
          render();
          if (auto) void runAuto(useVoice.checked && !useVoice.disabled);
        } catch (err) {
          say(errorText(err), 'bad');
        }
      })();
    });

    root.append(
      h('section', { class: 'card' },
        h('h2', null, 'SEO 8단계 글쓰기'),
        h('p', { class: 'hint' }, '키워드 하나로 시작해서, 검색 의도 분석부터 제목까지 단계별로 글을 만들어요. 웹의 SEO 글쓰기와 같은 프롬프트예요.'),
        field('메인 키워드', keyword),
        field('어디에 올릴 글인가요', platform, '자체 도메인을 고르면 주소(URL) 단계가 하나 더 있어요.'),
        field('진행 방식', mode),
        autoBox,
        aiRow,
        optionalSteps.length > 0
          ? h('label', { class: 'check' }, optional, h('span', null, `덤 단계 넣기 (${optionalSteps.join(', ')})`))
          : null,
        h('div', { class: 'buttons' }, startButton),
        status,
      ),
    );

    if (runs.length > 0) {
      root.append(
        h('section', { class: 'card' },
          h('h2', null, '하던 글 이어 하기'),
          h('p', { class: 'hint small' }, '진행 상황은 이 컴퓨터에만 저장돼요.'),
          h('ul', { class: 'plain' },
            ...runs.map((run) => {
              const steps = stepsOf(activePack, run);
              const doneCount = steps.filter((s) => run.results[s.id]?.completed_at).length;
              const open = h('button', { type: 'button', class: 'link' }, run.main_keyword);
              open.addEventListener('click', () => {
                current = run;
                viewStepId = steps[Math.min(run.current_step_index, steps.length - 1)]?.id ?? null;
                draft = '';
                picker.select(run.llm_provider);
                say('');
                render();
              });
              const remove = h('button', { type: 'button', class: 'link muted' }, '지우기');
              remove.addEventListener('click', () => {
                void deleteSeoRun(run.id).then(reload);
              });
              return h('li', null,
                open,
                h('span', { class: 'hint small' },
                  ` · ${run.status === 'completed' ? '끝남' : `${doneCount}/${steps.length}단계`} · ${run.updated_at.slice(5, 10)} · ${describeMode(run)} · `,
                ),
                remove,
              );
            }),
          ),
        ),
      );
    }
  }

  // ───────── 진행 화면 ─────────

  function titlePicker(run: SeoRun, always: boolean): HTMLElement | null {
    const candidates = titleCandidates(run);
    if (!always && candidates.length === 0 && !run.selected_title) return null;
    const input = h('input', { type: 'text', class: 'field', placeholder: '제목을 직접 적어도 돼요' });
    input.value = run.selected_title ?? candidates[0] ?? '';
    const save = h('button', { type: 'button' }, '이 제목으로 정하기');
    save.addEventListener('click', () => void change((r) => selectTitle(r, input.value, now()), '제목을 정했어요.'));
    return h('div', { class: 'notice' },
      h('p', { class: 'label' }, run.selected_title ? `정한 제목: ${run.selected_title}` : '제목 고르기'),
      h('div', { class: 'choices' },
        ...candidates.map((t) => {
          const radio = h('input', { type: 'radio', name: 'seo-title' });
          radio.checked = t === input.value;
          radio.addEventListener('change', () => {
            input.value = t;
          });
          return h('label', { class: 'choice' }, radio, h('span', null, t));
        }),
      ),
      input,
      h('div', { class: 'buttons' }, save),
    );
  }

  function outputTools(output: string): HTMLElement {
    const copy = h('button', { type: 'button' }, '결과 복사');
    const fill = h('button', { type: 'button' }, '채우기로 보내기');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(output).then(
        () => say('결과를 복사했어요.', 'ok'),
        (err) => say(errorText(err), 'bad'),
      );
    });
    fill.addEventListener('click', () => toFill(output));
    return h('div', { class: 'buttons' }, copy, fill);
  }

  function renderStep(activePack: PromptPack, shownRun: SeoRun, step: PackSeoStep, steps: PackSeoStep[]): HTMLElement {
    // 제목이 필요한 단계인데 아직 고르지 않았으면, 웹처럼 첫 번째 제목을 기본으로 정해 둔다. 바꿀 수 있다.
    let run = shownRun;
    if (step.needs_selected_title && !run.selected_title) {
      const first = titleCandidates(run)[0];
      if (first) {
        run = selectTitle(run, first, now());
        current = run;
        void saveSeoRun(run);
      }
    }
    const result = resultOf(run, step.id);
    const busy = stopper !== null;
    const isLast = steps[steps.length - 1]?.id === step.id;
    const done = !!result.completed_at;
    const card = h('section', { class: 'card' },
      h('h2', null, `${steps.findIndex((s) => s.id === step.id) + 1}단계 · ${step.title}`),
    );

    // 제목이 필요한 단계, 또는 제목이 나온 단계에서는 제목을 고르게 한다.
    const hasTitles = extractTitles(result.final_output ?? '').length > 0;
    if (step.needs_selected_title || hasTitles) {
      const pickerBox = titlePicker(run, step.needs_selected_title);
      if (pickerBox) card.append(pickerBox);
    }

    if (run.mode === 'copy') {
      let prompt = '';
      try {
        prompt = initialMessageFor(activePack, run, step.id);
      } catch (err) {
        card.append(h('p', { class: 'message warn' }, errorText(err)));
      }
      if (prompt) {
        const promptArea = h('textarea', { class: 'field prose', rows: '6', readonly: 'readonly' });
        promptArea.value = prompt;
        const copyPrompt = h('button', { type: 'button', class: 'primary' }, '프롬프트 복사');
        copyPrompt.addEventListener('click', () => {
          void navigator.clipboard.writeText(prompt).then(
            () => say(`프롬프트를 복사했어요 (${num(prompt.length)}자). AI 화면에 붙여넣고, 받은 답을 아래에 붙여넣어 주세요.`, 'ok'),
            (err) => say(errorText(err), 'bad'),
          );
        });
        const pasteArea = h('textarea', { class: 'field prose tall', rows: '8', placeholder: 'AI에게 받은 답을 여기에 붙여넣어요' });
        pasteArea.value = draft || result.user_pasted_result || '';
        pasteArea.addEventListener('input', () => {
          draft = pasteArea.value;
        });
        const savePaste = h('button', { type: 'button' }, '결과 저장');
        savePaste.addEventListener('click', () => {
          const text = pasteArea.value;
          draft = '';
          void change((r) => pasteResult(activePack, r, step.id, text, now()), '결과를 저장했어요.');
        });
        if (step.has_user_turn) {
          card.append(h('p', { class: 'hint small' }, '이 단계는 AI가 되묻는 단계예요. AI 화면에서 끝까지 주고받은 뒤, 마지막 답을 붙여넣어 주세요.'));
        }
        const promptButtons = h('div', { class: 'buttons' }, copyPrompt);
        if (stepUsesVoice(activePack, step)) {
          const copyVoice = h('button', { type: 'button' }, '내 말투 복사');
          copyVoice.addEventListener('click', () => {
            void (async () => {
              try {
                const text = await myVoiceText(activePack);
                if (!text) {
                  say('정리해 둔 말투가 없어요. [내 말투] 탭에서 내 글을 모으고 [말투 정리하기]를 눌러 주세요.', 'warn');
                  return;
                }
                await navigator.clipboard.writeText(text);
                say('내 말투를 복사했어요. AI가 말투를 물으면 답에 같이 붙여넣어 주세요.', 'ok');
              } catch (err) {
                say(errorText(err), 'bad');
              }
            })();
          });
          promptButtons.append(copyVoice);
          card.append(h('p', { class: 'hint small' }, 'AI가 말투를 물으면 [내 말투 복사]로 복사한 글을 답에 같이 붙여넣어 주세요.'));
        }
        card.append(
          promptArea,
          promptButtons,
          pasteArea,
          h('div', { class: 'buttons' }, savePaste),
        );
      }
    } else if (result.conversation.length === 0) {
      const start = h('button', { type: 'button', class: 'primary' }, '이 단계 시작');
      start.disabled = busy;
      start.addEventListener('click', () => void work((r, chat) => startStep(activePack, r, step.id, chat, now()), 'AI의 답이 왔어요.'));
      if (step.has_user_turn) card.append(h('p', { class: 'hint small' }, '이 단계는 AI가 되물어요. 답을 보내면서 진행해요.'));
      card.append(h('div', { class: 'buttons' }, start));
    } else {
      const [first, ...rest] = result.conversation;
      card.append(
        h('details', null, h('summary', null, '보낸 프롬프트 보기'), h('pre', { class: 'output' }, first?.content ?? '')),
        ...rest.map((m) => h('div', { class: 'bubble ' + m.role }, h('span', { class: 'who' }, m.role === 'assistant' ? 'AI' : '나'), h('pre', { class: 'output' }, m.content))),
      );
      if (!done) {
        const reply = h('textarea', { class: 'field prose', rows: '3', placeholder: step.has_user_turn ? 'AI의 질문에 답을 적어요' : '고치고 싶은 점이 있으면 적어요 (없으면 다음 단계로)' });
        reply.value = draft;
        reply.addEventListener('input', () => {
          draft = reply.value;
        });
        const send = h('button', { type: 'button' }, '보내기');
        send.disabled = busy;
        send.addEventListener('click', () => {
          const text = reply.value;
          void work((r, chat) => sendMessage(activePack, r, step.id, text, chat, now()), 'AI의 답이 왔어요.');
        });
        const replyButtons = h('div', { class: 'buttons' }, send);
        // 말투를 묻는 단계에서는, 모아 둔 내 말투를 답에 붙일 수 있다.
        if (stepUsesVoice(activePack, step)) {
          const addVoice = h('button', { type: 'button' }, '내 말투 넣기');
          addVoice.disabled = busy;
          addVoice.addEventListener('click', () => {
            void (async () => {
              try {
                const text = await myVoiceText(activePack);
                if (!text) {
                  say('정리해 둔 말투가 없어요. [내 말투] 탭에서 내 글을 모으고 [말투 정리하기]를 눌러 주세요.', 'warn');
                  return;
                }
                if (reply.value.includes(text)) {
                  say('이미 넣었어요.');
                  return;
                }
                reply.value = (reply.value.trim() ? reply.value.trim() + '\n\n' : '') + text;
                draft = reply.value;
                say('내 말투를 답에 붙였어요. 목적과 유도할 행동도 같이 적은 뒤 [보내기]를 눌러 주세요.', 'ok');
              } catch (err) {
                say(errorText(err), 'bad');
              }
            })();
          });
          replyButtons.append(addVoice);
          card.append(h('p', { class: 'hint small' }, 'AI가 말투를 물으면 [내 말투 넣기]를 눌러, 내 글에서 배운 말투를 답에 붙일 수 있어요.'));
        }
        card.append(reply, replyButtons);
      }
    }

    const output =
      run.mode === 'api'
        ? ([...result.conversation].reverse().find((m) => m.role === 'assistant')?.content ?? result.final_output)
        : result.final_output;

    if (output) card.append(outputTools(output));

    const controls = h('div', { class: 'buttons' });
    if (!done) {
      const next = h('button', { type: 'button', class: 'primary' }, isLast ? '끝내기' : '이 단계 끝내고 다음으로');
      next.disabled = busy || !output;
      next.addEventListener('click', () => {
        void (async () => {
          await change((r) => advance(activePack, r, step.id, now()), isLast ? '모든 단계를 끝냈어요.' : '');
          if (current && !isLast) {
            viewStepId = stepsOf(activePack, current)[current.current_step_index]?.id ?? viewStepId;
            draft = '';
            render();
          }
        })();
      });
      controls.append(next);
    }
    if (result.conversation.length > 0 || result.final_output) {
      const redo = h('button', { type: 'button' }, '이 단계 다시 하기');
      redo.disabled = busy;
      redo.addEventListener('click', () => {
        draft = '';
        void change((r) => resetStep(r, step.id, now()), '이 단계를 비웠어요. 다시 시작해 주세요.');
      });
      controls.append(redo);
    }
    if (busy) {
      const stop = h('button', { type: 'button' }, '멈추기');
      stop.addEventListener('click', () => stopper?.abort());
      controls.append(stop);
    }
    card.append(controls, status);
    return card;
  }

  function renderRun(activePack: PromptPack, run: SeoRun): void {
    const steps = stepsOf(activePack, run);
    const shown = steps.find((s) => s.id === viewStepId) ?? steps[Math.min(run.current_step_index, steps.length - 1)];
    const back = h('button', { type: 'button', class: 'link' }, '← 목록으로');
    back.addEventListener('click', () => {
      if (stopper) return;
      current = null;
      say('');
      render();
    });

    // 한 번에 돌리다가 멈춘 글이면 이어서 돌릴 수 있게 한다.
    let resumeBox: HTMLElement | null = null;
    if (run.auto && run.status !== 'completed' && stopper === null) {
      const resume = h('button', { type: 'button', class: 'primary' }, '이어서 끝까지 돌리기');
      resume.addEventListener('click', () => void runAuto(false));
      resumeBox = h('div', { class: 'buttons' }, resume);
    }

    const chips = h('div', { class: 'chips' },
      ...steps.map((step, i) => {
        const result = run.results[step.id];
        const state = result?.completed_at ? 'done' : i === run.current_step_index && run.status !== 'completed' ? 'now' : '';
        const reachable = !!result || i <= run.current_step_index;
        const chip = h('button', { type: 'button', class: `chip ${state} ${shown?.id === step.id ? 'shown' : ''}` }, `${i + 1}. ${step.short_label}`);
        chip.disabled = !reachable || stopper !== null;
        chip.addEventListener('click', () => {
          viewStepId = step.id;
          draft = '';
          render();
        });
        return chip;
      }),
    );

    root.append(
      h('section', { class: 'card' },
        back,
        h('h2', null, `SEO 글쓰기 · ${run.main_keyword}`),
        h('p', { class: 'hint small' },
          `${activePack.seo.platform_labels[run.platform]} · ${describeMode(run)}` +
            (run.auto ? ` · 내 말투 ${run.auto.voice_card.trim() ? '씀' : '안 씀'}` : ''),
        ),
        run.mode === 'api' ? h('label', { class: 'labeled' }, h('span', { class: 'label' }, '쓸 AI'), picker.element) : null,
        chips,
        run.status === 'completed'
          ? h('p', { class: 'message ok' }, '모든 단계가 끝났어요. 본문이 있는 단계를 눌러 [채우기로 보내기]를 눌러 주세요.')
          : null,
        resumeBox,
        h('p', { class: 'hint small' }, 'AI가 적어 준 출처와 숫자는 실제와 다를 수 있어요. 올리기 전에 직접 확인해 주세요.'),
      ),
    );
    if (shown) root.append(renderStep(activePack, run, shown, steps));
  }

  function render(): void {
    root.replaceChildren();
    if (!pack) {
      const toSettings = h('button', { type: 'button', class: 'primary' }, '설정 열기');
      toSettings.addEventListener('click', deps.openSettings);
      root.append(
        h('section', { class: 'card' },
          h('h2', null, 'SEO 8단계 글쓰기'),
          h('p', { class: 'message warn' }, '프롬프트가 아직 없어요. 설정에서 로그인하면 받아 와요.'),
          h('div', { class: 'buttons' }, toSettings),
        ),
      );
      return;
    }
    if (current) renderRun(pack, current);
    else renderStart(pack);
  }

  async function reload(): Promise<void> {
    pack = await loadPack();
    runs = await loadSeoRuns();
    voicePosts = (await loadVoice()).posts.length;
    autoForm = await loadSeoAutoForm();
    if (!stopper) render();
  }

  window.addEventListener('beforeunload', (event) => {
    if (stopper) event.preventDefault();
  });
  onStoreChange(['pack', 'voice'], () => {
    // 글을 쓰는 중이거나 진행 화면을 보고 있으면 화면을 갈아엎지 않는다.
    if (stopper || current) void loadVoice().then((voice) => (voicePosts = voice.posts.length));
    else void reload();
  });
  void reload();

  return root;
}
