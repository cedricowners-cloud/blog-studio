import { hasAdKeys, hasSearchKeys, keywordTool, parseKeyLines, searchBlogs, type NaverKeys } from '../../lib/naver/api';
import { loadNaverKeySource, syncSharedKeys } from '../../lib/server/session';
import { clearNaverKeys, loadNaverKeys, onStoreChange, saveNaverKeys } from '../../lib/store';
import { errorText, field, guarded, h, setMessage } from './dom';

// 설정의 "네이버 API 키" 칸. 자료 찾기 탭이 이 키로 뉴스·블로그 글을 찾고 키워드의 검색 수를 본다.
//   - 키는 이 컴퓨터의 확장 저장소에 둔다. 여기서 넣은 키를 서버로 보내지 않는다.
//   - 가족이 함께 쓰는 키가 서버에 있으면 로그인할 때 받아 온다 (받을 수 있는 사람만). 직접 넣은 키가 있으면 그것을 쓴다.
//   - 키가 두 묶음이다: 검색 API (글 찾기), 검색광고 API (키워드 검색 수). 한쪽만 넣어도 그쪽 기능은 쓸 수 있다.
//   - .env 파일의 줄을 통째로 붙여넣으면 키를 골라낸다. 다섯 개를 하나씩 옮겨 적지 않아도 된다.

