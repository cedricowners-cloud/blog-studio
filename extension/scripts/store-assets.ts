// 크롬 웹 스토어에 올릴 때 쓰는 그림을 만든다. 개발할 때만 쓴다. 확장 패키지에 들어가지 않는다.
//   npm run build && npm run store:assets
//
// 만드는 것
//   public/icon/16.png, 32.png, 48.png, 128.png   확장의 아이콘 (빌드하면 패키지에 들어간다)
//   store/icon-128.png                            스토어에 올리는 아이콘 (위의 128과 같은 그림)
//   store/screenshot-1.png ~ 3.png                스토어의 화면 사진 (1280×800)
//
// 방법: 이 컴퓨터의 크롬을 창 없이 띄워서 그린다. 새 임시 프로필을 쓰므로 내 크롬의 로그인이나 기록은 건드리지 않는다.
// 화면 사진은 미리보기 서버(preview-server.ts)의 화면을 찍는다. 진짜 네이버나 진짜 AI를 부르지 않는다.
// 사진 속의 키워드, 숫자, 글은 아래에 적어 둔 예시다. 사진에도 "예시"라고 적는다.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4183;
const ONLY = process.argv[2] ?? 'all'; // icons | shots | all

// ---------- 크롬과 이야기하기 (DevTools 프로토콜) ----------

type Json = Record<string, unknown>;

class Browser {
  private ws: WebSocket;
  private nextId = 0;
  private waiting = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  private handlers: { method: string; sessionId?: string; fn: (params: Json) => void }[] = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: Json; error?: { message: string }; method?: string; params?: Json; sessionId?: string };
      if (message.id != null) {
        const entry = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (message.error) entry?.reject(new Error(message.error.message));
        else entry?.resolve(message.result ?? {});
        return;
      }
      for (const handler of [...this.handlers]) {
        if (handler.method !== message.method || (handler.sessionId && handler.sessionId !== message.sessionId)) continue;
        this.handlers.splice(this.handlers.indexOf(handler), 1);
        handler.fn(message.params ?? {});
      }
    });
  }

  send(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  once(method: string, sessionId?: string): Promise<Json> {
    return new Promise((resolve) => this.handlers.push({ method, sessionId, fn: resolve }));
  }
}

class Page {
  private browser: Browser;
  private session: string;

  constructor(browser: Browser, session: string) {
    this.browser = browser;
    this.session = session;
  }

  static async open(browser: Browser, width: number, height: number, scale: number): Promise<Page> {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(browser, String(sessionId));
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    return page;
  }

  send(method: string, params: Json = {}): Promise<Json> {
    return this.browser.send(method, params, this.session);
  }

  async goto(url: string): Promise<void> {
    const loaded = this.browser.once('Page.loadEventFired', this.session);
    await this.send('Page.navigate', { url });
    await loaded;
  }

  /** 페이지 안에서 식을 돌리고 값을 받는다. */
  async run<T = unknown>(expression: string): Promise<T> {
    const result = (await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
      result?: { value?: T };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    };
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value as T;
  }

