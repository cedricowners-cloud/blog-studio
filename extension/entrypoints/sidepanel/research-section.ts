import {
  hasAdKeys,
  hasSearchKeys,
  keywordTool,
  searchBlogs,
  searchNews,
  type BlogHit,
  type KeywordRow,
  type NaverKeys,
  type NewsHit,
  type SearchSort,
} from '../../lib/naver/api';
import { filterKeywords, sortKeywords, type KeywordSort } from '../../lib/naver/keywords';
import {
  EMPTY_BASKET,
  loadBasket,
  loadNaverKeys,
  MAX_BASKET_BLOGS,
  MAX_BASKET_NEWS,
  MAX_BASKET_SUBS,
  onStoreChange,
  saveBasket,
  type ResearchBasket,
} from '../../lib/store';
import { errorText, field, h, num, setMessage, type Tone } from './dom';

// 자료 탭: 글을 쓰기 전에 네이버에서 글감을 찾는다.
//   - 키워드: 한 달에 몇 번 검색되는지, 함께 찾는 연관 키워드 (검색광고 API). 받은 것을 모두 보여 주고 정렬하고 걸러 본다
//   - 블로그 글: 그 키워드로 네이버 윗자리에 나오는 글 (검색 API). 무엇을 다루는지 보고, 다르게 쓰려고 본다
//   - 뉴스: 관련 기사 (검색 API). 최근 흐름을 본다
// 블로그 글과 뉴스는 한 번에 50개를 받아 두고, 10·30·50개 중에 골라서 본다 (다시 묻지 않는다).
// 고른 키워드와 글을 [글쓰기에 넣기]로 글쓰기 탭에 넘긴다.
// 지키는 것: 제목과 요약만 받는다. 글의 본문을 긁어 오지 않는다. 찾은 글은 참고만 하고 베끼지 않게 한다.

export interface ResearchDeps {
  openSettings: () => void;
  openWrite: () => void;
}

/** 블로그 글과 뉴스를 한 번에 받아 두는 수. 네이버는 한 번에 100개까지 준다 */
const FETCH_COUNT = 50;
const SHOW_CHOICES = [10, 30, 50] as const;
type ShowCount = (typeof SHOW_CHOICES)[number];

const LAST_QUERY = 'blogStudioResearchQuery';
const LAST_VIEW = 'blogStudioResearchView';
const LAST_SHOW = 'blogStudioResearchShow';
const LAST_NEWS_SORT = 'blogStudioResearchNewsSort';

/** 찾은 것을 나눠 보는 작은 탭 */
type View = 'keywords' | 'blogs' | 'news';
const VIEW_LABELS: Record<View, string> = { keywords: '키워드', blogs: '블로그 글', news: '뉴스' };

interface Found {
  query: string;
  keywords: KeywordRow[] | null;
  blogs: { total: number; items: BlogHit[] } | null;
  news: { total: number; items: NewsHit[] } | null;
  problems: string[];
}

/** "4,230번" 또는 "10번 미만". 네이버는 적게 찾는 말의 수를 "10 미만"으로만 알려 준다 */
const times = (value: number | null): string => (value === null ? '10번 미만' : `${num(value)}번`);
const volume = (row: KeywordRow): string => (row.pc === null && row.mobile === null ? times(null) : times(row.total));
/** replaceChildren 은 빈 값(null)을 받지 않는다. 빈 값을 걸러 준다 */
const present = (...nodes: (HTMLElement | null)[]): HTMLElement[] => nodes.filter((node): node is HTMLElement => node !== null);
const sameKeyword = (a: string, b: string): boolean => a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();

const remembered = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 기억하지 못해도 쓰는 데는 문제없다
  }
};