export function createNaverKeysCard(): HTMLElement {
  const secretInput = (placeholder: string) => h('input', { type: 'password', class: 'field', placeholder, autocomplete: 'off', spellcheck: 'false' });
  const textInput = (placeholder: string) => h('input', { type: 'text', class: 'field', placeholder, autocomplete: 'off', spellcheck: 'false' });

  const clientId = textInput('Client ID');
  const clientSecret = secretInput('Client Secret');
  const license = secretInput('액세스 라이선스');
  const secret = secretInput('비밀키');
  const customerId = textInput('고객 ID (숫자)');
  const badge = h('span', { class: 'badge' }, '');
  const message = h('p', { class: 'message' });
  const searchResult = h('p', { class: 'hint small' });
  const adResult = h('p', { class: 'hint small' });

  const pasteArea = h('textarea', {
    class: 'field prose',
    rows: '5',
    placeholder: 'NAVER_CLIENT_ID=…\nNAVER_CLIENT_SECRET=…\nNAVER_SEARCH_ACCESS_LICENSE_KEY=…\nNAVER_SEARCH_SECRET_KEY=…\nNAVER_SEARCH_CUSTOMER_ID=…',
    spellcheck: 'false',
  });
  const pasteButton = h('button', { type: 'button' }, '붙여넣은 글에서 키 찾기');
  const saveButton = h('button', { type: 'button', class: 'primary' }, '저장하고 확인');
  const removeButton = h('button', { type: 'button' }, '키 지우기');
  const sharedButton = h('button', { type: 'button' }, '서버의 공용 키 받기');
  const sourceLine = h('p', { class: 'hint small' });

  const read = (): NaverKeys => ({
    clientId: clientId.value.trim(),
    clientSecret: clientSecret.value.trim(),
    license: license.value.trim(),
    secret: secret.value.trim(),
    customerId: customerId.value.trim(),
  });

  function show(keys: NaverKeys): void {
    clientId.value = keys.clientId;
    clientSecret.value = keys.clientSecret;
    license.value = keys.license;
    secret.value = keys.secret;
    customerId.value = keys.customerId;
    drawBadge(keys);
    void drawSource(keys);
  }

  async function drawSource(keys: NaverKeys): Promise<void> {
    const source = await loadNaverKeySource();
    const any = hasSearchKeys(keys) || hasAdKeys(keys);
    sourceLine.textContent = !any
      ? '가족이 함께 쓰는 키가 서버에 있으면, 로그인할 때 자동으로 받아 와요.'
      : source?.from === 'server'
        ? '가족이 함께 쓰는 키를 서버에서 받아 쓰고 있어요. 따로 넣지 않아도 돼요.'
        : '이 컴퓨터에서 직접 넣은 키를 쓰고 있어요.';
  }

  function drawBadge(keys: NaverKeys): void {
    const parts = [hasSearchKeys(keys) ? '글 찾기' : '', hasAdKeys(keys) ? '키워드' : ''].filter(Boolean);
    badge.textContent = parts.length > 0 ? `${parts.join(' · ')} 키 있음` : '키 없음';
    badge.className = parts.length > 0 ? 'badge ok' : 'badge';
  }

  pasteButton.addEventListener('click', () => {
    const found = parseKeyLines(pasteArea.value);
    const count = Object.keys(found).length;
    if (count === 0) {
      setMessage(message, '붙여넣은 글에서 네이버 키를 찾지 못했어요. NAVER_CLIENT_ID=… 같은 줄이 있어야 해요.', 'warn');
      return;
    }
    show({ ...read(), ...found });
    // 붙여넣은 글에는 다른 키도 섞여 있을 수 있다. 화면에 남겨 두지 않는다.
    pasteArea.value = '';
    setMessage(message, `키 ${count}개를 찾아 칸에 넣었어요. [저장하고 확인]을 눌러 주세요.`, 'ok');
  });

  saveButton.addEventListener('click', () =>
    guarded(saveButton, (m) => setMessage(message, m, 'bad'), async () => {
      const keys = read();
      await saveNaverKeys(keys);
      drawBadge(keys);
      await drawSource(keys);
      searchResult.textContent = '';
      adResult.textContent = '';
      if (!hasSearchKeys(keys) && !hasAdKeys(keys)) {
        setMessage(message, '키를 넣지 않았어요. 검색 API 의 두 칸, 또는 검색광고 API 의 세 칸을 채워 주세요.', 'warn');
        return;
      }
      setMessage(message, '저장했어요. 네이버에 한 번씩 물어보는 중이에요…');
      // 키가 맞는지 실제로 한 번씩 불러 본다. 검색 한 번, 키워드 조회 한 번이다.
      let good = 0;
      let bad = 0;
      if (hasSearchKeys(keys)) {
        try {
          await searchBlogs(keys, '블로그', { display: 1 });
          searchResult.textContent = '검색 API: 잘 돼요.';
          good += 1;
        } catch (err) {
          searchResult.textContent = errorText(err);
          bad += 1;
        }
      } else {
        searchResult.textContent = '검색 API: 키가 없어서 블로그 글과 뉴스는 찾지 못해요.';
      }
      if (hasAdKeys(keys)) {
        try {
          await keywordTool(keys, ['블로그']);
          adResult.textContent = '검색광고 API: 잘 돼요.';
          good += 1;
        } catch (err) {
          adResult.textContent = errorText(err);
          bad += 1;
        }
      } else {
        adResult.textContent = '검색광고 API: 키가 없어서 키워드의 검색 수는 보지 못해요.';
      }
      setMessage(message, bad > 0 ? '저장은 했지만 네이버가 받아 주지 않은 키가 있어요. 아래를 확인해 주세요.' : '저장했고, 네이버에서도 잘 돼요.', bad > 0 ? 'warn' : good > 0 ? 'ok' : '');
    }),
  );

  removeButton.addEventListener('click', () =>
    guarded(removeButton, (m) => setMessage(message, m, 'bad'), async () => {
      const empty: NaverKeys = { clientId: '', clientSecret: '', license: '', secret: '', customerId: '' };
      await clearNaverKeys();
      show(empty);
      searchResult.textContent = '';
      adResult.textContent = '';
      setMessage(message, '네이버 키를 지웠어요.', 'ok');
    }),
  );

  sharedButton.addEventListener('click', () =>
    guarded(sharedButton, (m) => setMessage(message, m, 'bad'), async () => {
      const result = await syncSharedKeys(true);
      searchResult.textContent = '';
      adResult.textContent = '';
      show(await loadNaverKeys());
      if (result === 'signed-out') setMessage(message, '먼저 위의 "로그인과 프롬프트"에서 로그인해 주세요.', 'warn');
      else if (result === 'none') setMessage(message, '서버에 올려 둔 공용 키가 없거나, 받을 수 있는 계정이 아니에요.', 'warn');
      else setMessage(message, '가족이 함께 쓰는 키를 서버에서 받았어요.', 'ok');
    }),
  );

  // 로그인하면서 받아 온 키가 칸에 바로 보이게 한다.
  onStoreChange(['naverKeys', 'naverSource'], () => void loadNaverKeys().then(show));
  void loadNaverKeys().then(show);

  return h('section', { class: 'card' },
    h('h2', null, '네이버 API 키 ', badge),
    h('p', { class: 'hint' }, '"자료" 탭에서 뉴스와 블로그 글을 찾고, 키워드가 한 달에 몇 번 검색되는지 볼 때 써요.'),
    sourceLine,
    h('details', { class: 'more' },
      h('summary', null, '설정 파일의 줄을 한꺼번에 붙여넣기'),
      h('p', { class: 'hint small' }, 'blog_studio 의 web/.env.local 파일에서 NAVER 로 시작하는 줄을 복사해 붙여넣으면 키를 찾아서 칸에 넣어요. 붙여넣은 글은 바로 지워요.'),
      pasteArea,
      h('div', { class: 'buttons' }, pasteButton),
    ),
    h('p', { class: 'label' }, '검색 API (블로그 글, 뉴스 찾기)'),
    h('p', { class: 'hint small' }, 'developers.naver.com → 내 애플리케이션에서 "검색"을 쓰는 애플리케이션의 키예요.'),
    field('Client ID', clientId),
    field('Client Secret', clientSecret),
    h('p', { class: 'label' }, '검색광고 API (키워드의 검색 수, 연관 키워드)'),
    h('p', { class: 'hint small' }, 'searchad.naver.com → 도구 → API 사용 관리에서 받아요.'),
    field('액세스 라이선스', license),
    field('비밀키', secret),
    field('고객 ID', customerId),
    h('div', { class: 'buttons' }, saveButton, removeButton, sharedButton),
    message,
    searchResult,
    adResult,
  );
}
