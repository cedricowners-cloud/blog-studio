import { describePack, validatePack } from '../../lib/prompts/pack';
import { serverConfigured, WEB_URL } from '../../lib/server/config';
import {
  changePassword,
  clearPackSource,
  loadLastEmail,
  loadPackSource,
  loadPendingLogin,
  loadSession,
  login,
  loginWithEmailCode,
  logout,
  markPackFromFile,
  sendLoginEmail,
  syncPack,
  takeLoginNote,
  type SyncResult,
  syncSharedKeys,
} from '../../lib/server/session';
import { hasOutdatedPack, loadPack, onStoreChange, savePack } from '../../lib/store';
import { errorText, guarded, h, setMessage, type Tone } from './dom';

// 로그인과 프롬프트 카드.
// blog_studio 웹과 같은 계정으로 로그인하면, 내 프롬프트를 서버에서 받아 온다.
// 로그인하는 방법은 두 가지다.
//   - 메일로: 로그인 메일을 받아 메일의 링크를 누른다. 웹에서 하던 것과 같다. 비밀번호가 필요 없다.
//     링크를 누르면 확장의 배경 코드(background.ts)가 그 탭에서 로그인 정보를 받아 간다.
//     그게 안 될 때는 링크의 주소나 메일의 6자리 코드를 직접 적을 수 있다.
//   - 비밀번호로: 비밀번호를 아는 사람만. 로그인한 뒤에 이 카드에서 비밀번호를 새로 정할 수 있다.
// 비밀번호는 요청에만 쓰고 저장하지 않는다. 서버를 쓸 수 없을 때는 묶음 파일로 불러올 수 있다.

const day = (iso: string | undefined): string => (iso ? iso.slice(0, 10) : '');

function explainSync(result: SyncResult): { text: string; tone: Tone } {
  switch (result.status) {
    case 'updated':
      return { text: '프롬프트를 새로 받았어요. 이제 글쓰기와 SEO 8단계를 쓸 수 있어요.', tone: 'ok' };
    case 'same':
      return { text: '이미 가장 새 프롬프트예요.', tone: 'ok' };
    case 'not-allowed':
      return { text: '이 계정은 프롬프트를 받을 수 있는 사람 목록에 없어요. 이 도구의 주인에게 넣어 달라고 해 주세요.', tone: 'warn' };
    case 'not-uploaded':
      return { text: '서버에 프롬프트가 아직 없어요. extension 폴더에서 npm run prompts:push 로 올려 주세요.', tone: 'warn' };
    case 'outdated':
      return {
        text: '서버의 프롬프트가 이 확장과 맞지 않아요. 프롬프트를 다시 올리거나(npm run prompts:push) 확장을 새로 빌드해 주세요. ' + result.detail,
        tone: 'warn',
      };
    default:
      return { text: '로그인이 풀렸어요. 다시 로그인해 주세요.', tone: 'warn' };
  }
}

