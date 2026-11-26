// 네이버 API 호출 코드를 가짜 서버로 시험한다. 진짜 네이버는 부르지 않는다.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  cleanText,
  EMPTY_NAVER_KEYS,
  hasAdKeys,
  hasSearchKeys,
  hintKeywords,
  keywordTool,
  NaverError,
  newsDate,
  normalizeNaverKeys,
  parseKeyLines,
  searchBlogs,
  searchNews,
  signSearchAd,
  type NaverKeys,
} from '../lib/naver/api.ts';
import { buildFullPrompt, canUseNews } from '../lib/writer/prompt-builder.ts';
import { buildPack } from '../scripts/build-prompt-pack.ts';

const KEYS: NaverKeys = { clientId: 'test-client-id', clientSecret: 'test-client-SECRET-1', license: 'test-LICENSE-000000', secret: 'test-ad-SECRET-123456', customerId: '1234567' };

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
}

function fakeFetch(responses: (Response | Error)[]): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(url)), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('가짜 응답이 모자라요');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('네이버 키: 설정 파일의 줄에서 네이버 키만 골라낸다', () => {
  const text = [
    '# 주석',
    'OPENAI_API_KEY=sk-should-not-be-picked',
    'NAVER_CLIENT_ID=abc123',
    'NAVER_CLIENT_SECRET="quoted secret"',
    "export NAVER_SEARCH_ACCESS_LICENSE_KEY='license=with=equals'",
    'NAVER_SEARCH_SECRET_KEY =  spaced  ',
    'NAVER_SEARCH_CUSTOMER_ID=7654321',
    'NAVER_SOMETHING_ELSE=nope',
    'NAVER_CLIENT_ID=',
  ].join('\n');
  assert.deepEqual(parseKeyLines(text), { clientId: 'abc123', clientSecret: 'quoted secret', license: 'license=with=equals', secret: 'spaced', customerId: '7654321' });
  assert.deepEqual(parseKeyLines('아무 글'), {});
  assert.equal(hasSearchKeys(EMPTY_NAVER_KEYS), false);
  assert.equal(hasAdKeys({ ...EMPTY_NAVER_KEYS, license: 'a', secret: 'b' }), false);
  assert.equal(hasAdKeys(KEYS) && hasSearchKeys(KEYS), true);
  assert.deepEqual(normalizeNaverKeys({ clientId: ' a ', secret: 3 }), { ...EMPTY_NAVER_KEYS, clientId: 'a' });
  assert.deepEqual(normalizeNaverKeys(null), EMPTY_NAVER_KEYS);
});

test('네이버 글자 다듬기: 꾸밈 표시를 떼고 특수 글자를 풀어 준다', () => {
  assert.equal(cleanText('<b>도킹</b>스테이션 &quot;추천&quot; &amp; 비교 &lt;2026&gt;'), '도킹스테이션 "추천" & 비교 <2026>');
  assert.equal(cleanText('줄이\n  바뀌고   빈칸이 많은&nbsp;글 &#39;따옴표&#39; &#x3A9;'), "줄이 바뀌고 빈칸이 많은 글 '따옴표' Ω");
  assert.equal(cleanText('&모르는; 것은 그대로'), '&모르는; 것은 그대로');
  assert.equal(cleanText(null), '');
  // 화면에 넣을 글자에 태그가 남지 않는다
  assert.ok(!/[<>]/.test(cleanText('<img src=x onerror=alert(1)>글<script>alert(1)</script>')));
});