  /** 식이 참이 될 때까지 기다린다. */
  async until(expression: string, what: string): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      if (await this.run<boolean>(`Boolean(${expression})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`기다렸지만 되지 않았어요: ${what}`);
  }

  async shot(transparent = false): Promise<Buffer> {
    if (transparent) await this.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    return Buffer.from(String(data), 'base64');
  }
}

async function launchChrome(profile: string): Promise<{ child: ChildProcess; browser: Browser }> {
  const child = spawn(
    CHROME,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const address = await new Promise<string>((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Error('크롬이 뜨지 않았어요. CHROME_PATH 로 크롬의 위치를 알려 주세요.')), 20000);
    child.stderr?.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (found) {
        clearTimeout(timer);
        resolve(found[1] as string);
      }
    });
    child.once('error', reject);
  });
  const ws = new WebSocket(address);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('크롬에 연결하지 못했어요.')));
  });
  return { child, browser: new Browser(ws) };
}

// ---------- 아이콘 ----------
// 직접 그린 그림이다. 파란 둥근 네모(확장의 강조 색) 위에 글줄 세 개와 연필.
// 스토어의 규칙: 128×128 안에 그림은 96×96, 둘레 16픽셀은 비워 둔다.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b88ff"/>
      <stop offset="1" stop-color="#1a56c9"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="96" height="96" rx="23" fill="url(#bg)"/>
  <rect x="35" y="40" width="58" height="10" rx="5" fill="#fff"/>
  <rect x="35" y="59" width="58" height="10" rx="5" fill="#fff" opacity=".92"/>
  <rect x="35" y="78" width="26" height="10" rx="5" fill="#fff" opacity=".92"/>
  <g transform="translate(86 80) rotate(45)">
    <rect x="-8" y="-27" width="16" height="33" rx="3" fill="#ffc83d" stroke="#1a56c9" stroke-width="3"/>
    <path d="M-8 6 L8 6 L0 21 Z" fill="#fff4d6" stroke="#1a56c9" stroke-width="3" stroke-linejoin="round"/>
    <path d="M-3 15.5 L3 15.5 L0 21 Z" fill="#1a2b4a"/>
  </g>
</svg>`;

async function makeIcons(browser: Browser, work: string): Promise<void> {
  const html = join(work, 'icon.html');
  await writeFile(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${ICON_SVG}`);
  await mkdir(join(root, 'public', 'icon'), { recursive: true });
  await mkdir(join(root, 'store'), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const page = await Page.open(browser, size, size, 1);
    await page.goto(pathToFileURL(html).href);
    const png = await page.shot(true);
    await writeFile(join(root, 'public', 'icon', `${size}.png`), png);
    if (size === 128) await writeFile(join(root, 'store', 'icon-128.png'), png);
  }
  console.log('아이콘: public/icon/16.png, 32.png, 48.png, 128.png · store/icon-128.png');
}

// ---------- 화면 사진 ----------

// 사진에 보일 예시 자료. 진짜 검색 결과가 아니다.
const SAMPLE_KEYWORDS = [
  ['도킹스테이션추천', 2090, 2140, '높음'],
  ['맥북도킹스테이션', 1480, 3210, '높음'],
  ['노트북도킹스테이션', 1210, 1870, '중간'],
  ['썬더볼트도킹스테이션', 880, 1150, '중간'],
  ['c타입허브추천', 1930, 5420, '높음'],
  ['듀얼모니터연결', 390, 2620, '낮음'],
  ['도킹스테이션연결방법', 210, 480, '낮음'],
  ['도킹스테이션가격', 170, 350, '중간'],
  ['재택근무책상꾸미기', 320, 1240, '낮음'],
  ['모니터두대연결', 540, 1980, '중간'],
  ['usb허브발열', 90, 260, '낮음'],
  ['도킹스테이션고르는법', 130, 410, '낮음'],
].map(([relKeyword, pc, mobile, compIdx]) => ({ relKeyword, monthlyPcQcCnt: pc, monthlyMobileQcCnt: mobile, compIdx }));

const SAMPLE_BLOG_TITLES = [
  '도킹스테이션 고르기 전에 본 다섯 가지',
  '노트북에 모니터 두 대 연결한 기록',
  '재택근무 책상, 선 정리부터 했어요',
  '허브와 도킹스테이션은 무엇이 다를까',
  '2주 써 보고 적는 도킹스테이션 후기',
  '포트 수보다 먼저 볼 것: 충전 출력',
  '발열이 걱정될 때 확인한 것들',
  '모니터 해상도와 주사율 맞추기',
];

const SAMPLE_TITLE = '재택근무용 도킹스테이션, 고르기 전에 볼 네 가지';
const SAMPLE_BODY = [
  '노트북 한 대로 일하다 보면 꽂을 곳이 늘 모자라요. 도킹스테이션을 고르면서 제가 확인한 것을 순서대로 적었어요.',
  '',
  '[h2]먼저 내 노트북의 포트를 확인해요[/h2]',
  '같은 모양의 C타입이어도 화면을 내보내지 못하는 포트가 있어요. [mark]포트 옆의 번개 표시나 화면 표시[/mark]를 먼저 봐요.',
  '',
  '[h2]모니터는 몇 대를 연결할 건가요[/h2]',
  '모니터 2대를 쓰려면 화면 출력 단자가 2개 있어야 해요. 4K 화면은 60Hz를 지원하는지도 확인해요.',
  '',
  '[h2]충전 출력은 넉넉하게 골라요[/h2]',
  '노트북이 65W로 충전된다면 도킹스테이션은 85W 이상이 좋아요. [pos]충전과 연결을 선 하나로[/pos] 끝낼 수 있어요.',
  '',
  '[h2]열과 선의 길이도 살펴봐요[/h2]',
  '오래 쓰면 따뜻해지는 제품이 많아요. 선이 짧으면 책상 위에서 놓을 자리가 정해지니 길이도 재 봐요.',
].join('\n');

/** 미리보기 화면 안에서 쓰는 작은 도구들. */
const HELPERS = `
  window.__vis = (el) => el && el.offsetParent !== null;
  window.__byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => __vis(el) && el.textContent.trim() === text);
  window.__hasText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => __vis(el) && el.textContent.includes(text));
  window.__byHint = (hint) => [...document.querySelectorAll('input, textarea')].find((el) => __vis(el) && (el.placeholder || '').startsWith(hint));
  window.__type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  window.__tab = (label) => { __byText('button.tab', label).click(); window.scrollTo(0, 0); };
  window.__top = (el) => { window.scrollTo(0, 0); if (el) window.scrollTo(0, el.getBoundingClientRect().top - (document.querySelector('nav.tabs')?.offsetHeight ?? 0) - 10); };
`;

/** 네이버로 가는 요청에 예시 자료로 답하게 한다 (미리보기의 가짜 답 대신). */
const SAMPLE_FETCH = `
  (() => {
    const before = window.fetch;
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const keywords = ${JSON.stringify(SAMPLE_KEYWORDS)};
    const titles = ${JSON.stringify(SAMPLE_BLOG_TITLES)};
    window.fetch = async (input, init) => {
      const url = String(input);
      if (/api\\.searchad\\.naver\\.com\\/keywordstool/.test(url)) return json({ keywordList: keywords });
      const kind = /openapi\\.naver\\.com\\/v1\\/search\\/(\\w+)\\.json/.exec(url)?.[1];
      if (kind === 'blog') return json({ total: 34939, start: 1, display: titles.length, items: titles.map((title, i) => ({
        title, link: 'https://blog.naver.com/example' + (i + 1) + '/1', bloggername: '예시 블로그 ' + (i + 1), postdate: '202611' + String(20 - i).padStart(2, '0'),
        description: '예시 요약이에요. 이 글이 무엇을 다루는지 두세 줄로 보여 줘요.',
      })) });
      if (kind === 'news') return json({ total: 6422, start: 1, display: 6, items: Array.from({ length: 6 }, (_, i) => ({
        title: '예시 기사 제목 ' + (i + 1), originallink: 'https://news.example.com/' + (i + 1), link: 'https://news.example.com/' + (i + 1),
        description: '예시 기사 요약이에요.', pubDate: 'Mon, ' + (16 - i) + ' Nov 2026 09:00:00 +0900',
      })) });
      return before(input, init);
    };
  })();
`;

const PANEL = { width: 400, height: 758 };

async function capturePanels(browser: Browser): Promise<Record<string, Buffer>> {
  const page = await Page.open(browser, PANEL.width, PANEL.height, 2);
  await page.goto(`http://127.0.0.1:${PORT}/?pack=1&keys=1&naver=1&blog=1`);
  await page.until(`document.querySelector('nav.tabs button.tab')`, '사이드 패널 화면');
  await page.run(HELPERS + SAMPLE_FETCH);
  // 미리보기 서버는 버전 뒤에 "(미리보기)"를 붙인다. 진짜 확장에는 없는 글이라 뺀다.
  await page.run(`(() => { const stage = document.querySelector('.stage'); if (stage) stage.textContent = stage.textContent.replace(' (미리보기)', ''); })();`);
  const shots: Record<string, Buffer> = {};
  const settle = () => new Promise((r) => setTimeout(r, 350));

  // 자료 탭: 키워드
  await page.run(`__tab('자료'); __type(__byHint('예: 도킹스테이션'), '도킹스테이션 추천'); __byText('button', '찾기').click();`);
  await page.until(`__byText('button', '메인')`, '키워드 목록');
  await page.run(`__byText('button', '메인').click();`);
  await page.until(`__byText('button', '메인 ✓')`, '메인 키워드 고르기');
  await page.run(`[...document.querySelectorAll('button')].filter((b) => __vis(b) && b.textContent.trim() === '서브').slice(1, 3).forEach((b) => b.click());`);
  await settle();
  shots.search = await page.shot();
  await page.run(`__top(document.querySelector('button.subtab').parentElement);`);
  await settle();
  shots.keywords = await page.shot();

  // 자료 탭: 블로그 글도 두 개 고른다 (글쓰기 탭에 참고 자료로 넘어간 모습을 찍으려고)
  await page.run(`__hasText('button.subtab', '블로그').click();`);
  await page.until(`[...document.querySelectorAll('input[type=checkbox]')].some(__vis)`, '블로그 글 목록');
  await page.run(`[...document.querySelectorAll('input[type=checkbox]')].filter(__vis).slice(0, 2).forEach((c) => c.click());`);
  await settle();

  // 글쓰기 탭: 자료에서 고른 것이 채워진 모습
  await page.run(`__byText('button', '글쓰기에 넣기').click();`);
  await settle();
  await page.run(`__tab('글쓰기'); __type(__byHint('예: 2026 소상공인'), '${SAMPLE_TITLE}'); window.scrollTo(0, 0);`);
  await settle();
  shots.write = await page.shot();

  // 사진 리뷰 탭
  await page.run(`__tab('사진 리뷰'); __type(__byHint('예: 베이직기어'), '도킹스테이션 (예시 제품)'); __type(__byHint('예: 5만 9천 원'), '5만 9천 원에 샀어요. 노트북에 모니터 두 대를 연결하려고 샀어요. 열이 덜 나서 좋았고, 선이 짧은 점은 아쉬웠어요. 2주 썼어요.'); window.scrollTo(0, 0);`);
  await settle();
  shots.review = await page.shot();

  // 채우기 탭: 글
  await page.run(`__tab('채우기'); __type(__byHint('제목'), ${JSON.stringify(SAMPLE_TITLE)}); __type(__byHint('본문 (blog_studio'), ${JSON.stringify(SAMPLE_BODY)});`);
  await settle();
  await page.run(`__top(__byHint('제목').closest('section'));`);
  await settle();
  shots.fill = await page.shot();

  // 채우기 탭: 블로그용 카드
  await page.run(`(() => { const s = __byText('summary', '블로그용 카드 만들기'); if (!s.parentElement.open) s.click(); })();`);
  await page.until(`__byText('button', '카드 만들기')`, '카드 만들기 버튼');
  await page.run(`__byText('button', '카드 만들기').click();`);
  await page.until(`__byText('button', '카드를 글에 넣기')`, '만든 카드');
  await new Promise((r) => setTimeout(r, 1200)); // 글씨체를 불러와 카드를 다시 그릴 시간
  await page.run(`__top(__byText('button', '카드 만들기'));`); // 만든 표지 카드가 다 보이는 자리
  await settle();
  shots.cards = await page.shot();
  return shots;
}

type Slide = { file: string; kicker: string; title: string; points: string[]; panels: [string, string] };

const SLIDES: Slide[] = [
  {
    file: 'screenshot-1.png',
    kicker: '자료 찾기',
    title: '무엇을 쓸지,\n자료부터 한 번에 찾아요',
    points: ['키워드가 한 달에 몇 번 검색되는지 봐요', '윗자리 블로그 글과 관련 뉴스를 찾아요', '고른 것은 글쓰기 칸에 바로 채워져요'],
    panels: ['search', 'keywords'],
  },
  {
    file: 'screenshot-2.png',
    kicker: '글 만들기',
    title: '내 AI 키로\n글의 초안을 만들어요',
    points: ['Gemini, GPT, Claude 중에서 골라 써요', 'AI 키는 내 컴퓨터에만 둬요', '내가 찍은 사진으로 리뷰 글도 써요'],
    panels: ['write', 'review'],
  },
  {
    file: 'screenshot-3.png',
    kicker: '채우기',
    title: '네이버 글쓰기 화면에\n글과 카드를 채워요',
    points: ['소제목, 인용구, 색 강조까지 그대로 넣어요', '소제목마다 요약 카드를 그려 줘요', '발행 버튼은 내가 직접 눌러요'],
    panels: ['fill', 'cards'],
  },
];

function slideHtml(slide: Slide, images: Record<string, string>, font: string, icon: string): string {
  const panel = (key: string) => `<figure><img src="${images[key]}" alt=""></figure>`;
  return `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family: 'Pretendard'; src: url('${font}') format('woff2'); font-weight: 45 920; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body { font-family: 'Pretendard', sans-serif; color: #14213d; background: linear-gradient(135deg, #eef4ff 0%, #f7f9fc 55%, #e8f0ff 100%); display: grid; grid-template-columns: 404px 1fr; gap: 0; padding: 40px 48px; }
  .copy { display: flex; flex-direction: column; justify-content: center; padding-right: 36px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 19px; color: #1a56c9; margin-bottom: 44px; }
  .brand img { width: 44px; height: 44px; margin: -6px; }
  .kicker { display: inline-block; align-self: flex-start; font-size: 16px; font-weight: 700; color: #1a56c9; background: #dbe8ff; padding: 6px 14px; border-radius: 999px; margin-bottom: 18px; }
  h1 { font-size: 38px; line-height: 1.28; letter-spacing: -0.02em; font-weight: 800; margin: 0 0 28px; white-space: pre-line; word-break: keep-all; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 13px; }
  li { font-size: 18.5px; line-height: 1.45; font-weight: 500; color: #33415c; padding-left: 30px; position: relative; word-break: keep-all; }
  li::before { content: ''; position: absolute; left: 0; top: 4px; width: 19px; height: 19px; border-radius: 50%; background: #1f6feb; }
  li::after { content: ''; position: absolute; left: 6.5px; top: 8px; width: 5px; height: 9px; border: solid #fff; border-width: 0 2.4px 2.4px 0; transform: rotate(45deg); }
  .note { margin-top: 40px; font-size: 13.5px; color: #7b879c; }
  .panels { display: grid; grid-template-columns: 380px 380px; gap: 24px; align-items: start; }
  figure { margin: 0; position: relative; }
  figure img { display: block; width: 380px; height: 720px; border-radius: 16px; border: 1px solid #d5ddec; box-shadow: 0 18px 44px rgba(26, 53, 110, .16); background: #fff; }
</style>
<body>
  <div class="copy">
    <div class="brand"><img src="${icon}" alt="">blog_studio 도우미</div>
    <span class="kicker">${slide.kicker}</span>
    <h1>${slide.title}</h1>
    <ul>${slide.points.map((p) => `<li>${p}</li>`).join('')}</ul>
    <p class="note">화면 속의 글과 숫자는 예시예요.</p>
  </div>
  <div class="panels">${panel(slide.panels[0])}${panel(slide.panels[1])}</div>
</body>`;
}

async function makeShots(browser: Browser, work: string): Promise<void> {
  const server = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(here, 'preview-server.ts')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('미리보기 서버가 뜨지 않았어요.')), 15000);
      server.stdout?.on('data', () => {
        clearTimeout(timer);
        resolve();
      });
      server.once('error', reject);
    });
    const panels = await capturePanels(browser);
    const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
    const images = Object.fromEntries(Object.entries(panels).map(([key, png]) => [key, dataUrl(png)]));
    const font = `data:font/woff2;base64,${(await readFile(join(root, 'public', 'fonts', 'PretendardVariable.woff2'))).toString('base64')}`;
    const icon = dataUrl(await readFile(join(root, 'public', 'icon', '128.png')));
    await mkdir(join(root, 'store'), { recursive: true });
    for (const slide of SLIDES) {
      const html = join(work, slide.file.replace('.png', '.html'));
      await writeFile(html, slideHtml(slide, images, font, icon));
      const page = await Page.open(browser, 1280, 800, 1);
      await page.goto(pathToFileURL(html).href);
      await page.run(`document.fonts.ready.then(() => true)`);
      await writeFile(join(root, 'store', slide.file), await page.shot());
    }
    console.log(`화면 사진: ${SLIDES.map((s) => `store/${s.file}`).join(', ')}`);
  } finally {
    server.kill();
  }
}

const work = await mkdtemp(join(tmpdir(), 'blog-studio-store-'));
const { child, browser } = await launchChrome(join(work, 'profile'));
try {
  if (ONLY !== 'shots') await makeIcons(browser, work);
  if (ONLY !== 'icons') await makeShots(browser, work);
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(0);