export function createAccountCard(): HTMLElement {
  const configured = serverConfigured();

  const accountLine = h('p', { class: 'message' });
  const email = h('input', { type: 'email', class: 'field', placeholder: 'blog_studio 웹에서 쓰는 이메일', autocomplete: 'username' });
  // 메일로 로그인: 비밀번호가 없어도 된다
  const mailButton = h('button', { type: 'button', class: 'primary' }, '메일로 로그인 링크 받기');
  const waitingLine = h('p', { class: 'message' });
  // 링크를 눌러도 로그인되지 않을 때 쓰는 방법: 링크의 주소나 6자리 코드를 직접 적는다
  const codeInput = h('input', { type: 'text', class: 'field', placeholder: '메일의 링크 주소 (또는 6자리 코드)', autocomplete: 'off', spellcheck: 'false' });
  const codeButton = h('button', { type: 'button' }, '이것으로 로그인');
  const codeBox = h('details', { class: 'more' },
    h('summary', null, '링크를 눌러도 로그인되지 않을 때'),
    h('p', { class: 'hint small' }, '메일을 새로 받은 뒤, 링크를 누르지 말고 링크 위에서 오른쪽 버튼 → "링크 주소 복사"를 해서 아래에 붙여넣어 주세요. 메일에 6자리 코드가 있으면 그 코드를 적어도 돼요.'),
    codeInput,
    h('div', { class: 'buttons' }, codeButton),
  );
  // 비밀번호로 로그인: 비밀번호를 아는 사람만
  const password = h('input', { type: 'password', class: 'field', placeholder: '비밀번호', autocomplete: 'current-password' });
  const loginButton = h('button', { type: 'button' }, '비밀번호로 로그인');
  const loginForm = h('div', null,
    email,
    h('div', { class: 'buttons' }, mailButton),
    waitingLine,
    codeBox,
    h('details', { class: 'more' },
      h('summary', null, '비밀번호로 로그인하기'),
      password,
      h('div', { class: 'buttons' }, loginButton),
      h('p', { class: 'hint small' }, '비밀번호를 모르면 위의 메일로 로그인한 뒤, 이 카드에서 비밀번호를 새로 정할 수 있어요. 크롬이 웹의 비밀번호를 저장해 뒀다면 chrome://password-manager 에서 볼 수도 있어요.'),
    ),
  );
  const syncButton = h('button', { type: 'button', class: 'primary' }, '프롬프트 새로 받기');
  const logoutButton = h('button', { type: 'button' }, '로그아웃');
  const sessionButtons = h('div', { class: 'buttons' }, syncButton, logoutButton);

  // 로그인한 뒤: 비밀번호 새로 정하기
  const newPassword = h('input', { type: 'password', class: 'field', placeholder: '새 비밀번호 (8자 이상)', autocomplete: 'new-password' });
  const newPasswordAgain = h('input', { type: 'password', class: 'field', placeholder: '새 비밀번호 한 번 더', autocomplete: 'new-password' });
  const passwordButton = h('button', { type: 'button' }, '비밀번호 정하기');
  const passwordMessage = h('p', { class: 'message' });
  const passwordBox = h('details', { class: 'more' },
    h('summary', null, '비밀번호 정하기 · 바꾸기'),
    h('p', { class: 'hint small' }, '정해 두면 다음부터 비밀번호로도 로그인할 수 있어요. blog_studio 웹의 비밀번호 로그인에도 같은 비밀번호를 써요.'),
    newPassword,
    newPasswordAgain,
    h('div', { class: 'buttons' }, passwordButton),
    passwordMessage,
  );

  const packLine = h('p', { class: 'message' });
  const message = h('p', { class: 'message' });

  // 파일로 불러오기 (서버를 쓸 수 없을 때)
  const fileInput = h('input', { type: 'file', accept: '.json,application/json' });
  fileInput.hidden = true;
  const fileButton = h('button', { type: 'button' }, '묶음 파일 불러오기');
  const removeButton = h('button', { type: 'button' }, '프롬프트 지우기');
  const fileMessage = h('p', { class: 'message' });

  const say = (text: string, tone: Tone = '') => setMessage(message, text, tone);

  async function draw(): Promise<void> {
    const session = configured ? await loadSession() : null;
    if (!configured) setMessage(accountLine, '이 확장은 서버 주소 없이 만들어졌어요. 아래에서 묶음 파일로 불러와 주세요.', 'warn');
    else if (session) setMessage(accountLine, `로그인됨: ${session.user.email || '(이메일 없음)'}`, 'ok');
    else setMessage(accountLine, '로그인하지 않았어요.', 'warn');
    loginForm.hidden = !configured || !!session;
    sessionButtons.hidden = !session;
    passwordBox.hidden = !session;

    const pending = session ? null : await loadPendingLogin();
    if (pending) {
      const sentAt = pending.requested_at.slice(11, 16);
      setMessage(
        waitingLine,
        WEB_URL
          ? `메일의 링크를 기다리는 중이에요. 이 크롬에서 메일의 링크를 누르면 여기에 로그인돼요. (보낸 주소: ${pending.email})`
          : '메일을 보냈어요. 아래 "링크를 눌러도 로그인되지 않을 때"에 링크의 주소를 붙여넣어 주세요.',
        'warn',
      );
      waitingLine.title = `보낸 때 ${sentAt} (세계 표준시)`;
    } else {
      setMessage(waitingLine, '');
    }

    // 배경 코드가 링크로 로그인한 결과를 남겨 뒀으면 보여 준다.
    const note = await takeLoginNote();
    if (note) say(note.ok && session ? note.text + ' 프롬프트도 받아 올게요.' : note.text, note.ok ? 'ok' : 'bad');

    const pack = await loadPack();
    const source = await loadPackSource();
    if (pack) {
      const where =
        source?.from === 'server'
          ? `서버에서 받음 (서버에 올린 날 ${day(source.updated_at)})`
          : source?.from === 'file'
            ? `파일에서 불러옴 (${day(source.fetched_at)})`
            : '파일에서 불러옴';
      setMessage(packLine, `쓰는 프롬프트: ${describePack(pack)} · ${where}`, 'ok');
    } else if (await hasOutdatedPack()) {
      setMessage(packLine, '저장된 프롬프트가 예전 것이라 쓸 수 없어요. 로그인해서 새로 받거나, 새로 만든 묶음 파일을 불러와 주세요.', 'warn');
    } else {
      setMessage(packLine, session ? '프롬프트가 아직 없어요.' : '프롬프트가 아직 없어요. 로그인하면 받아 와요.', 'warn');
    }
    removeButton.hidden = !pack && !(await hasOutdatedPack());
  }

  async function runSync(quiet: boolean): Promise<void> {
    const result = await syncPack();
    // 가족이 함께 쓰는 네이버 키도 같이 받는다 (설정의 "네이버 API 키" 칸에 나타난다). 실패해도 프롬프트와는 상관없다.
    if (result.status !== 'signed-out') await syncSharedKeys().catch(() => undefined);
    // 창을 열 때 조용히 확인하는 경우에는, 바뀐 것이 없으면 아무 말도 하지 않는다.
    if (!(quiet && (result.status === 'same' || result.status === 'signed-out'))) {
      const { text, tone } = explainSync(result);
      say(text, tone);
    }
    await draw();
  }

  const submitLogin = () =>
    guarded(loginButton, (m) => say(m, 'bad'), async () => {
      say('로그인하는 중이에요…');
      try {
        await login(email.value, password.value);
      } catch (err) {
        say(errorText(err), 'bad');
        return;
      } finally {
        password.value = '';
      }
      await runSync(false);
    });

  loginButton.addEventListener('click', () => void submitLogin());
  password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submitLogin();
  });

  mailButton.addEventListener('click', () =>
    guarded(mailButton, (m) => say(m, 'bad'), async () => {
      say('메일을 보내는 중이에요…');
      try {
        await sendLoginEmail(email.value);
      } catch (err) {
        say(errorText(err), 'bad');
        return;
      }
      codeInput.value = '';
      say(
        WEB_URL
          ? '로그인 메일을 보냈어요. 이 크롬에서 메일을 열고 링크를 눌러 주세요. 누르면 여기에 자동으로 로그인돼요. 메일은 1분에 한 번만 보낼 수 있어요.'
          : '로그인 메일을 보냈어요. 메일은 1분에 한 번만 보낼 수 있어요.',
        'ok',
      );
      await draw();
    }),
  );

  const submitCode = () =>
    guarded(codeButton, (m) => say(m, 'bad'), async () => {
      say('로그인하는 중이에요…');
      try {
        await loginWithEmailCode(email.value, codeInput.value);
      } catch (err) {
        say(errorText(err), 'bad');
        return;
      }
      codeInput.value = '';
      codeBox.open = false;
      await runSync(false);
    });
  codeButton.addEventListener('click', () => void submitCode());
  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void submitCode();
  });

  passwordButton.addEventListener('click', () =>
    guarded(passwordButton, (m) => setMessage(passwordMessage, m, 'bad'), async () => {
      if (newPassword.value !== newPasswordAgain.value) {
        setMessage(passwordMessage, '두 칸에 적은 비밀번호가 서로 달라요.', 'warn');
        return;
      }
      try {
        await changePassword(newPassword.value);
      } catch (err) {
        setMessage(passwordMessage, errorText(err), 'bad');
        return;
      } finally {
        newPassword.value = '';
        newPasswordAgain.value = '';
      }
      setMessage(passwordMessage, '비밀번호를 정했어요. 다음부터 이 비밀번호로도 로그인할 수 있어요.', 'ok');
    }),
  );

  syncButton.addEventListener('click', () =>
    guarded(syncButton, (m) => say(m, 'bad'), async () => {
      say('서버에서 받는 중이에요…');
      await runSync(false);
    }),
  );

  logoutButton.addEventListener('click', () =>
    guarded(logoutButton, (m) => say(m, 'bad'), async () => {
      await logout();
      say('로그아웃했어요. 서버에서 받은 프롬프트도 이 컴퓨터에서 지웠어요.');
      await draw();
    }),
  );

  fileButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () =>
    guarded(fileButton, (m) => setMessage(fileMessage, m, 'bad'), async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setMessage(fileMessage, '이 파일을 읽지 못했어요. 프롬프트 묶음 파일(.json)이 맞는지 확인해 주세요.', 'bad');
        return;
      }
      const check = validatePack(parsed);
      if (!check.ok) {
        setMessage(fileMessage, '프롬프트 묶음이 아니에요: ' + check.errors.join(' / '), 'bad');
        return;
      }
      await savePack(check.pack);
      await markPackFromFile();
      setMessage(fileMessage, '파일에서 불러왔어요.', 'ok');
      await draw();
    }),
  );

  removeButton.addEventListener('click', () =>
    guarded(removeButton, (m) => setMessage(fileMessage, m, 'bad'), async () => {
      await savePack(null);
      await clearPackSource();
      setMessage(fileMessage, '이 컴퓨터에 있던 프롬프트를 지웠어요.');
      await draw();
    }),
  );

  onStoreChange(['pack', 'session', 'packSource', 'loginNote', 'pendingLogin'], () => void draw());
  void (async () => {
    email.value = await loadLastEmail();
    await draw();
    // 창을 열 때마다, 로그인돼 있으면 서버에 새 프롬프트가 있는지 조용히 확인한다.
    if (configured && (await loadSession())) {
      try {
        await runSync(true);
      } catch (err) {
        say('서버를 확인하지 못했어요. 가지고 있던 프롬프트를 그대로 써요. (' + errorText(err) + ')', 'warn');
      }
    }
  })();

  return h('section', { class: 'card' },
    h('h2', null, '로그인과 프롬프트'),
    h('p', { class: 'hint' },
      '내 프롬프트(글쓰기 방식 6개, SEO 8단계)는 확장 안에 들어 있지 않아요. 로그인하면 서버에서 받아 와요. 프롬프트를 고쳐서 서버에 올리면, 다음에 창을 열 때 새것을 받아요.',
    ),
    accountLine,
    loginForm,
    sessionButtons,
    packLine,
    message,
    passwordBox,
    h('details', { class: 'more' },
      h('summary', null, '서버를 쓸 수 없을 때: 파일로 불러오기'),
      h('p', { class: 'hint small' }, 'extension 폴더에서 npm run prompts 를 하면 prompt-pack/blog-studio-prompts.json 파일이 생겨요. 그 파일을 골라 주세요.'),
      h('div', { class: 'buttons' }, fileButton, removeButton, fileInput),
      fileMessage,
    ),
  );
}