test('블로그 글 찾기: 요청 모양과 결과 읽기', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(200, {
      total: 34939,
      items: [
        { title: '<b>도킹스테이션</b> 추천 &amp; 비교', link: 'https://blog.naver.com/a/1', description: '요약 <b>글</b>', bloggername: '블로거 하나', postdate: '20261114' },
        { title: '주소가 이상한 글', link: 'javascript:alert(1)', description: '', bloggername: '', postdate: '없음' },
        '이상한 값',
      ],
    }),
  ]);
  const result = await searchBlogs(KEYS, '  도킹스테이션 추천 ', { display: 500, fetchImpl });
  assert.equal(result.total, 34939);
  assert.deepEqual(result.items, [
    { title: '도킹스테이션 추천 & 비교', link: 'https://blog.naver.com/a/1', description: '요약 글', blogger: '블로거 하나', date: '2026-11-14' },
    // http 로 시작하지 않는 주소는 버린다 (눌러도 아무 데로 가지 않게)
    { title: '주소가 이상한 글', link: '', description: '', blogger: '', date: '' },
  ]);
  const call = calls[0]!;
  assert.equal(call.url.origin + call.url.pathname, 'https://openapi.naver.com/v1/search/blog.json');
  assert.equal(call.url.searchParams.get('query'), '도킹스테이션 추천');
  assert.equal(call.url.searchParams.get('display'), '100', '한 번에 100개까지만');
  assert.equal(call.url.searchParams.get('sort'), 'sim');
  assert.deepEqual(call.headers, { 'X-Naver-Client-Id': KEYS.clientId, 'X-Naver-Client-Secret': KEYS.clientSecret });
  // 키는 주소에 넣지 않는다
  assert.ok(!call.url.href.includes(KEYS.clientSecret) && !call.url.href.includes(KEYS.clientId));
});

test('뉴스 찾기: 언론사 이름과 날짜를 읽는다', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(200, {
      total: 6422,
      items: [
        { title: '기사 &quot;제목&quot;', originallink: 'https://www.example-news.co.kr/a/1', link: 'https://n.news.naver.com/article/001/1', description: '<b>요약</b>', pubDate: 'Wed, 18 Nov 2026 00:30:00 +0900' },
        { title: '네이버 주소가 없는 기사', originallink: 'https://press.example.com/b', link: '', description: '', pubDate: '모름' },
      ],
    }),
  ]);
  const result = await searchNews(KEYS, '도킹스테이션', { sort: 'date', display: 5, fetchImpl });
  assert.deepEqual(result.items, [
    { title: '기사 "제목"', link: 'https://n.news.naver.com/article/001/1', description: '요약', source: 'example-news.co.kr', date: '2026-11-18' },
    { title: '네이버 주소가 없는 기사', link: 'https://press.example.com/b', description: '', source: 'press.example.com', date: '' },
  ]);
  assert.equal(calls[0]!.url.pathname, '/v1/search/news.json');
  assert.equal(calls[0]!.url.searchParams.get('sort'), 'date');
  // 날짜는 한국 시각으로 읽는다 (17일 밤 UTC 가 아니라 18일)
  assert.equal(newsDate('Tue, 17 Nov 2026 16:00:00 +0000'), '2026-11-18');
});

test('키워드 찾기: 서명은 웹(web/lib/naver.ts)과 같은 방식이다', async () => {
  const expected = createHmac('sha256', KEYS.secret).update('1700000000000.GET./keywordstool').digest('base64');
  assert.equal(await signSearchAd(KEYS.secret, '1700000000000', 'GET', '/keywordstool'), expected);
});

