// 미리보기 전용. 크롬 확장 기능을 흉내 낸다. 확장 패키지에는 들어가지 않는다.
// - 저장소: 이 탭의 메모리에만 있다. 새로 고치면 비워진다.
// - AI 호출: 진짜 AI를 부르지 않고, 미리 적어 둔 답을 조금씩 돌려준다.
// - 주소에 ?pack=1 을 붙이면 프롬프트 묶음을 미리 넣어 둔다. ?keys=1 은 가짜 키를 넣어 둔다.
// - ?blog=1 은 네이버 블로그 글쓰기 탭이 열려 있는 것처럼 꾸민다 (가짜 글 목록과 가짜 글을 돌려준다).
// - ?slow=1 은 AI의 답을 천천히 보낸다 ([멈추기]를 눌러 볼 때 쓴다).
// - 서버(Supabase)로 가는 요청도 가로채서 가짜로 답한다. 진짜 서버에는 아무것도 보내지 않는다.
//   시험용 계정은 아래 PREVIEW_LOGIN 에 있다. ?server=denied 는 프롬프트를 받을 수 없는 계정인 것처럼 꾸민다.
(() => {
  const params = new URLSearchParams(location.search);
  const store = {};
  const listeners = [];

  const local = {
    async get(key) {
      if (key == null) return { ...store };
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, JSON.parse(JSON.stringify(store[k]))]));
    },
    async set(values) {
      const changes = {};
      for (const [k, v] of Object.entries(values)) {
        changes[k] = { oldValue: store[k], newValue: v };
        store[k] = JSON.parse(JSON.stringify(v));
      }
      for (const fn of listeners) fn(changes, 'local');
    },
    async remove(key) {
      // 진짜 저장소처럼 이름 하나도, 여러 개도 받는다.
      const changes = {};
      for (const name of Array.isArray(key) ? key : [key]) {
        changes[name] = { oldValue: store[name] };
        delete store[name];
      }
      for (const fn of listeners) fn(changes, 'local');
    },
    async setAccessLevel() {},
  };

  window.chrome = {
    runtime: { id: 'preview', getURL: (path) => path, getManifest: () => ({ version: window.__PREVIEW_VERSION__ + ' (미리보기)' }) },
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: {
      create: async ({ url }) => console.log('[미리보기] 새 탭을 열어요:', url),
      query: async () => (params.get('blog') ? [{ id: 7, url: 'https://blog.naver.com/previewblog/postwrite', active: true }] : []),
    },
    scripting: {
      // 진짜 확장은 블로그 탭 안에서 글을 읽는다. 여기서는 인자의 모양을 보고 가짜 결과를 돌려준다.
      executeScript: async ({ args }) => {
        if (!params.get('blog') || !Array.isArray(args) || args.length !== 2) return [];
        const [, second] = args;
        if (typeof second === 'number') {
          return [{ result: { ok: true, reason: null, posts: FAKE_POSTS.map(({ logNo, title, date }) => ({ logNo, title, date })) } }];
        }
        const found = FAKE_POSTS.find((post) => post.logNo === second);
        return [{ result: found ? { ok: true, reason: null, title: found.title, body: found.body } : { ok: false, reason: 'no-body', title: '', body: '' } }];
      },
    },
  };

  const FAKE_POSTS = [
    { logNo: '900003', title: '가짜 내 글 셋: 법인 전환을 미룬 이유', date: '2026. 11. 10.', body: '세 번째 가짜 글이에요. 문장을 짧게 끊어 써요. '.repeat(20) },
    { logNo: '900002', title: '가짜 내 글 둘: 증여세 신고 전에 볼 것', date: '2026. 11. 3.', body: '두 번째 가짜 글이에요. 설명은 차근차근 해요. '.repeat(20) },
    { logNo: '900001', title: '가짜 내 글 하나: 짧은 글', date: '2026. 10. 27.', body: '너무 짧아서 들어가지 않는 글이에요.' },
  ];

  const MODELS = [
    { id: 'fake-large', label: '가짜 큰 모델', maxOutput: 64000 },
    { id: 'fake-small', label: '가짜 작은 모델', maxOutput: 8192 },
  ];

  // ?naver=1 은 네이버 API 키를 넣어 둔 것처럼 꾸민다 (가짜 키다).
  if (params.get('naver')) {
    store.naverKeys = { clientId: 'preview-id', clientSecret: 'preview-secret', license: 'preview-license', secret: 'preview-ad-secret', customerId: '1234567' };
  }

  if (params.get('keys')) {
    store.aiKeys = { gemini: { key: 'preview-key-0000', model: 'fake-large', models: MODELS, checkedAt: new Date().toISOString() } };
  }

  const ready = params.get('pack')
    ? fetch('/__pack.json').then((r) => r.json()).then((pack) => { store.promptPack = pack; })
    : Promise.resolve();
  // 화면 코드가 저장소를 읽기 전에 묶음이 들어가 있게 한다.
  const originalGet = local.get.bind(local);
  local.get = async (key) => { await ready; return originalGet(key); };

  const methodAnswer = (short) => JSON.stringify({
    mapping: { reader_mapping: { awareness_level: 'L2' } },
    titles: [
      { rank: 1, title: '가짜 제목 하나: 미리보기에서 만든 글' },
      { rank: 2, title: '가짜 제목 둘' },
      { rank: 3, title: '가짜 제목 셋' },
    ],
    body: '[h2]미리보기 소제목[/h2]\n' + '이것은 미리보기용 가짜 본문입니다. '.repeat(short ? 20 : 90) + '\n지원 금액은 확인 필요입니다.\n[IMG: 섹션1 - 안내 그림]',
    axiom_check: {
      items: Array.from({ length: 17 }, (_, i) => ({ number: i + 1, rule: `가짜 규칙 ${i + 1}`, passed: !(short && i === 2), evidence: '가짜 근거' })),
    },
    suggestions: { current_post_improvements: '가짜 제안입니다.' },
    meta: {},
  });

  let methodCalls = 0;
  const seoAnswer = (n) => `가짜 AI의 ${n}번째 답입니다.\n\n1.\nTitle: 가짜 SEO 제목 하나\nDescription: 설명\n\n2.\nTitle: 가짜 SEO 제목 둘\n\n## 소제목\n본문 한 줄입니다.`;
  let seoCalls = 0;

  function sseResponse(text) {
    const encoder = new TextEncoder();
    const pieces = text.match(/[\s\S]{1,60}/g) ?? [];
    const stream = new ReadableStream({
      async start(controller) {
        for (const piece of pieces) {
          await new Promise((r) => setTimeout(r, params.get('slow') ? 250 : 30));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: piece }] } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 800 } })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  // 미리보기에서만 통하는 시험용 계정. 진짜 계정이 아니다.
  const PREVIEW_LOGIN = { email: 'preview@example.com', password: 'preview-only-pass' };
  const PREVIEW_USER = { id: '00000000-0000-4000-8000-000000000001', email: PREVIEW_LOGIN.email };
  const PREVIEW_CODE = '246810';
  const token = () => ({ access_token: 'preview-access', refresh_token: 'preview-refresh', expires_in: 3600, user: PREVIEW_USER });
  const reply = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  async function fakeServer(url, init) {
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/auth/v1/token' && searchParams.get('grant_type') === 'password') {
      const body = JSON.parse(init.body);
      return body.email === PREVIEW_LOGIN.email && body.password === PREVIEW_LOGIN.password
        ? reply(200, token())
        : reply(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (pathname === '/auth/v1/token') return reply(200, token());
    if (pathname === '/auth/v1/logout') return reply(204, null);
    // 메일로 로그인: 진짜 메일은 보내지 않는다. 시험용 코드는 PREVIEW_CODE, 시험용 링크는 token=preview-hash 다.
    if (pathname === '/auth/v1/otp') {
      return JSON.parse(init.body).email === PREVIEW_LOGIN.email ? reply(200, {}) : reply(422, { error_code: 'otp_disabled' });
    }
    if (pathname === '/auth/v1/verify') {
      const body = JSON.parse(init.body);
      const good = (body.email === PREVIEW_LOGIN.email && body.token === PREVIEW_CODE) || body.token_hash === 'preview-hash';
      return good ? reply(200, token()) : reply(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    }
    if (pathname === '/auth/v1/user') return reply(200, PREVIEW_USER);
    const denied = params.get('server') === 'denied';
    if (pathname === '/rest/v1/prompt_access') return reply(200, denied ? [] : [{ user_id: PREVIEW_USER.id }]);
    // 가족이 함께 쓰는 네이버 키. ?shared=1 이면 서버에 올려 둔 것처럼 꾸민다 (가짜 키다).
    if (pathname === '/rest/v1/shared_keys') {
      return reply(200, params.get('shared') && !denied ? [{ keys: { clientId: 'shared-id', clientSecret: 'shared-secret', license: 'shared-license', secret: 'shared-ad-secret', customerId: '7654321' }, updated_at: '2026-11-18T12:00:00+00:00' }] : []);
    }
    if (pathname === '/rest/v1/prompt_packs') {
      if (denied) return reply(200, []);
      const pack = await realFetch('/__pack.json').then((r) => r.json());
      return reply(200, [{ format: pack.format, pack, updated_at: pack.built_at }]);
    }
    return reply(404, { message: '미리보기에 없는 주소' });
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input);
    if (/\.supabase\.co\//.test(url)) return fakeServer(url, init ?? {});
    // 네이버 API: 진짜 네이버를 부르지 않고 가짜 결과를 돌려준다. 키가 'bad' 로 시작하면 틀린 키로 본다.
    if (/openapi\.naver\.com\/v1\/search\//.test(url)) {
      const kind = /search\/(\w+)\.json/.exec(url)?.[1];
      const q = new URL(url).searchParams.get('query') ?? '';
      if (String(init?.headers?.['X-Naver-Client-Secret'] ?? '').startsWith('bad')) return reply(401, { errorMessage: 'NID AUTH Result Invalid (28)', errorCode: '024' });
      const sp = new URL(url).searchParams;
      const newest = sp.get('sort') === 'date';
      const items = Array.from({ length: Math.min(Number(sp.get('display') ?? 10), kind === 'news' ? 43 : 50) }, (_, i) =>
        kind === 'news'
          ? { title: `<b>${q}</b> ${newest ? '최신' : '관련'} 가짜 기사 ${i + 1} &quot;제목&quot;`, originallink: `https://www.example-news${i + 1}.com/a/${i + 1}`, link: `https://n.news.naver.com/article/00${i + 1}/000${i + 1}`, description: `가짜 기사 요약 ${i + 1}입니다. <b>${q}</b> 관련 내용.`, pubDate: `Wed, ${String(18 - (i % 17)).padStart(2, '0')} Nov 2026 09:00:00 +0900` }
          : { title: `<b>${q}</b> 가짜 블로그 글 ${i + 1}`, link: `https://blog.naver.com/fake${i + 1}/22000000000${i}`, description: `가짜 요약 ${i + 1}입니다. <b>${q}</b>에 대해 씁니다.`, bloggername: `가짜 블로거 ${i + 1}`, postdate: `202611${String(10 + (i % 18))}` },
      );
      return reply(200, { total: kind === 'news' ? 6422 : 34939, start: 1, display: items.length, items });
    }
    if (/api\.searchad\.naver\.com\/keywordstool/.test(url)) {
      if (!init?.headers?.['X-Signature']) return reply(403, { title: 'Invalid Signature' });
      const hint = (new URL(url).searchParams.get('hintKeywords') ?? '').split(',')[0];
      const keywordList = [{ relKeyword: hint, monthlyPcQcCnt: 2090, monthlyMobileQcCnt: 2140, compIdx: '높음' }].concat(
        Array.from({ length: 119 }, (_, i) => ({ relKeyword: `${hint}${['추천', '비교', '가격', '후기', '연결'][i % 5]}${i + 1}`, monthlyPcQcCnt: i % 5 === 4 ? '< 10' : 900 + ((i * 37) % 400), monthlyMobileQcCnt: i % 5 === 4 ? '< 10' : 100 + ((i * 113) % 3000), compIdx: ['높음', '중간', '낮음'][i % 3] })),
      );
      return reply(200, { keywordList });
    }
    if (!/generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com/.test(url)) return realFetch(input, init);
    if ((init?.method ?? 'GET') === 'GET') {
      if (params.get('badkey')) return new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 });
      return new Response(JSON.stringify({ models: MODELS.map((m) => ({ name: 'models/gemini-' + m.id, displayName: m.label, outputTokenLimit: m.maxOutput, supportedGenerationMethods: ['generateContent'] })) }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    const last = JSON.stringify(body.contents ?? body.messages ?? '').slice(-4000);
    // 카드 문구 다듬기: 섹션 수만큼 가짜 문구를 돌려준다.
    const whole = JSON.stringify(body.contents ?? body.messages ?? '');
    const cardCount = /섹션 데이터 \((\d+)개/.exec(whole);
    if (cardCount) {
      const cards = Array.from({ length: Number(cardCount[1]) }, (_, i) => ({ index: i + 1, lead: `AI가 다듬은 ${i + 1}번 핵심 문장입니다.`, body_text: `AI가 다듬은 ${i + 1}번 설명입니다. 문장을 끝까지 씁니다.` }));
      return sseResponse(JSON.stringify({ cards }));
    }
    // 사진으로 리뷰 쓰기: 붙여 보낸 사진 수만큼 사진 자리를 넣은 가짜 글을 돌려준다. 3번 사진은 일부러 빠뜨린다.
    const photoCount = (whole.match(/inline_data/g) ?? []).length;
    if (photoCount > 0) {
      const slots = Array.from({ length: photoCount }, (_, i) => i + 1).filter((n) => n !== 3);
      const lines = ['[제목]', '가짜 리뷰 제목 하나: 2주 써 본 솔직한 후기', '가짜 리뷰 제목 둘', '가짜 리뷰 제목 셋', '[본문]', '내 돈으로 직접 산 제품이에요.'];
      slots.forEach((n, i) => {
        lines.push('', `[h2]가짜 소제목 ${i + 1}[/h2]`, `[IMG: 사진${n} - 가짜 AI가 본 ${n}번 사진]`, '사진에 보이는 것을 적은 가짜 문단입니다. 가격은 (확인 필요: 실제 가격) 입니다.');
      });
      lines.push('', '[IMG: 사진99 - 없는 번호]', '마무리 문단입니다.');
      return sseResponse(lines.join('\n'));
    }
    if (last.includes('[글 모음]')) {
      return sseResponse('- 문장 끝은 주로 ~해요, ~이에요로 맺어요.\n- 문장을 짧게 끊어 써요.\n- 느낌표와 이모지를 쓰지 않아요.');
    }
    if (last.includes('axiom_check')) {
      methodCalls += 1;
      return sseResponse(methodAnswer(methodCalls === 1 && params.get('retry')));
    }
    seoCalls += 1;
    return sseResponse(seoAnswer(seoCalls));
  };
})();
