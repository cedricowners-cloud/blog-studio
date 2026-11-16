// 미리보기 전용. 크롬 확장 기능을 흉내 낸다. 확장 패키지에는 들어가지 않는다.
// - 저장소: 이 탭의 메모리에만 있다. 새로 고치면 비워진다.
// - AI 호출: 진짜 AI를 부르지 않고, 미리 적어 둔 답을 조금씩 돌려준다.
// - 주소에 ?pack=1 을 붙이면 프롬프트 묶음을 미리 넣어 둔다. ?keys=1 은 가짜 키를 넣어 둔다.
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
      const changes = { [key]: { oldValue: store[key] } };
      delete store[key];
      for (const fn of listeners) fn(changes, 'local');
    },
    async setAccessLevel() {},
  };

  window.chrome = {
    runtime: { id: 'preview', getManifest: () => ({ version: window.__PREVIEW_VERSION__ + ' (미리보기)' }) },
    storage: { local, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: {
      create: async ({ url }) => console.log('[미리보기] 새 탭을 열어요:', url),
      query: async () => [],
    },
    scripting: { executeScript: async () => [] },
  };

  const MODELS = [
    { id: 'fake-large', label: '가짜 큰 모델', maxOutput: 64000 },
    { id: 'fake-small', label: '가짜 작은 모델', maxOutput: 8192 },
  ];

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
          await new Promise((r) => setTimeout(r, 30));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: piece }] } }] })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 800 } })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input);
    if (!/generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com/.test(url)) return realFetch(input, init);
    if ((init?.method ?? 'GET') === 'GET') {
      if (params.get('badkey')) return new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 });
      return new Response(JSON.stringify({ models: MODELS.map((m) => ({ name: 'models/gemini-' + m.id, displayName: m.label, outputTokenLimit: m.maxOutput, supportedGenerationMethods: ['generateContent'] })) }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    const last = JSON.stringify(body.contents ?? body.messages ?? '').slice(-4000);
    if (last.includes('axiom_check')) {
      methodCalls += 1;
      return sseResponse(methodAnswer(methodCalls === 1 && params.get('retry')));
    }
    seoCalls += 1;
    return sseResponse(seoAnswer(seoCalls));
  };
})();