test('키워드 찾기: 요청 모양과 결과 읽기', async () => {
  const { fetchImpl, calls } = fakeFetch([
    json(200, {
      keywordList: [
        { relKeyword: '도킹스테이션', monthlyPcQcCnt: 2090, monthlyMobileQcCnt: 2140, compIdx: '높음' },
        { relKeyword: '썬더볼트독', monthlyPcQcCnt: '< 10', monthlyMobileQcCnt: '1,230', compIdx: '중간' },
        { relKeyword: '아주드문말', monthlyPcQcCnt: '< 10', monthlyMobileQcCnt: '< 10' },
        { relKeyword: '' },
        null,
      ],
    }),
  ]);
  const rows = await keywordTool(KEYS, ['도킹 스테이션'], { fetchImpl, now: () => 1700000000000 });
  assert.deepEqual(rows, [
    { keyword: '도킹스테이션', pc: 2090, mobile: 2140, total: 4230, competition: '높음' },
    { keyword: '썬더볼트독', pc: null, mobile: 1230, total: 1230, competition: '중간' },
    { keyword: '아주드문말', pc: null, mobile: null, total: 0, competition: '' },
  ]);
  const call = calls[0]!;
  assert.equal(call.url.origin + call.url.pathname, 'https://api.searchad.naver.com/keywordstool');
  // 키워드 도구는 띄어쓰기를 받지 않는다. 빈칸을 떼고 보낸다.
  assert.equal(call.url.searchParams.get('hintKeywords'), '도킹스테이션');
  assert.equal(call.url.searchParams.get('showDetail'), '1');
  assert.deepEqual(call.headers, {
    'X-Timestamp': '1700000000000',
    'X-API-KEY': KEYS.license,
    'X-Customer': KEYS.customerId,
    'X-Signature': createHmac('sha256', KEYS.secret).update('1700000000000.GET./keywordstool').digest('base64'),
  });
  // 비밀키는 서명에만 쓴다. 헤더에도 주소에도 그대로 실리지 않는다.
  assert.ok(!JSON.stringify(call.headers).includes(KEYS.secret) && !call.url.href.includes(KEYS.secret));
  assert.deepEqual(hintKeywords(['도킹 스테이션', '도킹스테이션', ' ', 'a', 'b', 'c', 'd', 'e']), ['도킹스테이션', 'a', 'b', 'c', 'd']);
});

test('네이버 오류: 키가 없으면 부르지 않고, 틀리면 쉬운 말로 알려 준다 (키는 오류 글에 넣지 않는다)', async () => {
  const none = fakeFetch([]);
  await assert.rejects(searchBlogs(EMPTY_NAVER_KEYS, '글', { fetchImpl: none.fetchImpl }), (err: NaverError) => err.kind === 'no-keys');
  await assert.rejects(keywordTool({ ...KEYS, secret: '' }, ['글'], { fetchImpl: none.fetchImpl }), (err: NaverError) => err.kind === 'no-keys');
  assert.equal(none.calls.length, 0);

  const cases: [Response | Error, string, number | null][] = [
    [json(401, { errorMessage: `NID AUTH Result Invalid (28) secret=${KEYS.clientSecret}`, errorCode: '024' }), 'auth', 401],
    [json(429, { errorMessage: 'Query limit exceeded' }), 'rate', 429],
    [json(400, { errorMessage: 'Incorrect query request' }), 'bad-request', 400],
    [new Response('서버 오류', { status: 500 }), 'other', 500],
    [new TypeError('fetch failed'), 'network', null],
  ];
  for (const [response, kind, status] of cases) {
    const { fetchImpl } = fakeFetch([response]);
    await assert.rejects(searchBlogs(KEYS, '글', { fetchImpl }), (err: NaverError) => {
      assert.ok(err instanceof NaverError);
      assert.equal(err.kind, kind);
      assert.equal(err.status, status);
      assert.ok(!err.message.includes(KEYS.clientSecret), '오류 글에 키가 들어갔어요');
      return true;
    });
  }
  const ad = fakeFetch([json(403, { title: 'Invalid Signature' })]);
  await assert.rejects(keywordTool(KEYS, ['글'], { fetchImpl: ad.fetchImpl }), (err: NaverError) => err.kind === 'auth' && err.message.includes('Invalid Signature'));
  // 검색어가 비면 키워드 도구를 부르지 않는다
  assert.deepEqual(await keywordTool(KEYS, ['  '], { fetchImpl: fakeFetch([]).fetchImpl }), []);
});

