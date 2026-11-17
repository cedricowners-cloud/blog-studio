import type { PromptPack } from '../../lib/prompts/pack';
import { loadPack, loadVoice, onStoreChange, saveVoice } from '../../lib/store';
import {
  addPosts,
  ANALYZE_POSTS,
  cardIsStale,
  hasPost,
  MAX_POSTS,
  MIN_BODY_CHARS,
  removePost,
  type VoiceState,
} from '../../lib/voice/library';
import type { ListedPost } from '../../lib/voice/naver';
import { explainReader, findBlogTabs, readList, type BlogTab } from '../../lib/voice/run';
import { createAiPicker } from './ai-picker';
import { errorText, guarded, h, num, seconds, setMessage, type Tone } from './dom';
import { analyzeVoice, importPosts } from './voice-actions';

// 내 말투 화면: 내가 쓴 글을 모으고, AI가 정리한 말투 카드를 보고 고친다.
// 글과 카드는 이 컴퓨터에만 둔다. 말투를 정리할 때만 내가 고른 AI로 글을 보낸다.

export interface VoiceDeps {
  openSettings: () => void;
}

const LIST_COUNT = 20;

export function createVoiceSection(deps: VoiceDeps): HTMLElement {
  let state: VoiceState | null = null;
  let pack: PromptPack | null = null;
  let stopper: AbortController | null = null;

  // ───────── 말투 카드 ─────────
  const summary = h('p', { class: 'message' });
  const cardArea = h('textarea', {
    class: 'field prose',
    rows: '9',
    placeholder: '아직 정리한 말투가 없어요. 아래에서 내 글을 모은 뒤 [말투 정리하기]를 눌러 주세요. 직접 적어도 돼요.',
  });
  const picker = createAiPicker(deps.openSettings);
  const analyzeButton = h('button', { type: 'button', class: 'primary' }, '말투 정리하기');
  const stopButton = h('button', { type: 'button' }, '멈추기');
  const cardMessage = h('p', { class: 'message' });
  stopButton.hidden = true;

  // ───────── 블로그에서 가져오기 ─────────
  const blogLine = h('p', { class: 'hint small' });
  const findButton = h('button', { type: 'button', class: 'primary' }, '내 블로그의 최근 글 찾기');
  const forgetButton = h('button', { type: 'button', class: 'link muted' }, '블로그 바꾸기');
  const autoCheck = h('input', { type: 'checkbox' });
  const importBox = h('div', null);
  const importMessage = h('p', { class: 'message' });

  // ───────── 모아 둔 글 ─────────
  const libraryBox = h('div', null);
  const pasteTitle = h('input', { type: 'text', class: 'field', placeholder: '글 제목' });
  const pasteBody = h('textarea', { class: 'field prose', rows: '6', placeholder: '내가 쓴 글의 본문을 붙여넣어요' });
  const pasteButton = h('button', { type: 'button' }, '이 글 넣기');
  const pasteMessage = h('p', { class: 'message' });

  const say = (el: HTMLElement, text: string, tone: Tone = '') => setMessage(el, text, tone);

  function draw(): void {
    if (!state) return;
    const current = state;
    const card = current.card;

    // 요약
    if (current.posts.length === 0) {
      say(summary, '모아 둔 글이 없어요. 아래에서 내 글을 넣어 주세요.', 'warn');
    } else if (!card || !card.text.trim()) {
      say(summary, `글 ${current.posts.length}편을 모아 뒀어요. 아직 말투를 정리하지 않았어요.`, 'warn');
    } else if (cardIsStale(current)) {
      say(
        summary,
        card.edited
          ? `글이 바뀌었어요. 직접 고친 말투라서 그대로 두고 있어요. 새로 정리하려면 [다시 정리하기]를 눌러 주세요.`
          : `글이 바뀌었어요. 다음에 한 번에 돌릴 때 말투를 새로 정리해요. 지금 하려면 [다시 정리하기]를 눌러 주세요.`,
        'warn',
      );
    } else {
      say(summary, `글 ${card.post_count}편에서 정리한 말투예요 (${card.analyzed_at.slice(0, 10)}${card.edited ? ', 직접 고침' : ''}).`, 'ok');
    }
    if (document.activeElement !== cardArea) cardArea.value = card?.text ?? '';
    analyzeButton.textContent = card?.text.trim() ? '다시 정리하기' : '말투 정리하기';
    analyzeButton.disabled = stopper !== null || current.posts.length === 0;

    // 블로그
    blogLine.textContent = current.blog_id
      ? `내 블로그: ${current.blog_id}` + (current.checked_at ? ` · 마지막으로 확인한 날 ${current.checked_at.slice(0, 10)}` : '')
      : '내 블로그를 아직 몰라요. 글쓰기 화면이나 내 블로그를 연 탭이 있으면 알아내요.';
    forgetButton.hidden = !current.blog_id;
    autoCheck.checked = current.auto_check;

    // 모아 둔 글
    libraryBox.replaceChildren();
    if (current.posts.length === 0) {
      libraryBox.append(h('p', { class: 'hint small' }, '아직 없어요.'));
      return;
    }
    libraryBox.append(
      h('p', { class: 'hint small' },
        `${current.posts.length}편 (최대 ${MAX_POSTS}편. 넘으면 오래전에 넣은 글부터 빠져요). 말투를 정리할 때는 최근에 넣은 ${ANALYZE_POSTS}편까지 봐요.`,
      ),
      h('ul', { class: 'plain' },
        ...current.posts.map((post) => {
          const remove = h('button', { type: 'button', class: 'link muted' }, '빼기');
          remove.addEventListener('click', () => {
            void (async () => {
              const fresh = await loadVoice();
              await saveVoice(removePost(fresh, post.id));
            })();
          });
          return h('li', null,
            h('span', null, post.title),
            h('span', { class: 'hint small' },
              ` · ${post.written_at || post.added_at.slice(0, 10)} · ${post.source === 'blog' ? '블로그' : '붙여넣음'} · ${num(post.body.length)}자 · `,
            ),
            remove,
          );
        }),
      ),
    );
  }

  async function reload(): Promise<void> {
    state = await loadVoice();
    pack = await loadPack();
    draw();
  }

  // 말투 카드를 직접 고치면 저장한다. 고친 카드는 자동으로 덮어쓰지 않는다.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  cardArea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void (async () => {
        const fresh = await loadVoice();
        const text = cardArea.value.trim();
        const base = fresh.card;
        await saveVoice({
          ...fresh,
          card: text
            ? {
                text,
                analyzed_at: base?.analyzed_at ?? new Date().toISOString(),
                signature: base?.signature ?? '',
                post_count: base?.post_count ?? 0,
                edited: true,
                model: base?.model ?? '',
              }
            : null,
        });
      })();
    }, 600);
  });

  analyzeButton.addEventListener('click', () => {
    void (async () => {
      if (stopper) return;
      if (!pack) {
        say(cardMessage, '프롬프트가 아직 없어요. 설정에서 로그인하면 받아 와요.', 'warn');
        return;
      }
      const ai = picker.current();
      if (!ai) {
        say(cardMessage, 'AI 키가 없어요. 설정에서 키를 넣고 [확인]을 눌러 주세요.', 'warn');
        return;
      }
      stopper = new AbortController();
      stopButton.hidden = false;
      analyzeButton.disabled = true;
      const startedAt = Date.now();
      let chars = 0;
      const tick = () => say(cardMessage, `내 글을 읽고 말투를 정리하는 중 · ${chars > 0 ? `받은 글 ${num(chars)}자 · ` : ''}${seconds(Date.now() - startedAt)}`);
      const ticker = setInterval(tick, 1000);
      tick();
      try {
        await analyzeVoice(pack, ai, { signal: stopper.signal, onProgress: (count) => (chars = count) });
        cardArea.blur();
        say(cardMessage, '말투를 정리했어요. 읽어 보고, 다르다 싶은 곳은 직접 고쳐 주세요.', 'ok');
      } catch (err) {
        say(cardMessage, errorText(err), 'bad');
      } finally {
        clearInterval(ticker);
        stopper = null;
        stopButton.hidden = true;
        await reload();
      }
    })();
  });
  stopButton.addEventListener('click', () => stopper?.abort());

  // ───────── 블로그에서 찾기 ─────────

  function showList(tab: BlogTab, blogId: string, posts: ListedPost[]): void {
    importBox.replaceChildren();
    if (!state) return;
    const current = state;
    if (posts.length === 0) {
      say(importMessage, '공개된 글을 찾지 못했어요.', 'warn');
      return;
    }
    const boxes = posts.map((post) => {
      const already = hasPost(current, { log_no: post.logNo });
      const short = current.ignored_log_nos.includes(post.logNo);
      const box = h('input', { type: 'checkbox' });
      box.checked = !already && !short;
      box.disabled = already;
      return { post, box, already, short };
    });
    const importButton = h('button', { type: 'button', class: 'primary' }, '고른 글 넣기');
    importButton.addEventListener('click', () =>
      guarded(importButton, (m) => say(importMessage, m, 'bad'), async () => {
        const chosen = boxes.filter((b) => b.box.checked && !b.already).map((b) => b.post);
        if (chosen.length === 0) {
          say(importMessage, '넣을 글을 골라 주세요.', 'warn');
          return;
        }
        const result = await importPosts(tab.tabId, blogId, chosen, (done, total) =>
          say(importMessage, `글을 읽는 중이에요 (${done}/${total}). 블로그 탭을 닫지 마세요.`),
        );
        importBox.replaceChildren();
        const parts = [`${result.added}편을 넣었어요.`];
        if (result.duplicate > 0) parts.push(`이미 있던 글 ${result.duplicate}편은 넣지 않았어요.`);
        if (result.tooShort > 0) parts.push(`${MIN_BODY_CHARS}자가 안 되는 글 ${result.tooShort}편은 넣지 않았어요.`);
        if (result.failed.length > 0) parts.push(`읽지 못한 글 ${result.failed.length}편: ${result.failed.slice(0, 3).join(', ')}`);
        say(importMessage, parts.join(' '), result.added > 0 ? 'ok' : 'warn');
        await reload();
      }),
    );
    importBox.append(
      h('p', { class: 'hint small' }, 'AI가 쓴 글은 빼고, 내가 직접 썼거나 충분히 고친 글만 골라 주세요. AI가 쓴 글을 넣으면 AI의 말투를 배워요.'),
      h('div', { class: 'choices' },
        ...boxes.map(({ post, box, already, short }) =>
          h('label', { class: 'choice' }, box,
            h('span', null, post.title || '(제목 없음)', h('span', { class: 'hint small' }, ` · ${post.date}${already ? ' · 이미 넣음' : short ? ' · 너무 짧은 글' : ''}`)),
          ),
        ),
      ),
      h('div', { class: 'buttons' }, importButton),
    );
    say(importMessage, `최근 글 ${posts.length}편을 찾았어요. 넣을 글을 고르고 [고른 글 넣기]를 눌러 주세요.`);
  }

  async function findPosts(confirmedId: string | null): Promise<void> {
    importBox.replaceChildren();
    const tabs = await findBlogTabs();
    const tab = tabs[0];
    if (!tab) {
      say(importMessage, '네이버 블로그를 연 탭이 없어요. 내 블로그나 글쓰기 화면을 열어 둔 뒤 다시 눌러 주세요.', 'warn');
      return;
    }
    const fresh = await loadVoice();
    // 글쓰기 화면의 아이디는 내 블로그가 틀림없다. 그 밖의 화면은 내 블로그가 맞는지 한 번 묻는다.
    const writeTab = tabs.find((t) => t.isWritePage && t.blogId);
    let blogId = confirmedId ?? writeTab?.blogId ?? fresh.blog_id;
    if (!blogId) {
      const candidate = tabs.find((t) => t.blogId)?.blogId;
      if (!candidate) {
        say(importMessage, '열려 있는 탭에서 블로그 아이디를 알아내지 못했어요. 내 블로그의 글 하나나 글쓰기 화면을 열어 주세요.', 'warn');
        return;
      }
      const yes = h('button', { type: 'button', class: 'primary' }, '맞아요');
      const no = h('button', { type: 'button' }, '아니에요');
      yes.addEventListener('click', () => guarded(yes, (m) => say(importMessage, m, 'bad'), () => findPosts(candidate)));
      no.addEventListener('click', () => {
        importBox.replaceChildren();
        say(importMessage, '내 블로그를 연 탭에서 다시 눌러 주세요. 다른 사람의 글로는 말투를 배우지 않아요.');
      });
      importBox.append(h('div', { class: 'buttons' }, yes, no));
      say(importMessage, `열려 있는 탭의 블로그는 "${candidate}"예요. 내 블로그가 맞나요?`, 'warn');
      return;
    }
    if (fresh.blog_id !== blogId) await saveVoice({ ...fresh, blog_id: blogId });

    say(importMessage, '글 목록을 읽는 중이에요…');
    const list = await readList(tab.tabId, blogId, LIST_COUNT);
    await reload();
    if (!list.ok) {
      say(importMessage, explainReader(list.reason), 'bad');
      return;
    }
    showList(tab, blogId, list.posts);
  }

  findButton.addEventListener('click', () => guarded(findButton, (m) => say(importMessage, m, 'bad'), () => findPosts(null)));

  forgetButton.addEventListener('click', () => {
    void (async () => {
      const fresh = await loadVoice();
      await saveVoice({ ...fresh, blog_id: null });
      importBox.replaceChildren();
      say(importMessage, '블로그를 지웠어요. 내 블로그를 연 탭에서 다시 찾아 주세요.');
    })();
  });

  autoCheck.addEventListener('change', () => {
    void (async () => {
      const fresh = await loadVoice();
      await saveVoice({ ...fresh, auto_check: autoCheck.checked });
    })();
  });

  pasteButton.addEventListener('click', () =>
    guarded(pasteButton, (m) => say(pasteMessage, m, 'bad'), async () => {
      const body = pasteBody.value.trim();
      if (body.length < MIN_BODY_CHARS) {
        say(pasteMessage, `본문이 너무 짧아요. ${MIN_BODY_CHARS}자 이상인 글을 넣어 주세요.`, 'warn');
        return;
      }
      const fresh = await loadVoice();
      const result = addPosts(fresh, [
        { id: `paste-${Date.now()}`, title: pasteTitle.value, body, source: 'paste', added_at: new Date().toISOString() },
      ]);
      if (result.added === 0) {
        say(pasteMessage, '이미 넣은 글이에요.', 'warn');
        return;
      }
      await saveVoice(result.state);
      pasteTitle.value = '';
      pasteBody.value = '';
      say(pasteMessage, '넣었어요.', 'ok');
    }),
  );

  onStoreChange(['voice', 'pack'], () => void reload());
  void reload();

  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('h2', null, '내 말투'),
      h('p', { class: 'hint' },
        '내가 쓴 글을 모아 두면 AI가 말투를 정리해 둬요. SEO 8단계를 한 번에 돌릴 때 이 말투로 써요. 글이 늘면 말투도 새로 정리해요.',
      ),
      summary,
      cardArea,
      h('label', { class: 'labeled' }, h('span', { class: 'label' }, '정리할 AI'), picker.element),
      h('div', { class: 'buttons' }, analyzeButton, stopButton),
      cardMessage,
      h('p', { class: 'hint small' }, '글과 말투는 이 컴퓨터에만 저장돼요. 말투를 정리할 때만 위에서 고른 AI로 글을 보내요.'),
    ),
    h('section', { class: 'card' },
      h('h2', null, '내 블로그에서 글 가져오기'),
      h('p', { class: 'hint' }, '네이버 블로그를 연 탭이 있어야 해요. 공개된 글만 읽어요. 읽기만 하고 아무것도 바꾸지 않아요.'),
      blogLine,
      h('div', { class: 'buttons' }, findButton, forgetButton),
      importBox,
      importMessage,
      h('label', { class: 'check' }, autoCheck, h('span', null, '한 번에 돌릴 때마다 내 블로그의 새 글을 찾아 넣기')),
      h('p', { class: 'hint small' }, '켜 두면 새로 올린 글을 계속 배워요. AI가 쓴 글을 거의 고치지 않고 올린다면 꺼 두는 편이 좋아요.'),
    ),
    h('section', { class: 'card' },
      h('h2', null, '모아 둔 글'),
      libraryBox,
      h('details', { class: 'more' },
        h('summary', null, '글을 직접 붙여넣기'),
        pasteTitle,
        pasteBody,
        h('div', { class: 'buttons' }, pasteButton),
        pasteMessage,
      ),
    ),
  );
}