export function createResearchSection(deps: ResearchDeps): HTMLElement {
  let keys: NaverKeys | null = null;
  let basket: ResearchBasket = { ...EMPTY_BASKET };
  let found: Found | null = null;
  let stopper: AbortController | null = null;

  // 보는 방법. 다시 찾아도, 패널을 다시 열어도 그대로 둔다.
  let view: View = (['keywords', 'blogs', 'news'] as View[]).find((kind) => kind === remembered(LAST_VIEW)) ?? 'keywords';
  let showCount: ShowCount = SHOW_CHOICES.find((n) => String(n) === remembered(LAST_SHOW)) ?? 10;
  let newsSort: SearchSort = remembered(LAST_NEWS_SORT) === 'date' ? 'date' : 'sim';
  let keywordSort: KeywordSort = 'related';
  let keywordFilter = '';

  const needKeys = h('div', { class: 'notice' });
  const goSettings = h('button', { type: 'button' }, '설정 열기');
  goSettings.addEventListener('click', deps.openSettings);

  const queryInput = h('input', { type: 'text', class: 'field', placeholder: '예: 도킹스테이션 추천' });
  const findButton = h('button', { type: 'button', class: 'primary' }, '찾기');
  const message = h('p', { class: 'message' });
  const results = h('div', { class: 'stack' });
  const basketBox = h('section', { class: 'card' });

  const say = (text: string, tone: Tone = '') => setMessage(message, text, tone);

  async function keepBasket(next: ResearchBasket): Promise<void> {
    basket = next;
    drawBasket();
    await saveBasket(next);
  }

  /** 여러 개 중 하나를 고르는 작은 버튼 줄 */
  function choices<T extends string | number>(label: string, items: { value: T; text: string }[], current: T, onPick: (value: T) => void): HTMLElement {
    return h('div', { class: 'choice-row' },
      h('span', { class: 'hint small' }, label),
      ...items.map((item) => {
        const on = item.value === current;
        const button = h('button', { type: 'button', class: on ? 'small on' : 'small', 'aria-pressed': String(on) }, item.text);
        button.addEventListener('click', () => onPick(item.value));
        return button;
      }),
    );
  }

  // ───────── 고른 것 ─────────

  function chip(label: string, onRemove: () => void): HTMLElement {
    const remove = h('button', { type: 'button', class: 'chip-remove', 'aria-label': `${label} 빼기` }, '×');
    remove.addEventListener('click', onRemove);
    return h('span', { class: 'chip' }, label, remove);
  }

  function drawBasket(): void {
    const empty = !basket.main && basket.subs.length === 0 && basket.blogs.length === 0 && basket.news.length === 0;
    basketBox.hidden = empty;
    if (empty) return;
    const sendButton = h('button', { type: 'button', class: 'primary' }, '글쓰기에 넣기');
    sendButton.addEventListener('click', () => {
      void keepBasket({ ...basket, sent_at: new Date().toISOString() }).then(deps.openWrite);
    });
    const clearButton = h('button', { type: 'button' }, '모두 빼기');
    clearButton.addEventListener('click', () => {
      void keepBasket({ ...EMPTY_BASKET }).then(drawResults);
    });
    const keywordChips = [
      basket.main ? chip(`메인: ${basket.main}`, () => void keepBasket({ ...basket, main: '' }).then(drawResults)) : null,
      ...basket.subs.map((sub) => chip(sub, () => void keepBasket({ ...basket, subs: basket.subs.filter((s) => s !== sub) }).then(drawResults))),
    ];
    basketBox.replaceChildren(...present(
      h('h2', null, '고른 것'),
      keywordChips.some(Boolean) ? h('div', { class: 'chips' }, ...keywordChips) : null,
      h('p', { class: 'hint small' }, `참고할 블로그 글 ${basket.blogs.length}개 (${MAX_BASKET_BLOGS}개까지) · 뉴스 ${basket.news.length}건 (${MAX_BASKET_NEWS}건까지)`),
      h('p', { class: 'hint small' }, '글쓰기 탭으로 가져가면 키워드는 칸에 채워지고, 고른 글과 뉴스는 글을 만들 때 참고 자료로 함께 보내요. AI에게는 베끼지 말고 다르게 쓰라고 해요.'),
      h('div', { class: 'buttons' }, sendButton, clearButton),
    ));
  }

  // ───────── 키워드: 받은 것을 모두 보여 준다 ─────────

  function keywordRow(row: KeywordRow): HTMLElement {
    const isMain = sameKeyword(basket.main, row.keyword);
    const isSub = basket.subs.some((sub) => sameKeyword(sub, row.keyword));
    const mainButton = h('button', { type: 'button', class: isMain ? 'small on' : 'small' }, isMain ? '메인 ✓' : '메인');
    mainButton.addEventListener('click', () => {
      void keepBasket({ ...basket, main: isMain ? '' : row.keyword, subs: basket.subs.filter((sub) => !sameKeyword(sub, row.keyword)) }).then(drawResults);
    });
    const subButton = h('button', { type: 'button', class: isSub ? 'small on' : 'small' }, isSub ? '서브 ✓' : '서브');
    subButton.addEventListener('click', () => {
      if (!isSub && basket.subs.length >= MAX_BASKET_SUBS) {
        say(`서브 키워드는 ${MAX_BASKET_SUBS}개까지 고를 수 있어요.`, 'warn');
        return;
      }
      const subs = isSub ? basket.subs.filter((sub) => !sameKeyword(sub, row.keyword)) : [...basket.subs, row.keyword];
      void keepBasket({ ...basket, main: isMain && !isSub ? '' : basket.main, subs }).then(drawResults);
    });
    const detail = row.pc === null && row.mobile === null ? '' : ` (PC ${times(row.pc)} · 모바일 ${times(row.mobile)})`;
    return h('div', { class: 'keyword-row' },
      h('div', { class: 'keyword-name' },
        h('strong', null, row.keyword),
        h('span', { class: 'hint small' }, ` 한 달 ${volume(row)}${detail}${row.competition ? ` · 경쟁 ${row.competition}` : ''}`),
      ),
      h('div', { class: 'keyword-buttons' }, mainButton, subButton),
    );
  }

  function keywordSection(rows: KeywordRow[], blogTotal: number | null): HTMLElement {
    const seed = rows.find((row) => found && sameKeyword(row.keyword, found.query)) ?? null;
    const summary = seed
      ? `"${seed.keyword}" — 한 달에 ${volume(seed)} 검색돼요 (PC ${times(seed.pc)} · 모바일 ${times(seed.mobile)}).` +
        (blogTotal !== null ? ` 이 말로 쓴 블로그 글은 ${num(blogTotal)}개예요.` : '') +
        (seed.competition ? ` 광고 경쟁: ${seed.competition}.` : '')
      : '찾은 말 그대로의 검색 수는 네이버가 알려 주지 않았어요. 아래 연관 키워드를 봐 주세요.';

    const list = h('div', null);
    const countLine = h('p', { class: 'hint small' });
    // 글자를 칠 때마다 목록만 다시 그린다. 칸까지 다시 그리면 글자를 치다가 끊긴다.
    const drawRows = () => {
      const shown = sortKeywords(filterKeywords(rows, keywordFilter), keywordSort);
      countLine.textContent = shown.length === rows.length ? `키워드 ${num(rows.length)}개를 모두 보여 줘요.` : `키워드 ${num(rows.length)}개 중 ${num(shown.length)}개가 맞아요.`;
      list.replaceChildren(...(shown.length > 0 ? shown.map(keywordRow) : [h('p', { class: 'message' }, '맞는 키워드가 없어요.')]));
    };

    const filterInput = h('input', { type: 'text', class: 'field', placeholder: '키워드 안에서 찾기 (예: 추천)' });
    filterInput.value = keywordFilter;
    filterInput.addEventListener('input', () => {
      keywordFilter = filterInput.value;
      drawRows();
    });

    // 정렬: 같은 버튼을 한 번 더 누르면 거꾸로 정렬한다.
    const sortButton = (label: string, first: KeywordSort, second: KeywordSort | null, marks: [string, string]): HTMLElement => {
      const on = keywordSort === first || keywordSort === second;
      const text = !on || second === null ? label : `${label} ${keywordSort === first ? marks[0] : marks[1]}`;
      const button = h('button', { type: 'button', class: on ? 'small on' : 'small', 'aria-pressed': String(on) }, text);
      button.addEventListener('click', () => {
        keywordSort = keywordSort === first && second !== null ? second : first;
        drawResults();
      });
      return button;
    };

    drawRows();
    return h('section', { class: 'card' },
      h('h2', null, '키워드'),
      h('p', { class: 'hint' }, summary),
      h('p', { class: 'hint small' }, '검색 수는 네이버 검색광고가 알려 주는 지난 한 달의 값이에요. "경쟁"은 광고를 내려는 곳이 많은지이고, 블로그 경쟁과는 달라요.'),
      h('div', { class: 'choice-row' },
        h('span', { class: 'hint small' }, '정렬'),
        sortButton('관련 깊은 순', 'related', null, ['', '']),
        sortButton('검색량', 'volume-desc', 'volume-asc', ['많은 순 ▼', '적은 순 ▲']),
        sortButton('경쟁', 'comp-asc', 'comp-desc', ['낮은 순 ▲', '높은 순 ▼']),
      ),
      filterInput,
      countLine,
      list,
    );
  }

  // ───────── 블로그 글, 뉴스 ─────────

  function hitRow(title: string, link: string, meta: string, description: string, checked: boolean, onToggle: (on: boolean) => boolean): HTMLElement {
    const check = h('input', { type: 'checkbox' });
    check.checked = checked;
    check.addEventListener('change', () => {
      // 더 고를 수 없으면 체크를 되돌린다.
      if (!onToggle(check.checked)) check.checked = !check.checked;
    });
    const heading = link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, title) : h('span', null, title);
    return h('div', { class: 'hit-row' },
      h('label', { class: 'check' }, check, h('span', null, heading)),
      h('p', { class: 'hint small' }, meta),
      description ? h('p', { class: 'hit-text' }, description) : null,
    );
  }

  /** 몇 개를 볼지 고르는 줄. 받아 둔 것 안에서 바꾸므로 네이버에 다시 묻지 않는다 */
  const showChoices = (): HTMLElement =>
    choices('한 번에 보기', SHOW_CHOICES.map((n) => ({ value: n, text: `${n}개` })), showCount, (n) => {
      showCount = n;
      remember(LAST_SHOW, String(n));
      drawResults();
    });

  function blogSection(data: { total: number; items: BlogHit[] }): HTMLElement {
    const items = data.items.slice(0, showCount);
    return h('section', { class: 'card' },
      h('h2', null, '블로그 글'),
      h('p', { class: 'hint' }, `네이버에서 이 말로 윗자리에 나오는 글이에요. 무엇을 다루는지 보고, 내 글은 다르게 써요.`),
      showChoices(),
      h('p', { class: 'hint small' }, `전체 ${num(data.total)}개 중 위에서 ${items.length}개를 보여 줘요.`),
      data.items.length === 0 ? h('p', { class: 'message' }, '찾은 글이 없어요.') : null,
      ...items.map((hit, index) =>
        hitRow(`${index + 1}. ${hit.title}`, hit.link, [hit.blogger, hit.date].filter(Boolean).join(' · '), hit.description, basket.blogs.some((b) => b.link === hit.link), (on) => {
          if (on && basket.blogs.length >= MAX_BASKET_BLOGS) {
            say(`참고할 블로그 글은 ${MAX_BASKET_BLOGS}개까지 고를 수 있어요.`, 'warn');
            return false;
          }
          void keepBasket({ ...basket, blogs: on ? [...basket.blogs, hit] : basket.blogs.filter((b) => b.link !== hit.link) });
          return true;
        }),
      ),
    );
  }

  function newsSection(data: { total: number; items: NewsHit[] }): HTMLElement {
    const items = data.items.slice(0, showCount);
    return h('section', { class: 'card' },
      h('h2', null, '뉴스'),
      h('p', { class: 'hint' }, '관련 기사예요. 제목과 요약만 가져와요. 글에 쓸 사실은 원문에서 확인해 주세요.'),
      choices<SearchSort>('순서', [{ value: 'sim', text: '관련 있는 순' }, { value: 'date', text: '최신 순' }], newsSort, (sort) => {
        if (sort === newsSort) return;
        newsSort = sort;
        remember(LAST_NEWS_SORT, sort);
        void refetchNews();
      }),
      showChoices(),
      h('p', { class: 'hint small' }, `전체 ${num(data.total)}건 중 ${items.length}건을 보여 줘요.`),
      data.items.length === 0 ? h('p', { class: 'message' }, '찾은 기사가 없어요.') : null,
      ...items.map((hit, index) =>
        hitRow(`${index + 1}. ${hit.title}`, hit.link, [hit.source, hit.date].filter(Boolean).join(' · '), hit.description, basket.news.some((n) => n.link === hit.link), (on) => {
          if (on && basket.news.length >= MAX_BASKET_NEWS) {
            say(`참고할 뉴스는 ${MAX_BASKET_NEWS}건까지 고를 수 있어요.`, 'warn');
            return false;
          }
          void keepBasket({ ...basket, news: on ? [...basket.news, hit] : basket.news.filter((n) => n.link !== hit.link) });
          return true;
        }),
      ),
    );
  }

  function drawResults(): void {
    if (!found) {
      results.replaceChildren();
      return;
    }
    // 찾은 것을 작은 탭으로 나눠 하나씩 보여 준다. 찾지 못한 것은 탭을 만들지 않는다.
    const counts: Record<View, number | null> = {
      keywords: found.keywords ? found.keywords.length : null,
      blogs: found.blogs ? found.blogs.items.length : null,
      news: found.news ? found.news.items.length : null,
    };
    const available = (Object.keys(counts) as View[]).filter((kind) => counts[kind] !== null);
    const shown: View | null = available.includes(view) ? view : (available[0] ?? null);
    const picked: Record<View, number> = { keywords: (basket.main ? 1 : 0) + basket.subs.length, blogs: basket.blogs.length, news: basket.news.length };

    const tabs = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': '찾은 것 나눠 보기' },
      ...available.map((kind) => {
        const active = kind === shown;
        const button = h('button', { type: 'button', class: active ? 'subtab active' : 'subtab', role: 'tab', 'aria-selected': String(active) },
          `${VIEW_LABELS[kind]} ${num(counts[kind] ?? 0)}`,
          picked[kind] > 0 ? h('span', { class: 'subtab-picked' }, ` · 고름 ${picked[kind]}`) : null,
        );
        button.addEventListener('click', () => {
          if (view === kind) return;
          view = kind;
          remember(LAST_VIEW, kind);
          drawResults();
          // 긴 목록을 내려 보다가 탭을 바꾸면, 새 목록의 맨 위부터 보이게 한다.
          results.scrollIntoView({ block: 'start' });
        });
        return button;
      }),
    );

    const section =
      shown === 'keywords' && found.keywords ? keywordSection(found.keywords, found.blogs?.total ?? null)
      : shown === 'blogs' && found.blogs ? blogSection(found.blogs)
      : shown === 'news' && found.news ? newsSection(found.news)
      : null;

    results.replaceChildren(...present(
      ...found.problems.map((problem) => h('p', { class: 'message warn' }, problem)),
      available.length > 1 ? tabs : null,
      section,
    ));
  }

  // ───────── 찾기 ─────────

  async function find(): Promise<void> {
    const query = queryInput.value.trim();
    if (!keys || (!hasSearchKeys(keys) && !hasAdKeys(keys))) return;
    if (!query) {
      say('찾을 말을 적어 주세요.', 'warn');
      return;
    }
    stopper?.abort();
    const mine = new AbortController();
    stopper = mine;
    findButton.disabled = true;
    say('네이버에서 찾는 중이에요…');
    remember(LAST_QUERY, query);

    const active = keys;
    const problems: string[] = [];
    const attempt = async <T,>(work: () => Promise<T>): Promise<T | null> => {
      try {
        return await work();
      } catch (err) {
        if (!mine.signal.aborted) problems.push(errorText(err));
        return null;
      }
    };
    // 세 가지를 한꺼번에 묻는다. 하나가 안 돼도 나머지는 보여 준다.
    const [keywords, blogs, news] = await Promise.all([
      hasAdKeys(active) ? attempt(() => keywordTool(active, [query], { signal: mine.signal })) : Promise.resolve(null),
      hasSearchKeys(active) ? attempt(() => searchBlogs(active, query, { display: FETCH_COUNT, sort: 'sim', signal: mine.signal })) : Promise.resolve(null),
      hasSearchKeys(active) ? attempt(() => searchNews(active, query, { display: FETCH_COUNT, sort: newsSort, signal: mine.signal })) : Promise.resolve(null),
    ]);
    if (mine.signal.aborted) return;

    if (!hasAdKeys(active)) problems.push('검색광고 API 키가 없어서 키워드의 검색 수는 보지 못했어요. 설정에서 넣을 수 있어요.');
    if (!hasSearchKeys(active)) problems.push('검색 API 키가 없어서 블로그 글과 뉴스는 찾지 못했어요. 설정에서 넣을 수 있어요.');
    found = { query, keywords, blogs, news, problems };
    // 새로 찾았으면 키워드 목록은 처음 모양으로 돌린다. 몇 개씩 볼지와 뉴스의 순서는 그대로 둔다.
    keywordSort = 'related';
    keywordFilter = '';
    drawResults();
    const anything = keywords !== null || blogs !== null || news !== null;
    say(anything ? `"${query}" 찾기를 마쳤어요. 쓸 키워드와 참고할 글을 골라 주세요.` : '찾지 못했어요. 아래 안내를 확인해 주세요.', anything ? 'ok' : 'bad');
    findButton.disabled = false;
    stopper = null;
  }

  /** 뉴스의 순서를 바꾸면 뉴스만 다시 받아 온다 */
  async function refetchNews(): Promise<void> {
    if (!found || !keys || !hasSearchKeys(keys)) return;
    const query = found.query;
    say('뉴스를 다시 찾는 중이에요…');
    try {
      const news = await searchNews(keys, query, { display: FETCH_COUNT, sort: newsSort });
      // 그 사이에 다른 말로 새로 찾았으면 버린다.
      if (found?.query !== query) return;
      found = { ...found, news };
      drawResults();
      say(newsSort === 'date' ? '뉴스를 최신 순서로 다시 찾았어요.' : '뉴스를 관련 있는 순서로 다시 찾았어요.', 'ok');
    } catch (err) {
      say(errorText(err), 'bad');
    }
  }

  findButton.addEventListener('click', () => void find());
  queryInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) void find();
  });

  async function refresh(): Promise<void> {
    keys = await loadNaverKeys();
    basket = await loadBasket();
    const ready = hasSearchKeys(keys) || hasAdKeys(keys);
    needKeys.hidden = ready;
    needKeys.replaceChildren(
      h('p', { class: 'message warn' }, '네이버 API 키가 아직 없어요. 설정에서 로그인하면 가족이 함께 쓰는 키를 받아 와요. 설정의 "네이버 API 키"에 직접 넣을 수도 있어요.'),
      h('div', { class: 'buttons' }, goSettings),
    );
    findButton.disabled = !ready;
    drawBasket();
    drawResults();
  }
  onStoreChange(['naverKeys', 'research'], () => void refresh());
  void refresh();

  queryInput.value = remembered(LAST_QUERY) ?? '';

  const form = h('section', { class: 'card' },
    h('h2', null, '자료 찾기'),
    h('p', { class: 'hint' }, '쓰려는 주제를 적으면 네이버에서 키워드의 검색 수, 윗자리에 나오는 블로그 글, 관련 뉴스를 한 번에 찾아요.'),
    needKeys,
    field('찾을 말', queryInput),
    h('div', { class: 'buttons' }, findButton),
    message,
  );

  return h('div', { class: 'stack' }, form, basketBox, results);
}