test('글쓰기 프롬프트: 참고 뉴스는 참고 자료 뒤, 출력 형식 앞에 붙는다', async () => {
  const pack = await buildPack();
  assert.equal(canUseNews(pack), true);
  const base = { method_id: pack.methods.items[1]!.id, topic: '도킹스테이션 고르는 법', main_keyword: '도킹스테이션', sub_keywords: ['썬더볼트독'] };
  const plain = buildFullPrompt(pack, base);
  const withNews = buildFullPrompt(pack, {
    ...base,
    research_context: [{ title: '윗자리 글', description: '요약', link: 'https://blog.naver.com/a/1', bloggername: '블로거' }],
    news_context: [{ title: '기사 제목', description: '기사 요약', link: 'https://n.news.naver.com/1', source: 'example.co.kr', date: '2026-11-18' }, { title: '빈 기사' }],
  });
  assert.ok(!plain.includes('[참고 뉴스]'));
  for (const piece of ['[참고 뉴스] — 주제와 관련된 뉴스 2건', '### 뉴스 1. 기사 제목', '- 날짜: 2026-11-18', '- 출처: example.co.kr', '- 요약: 기사 요약', '### 뉴스 2. 빈 기사', '- 날짜: -']) {
    assert.ok(withNews.includes(piece), `프롬프트에 없어요: ${piece}`);
  }
  const at = (text: string) => withNews.indexOf(text);
  assert.ok(at('### 참고 1. 윗자리 글') < at('[참고 뉴스]'));
  assert.ok(at('[참고 뉴스]') < withNews.lastIndexOf(pack.glue.output_format!.trim().split('\n')[0]!));
  assert.ok(!withNews.includes('{{'));

  // 예전 묶음에는 뉴스용 글이 없다. 그때는 뉴스를 붙이지 않고, 나머지는 그대로 만든다.
  const old = JSON.parse(JSON.stringify(pack));
  delete old.glue['research.news_head'];
  assert.equal(canUseNews(old), false);
  assert.equal(buildFullPrompt(old, { ...base, news_context: [{ title: '기사' }] }), plain);
});

// ── 키워드 정렬과 찾기 ──

test('키워드 정렬: 검색 수와 경쟁 정도로 정렬한다 (같은 값은 네이버가 준 차례대로)', async () => {
  const { sortKeywords, filterKeywords } = await import('../lib/naver/keywords.ts');
  const row = (keyword: string, total: number, competition: string) => ({ keyword, pc: total, mobile: 0, total, competition });
  const rows = [row('가', 100, '높음'), row('나', 500, '낮음'), row('다', 100, '중간'), row('라', 0, ''), row('마', 900, '높음'), row('바', 30, '낮음')];
  const names = (sort: Parameters<typeof sortKeywords>[1]) => sortKeywords(rows, sort).map((r) => r.keyword).join('');

  assert.equal(names('related'), '가나다라마바');
  assert.equal(names('volume-desc'), '마나가다바라');
  assert.equal(names('volume-asc'), '라바가다나마');
  // 경쟁이 낮은 것부터. 같은 경쟁 안에서는 검색 수가 많은 것이 먼저. 경쟁을 모르는 것은 맨 뒤
  assert.equal(names('comp-asc'), '나바다마가라');
  assert.equal(names('comp-desc'), '마가다나바라');
  // 원래 목록은 바꾸지 않는다
  assert.equal(rows.map((r) => r.keyword).join(''), '가나다라마바');

  const list = [row('도킹스테이션 추천', 1, '낮음'), row('맥북도킹스테이션', 1, '낮음'), row('USB허브', 1, '낮음'), row('맥북 허브 추천', 1, '낮음')];
  const found = (text: string) => filterKeywords(list, text).map((r) => r.keyword);
  assert.deepEqual(found('도킹'), ['도킹스테이션 추천', '맥북도킹스테이션']);
  assert.deepEqual(found('  맥북   추천 '), ['맥북 허브 추천'], '여러 말을 적으면 모두 들어간 것만');
  assert.deepEqual(found('usb'), ['USB허브'], '영어 대소문자는 가리지 않는다');
  assert.equal(found('').length, 4);
  assert.deepEqual(found('없는말'), []);
});
