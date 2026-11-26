// 로그인 정보 보관과 "메일의 링크를 누르면 로그인" 흐름을 가짜 저장소와 가짜 서버로 시험한다.
// 진짜 크롬 저장소 대신 메모리에 담는 가짜를 쓴다. 진짜 서버는 부르지 않는다.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const store: Record<string, unknown> = {};
const asList = (key: string | string[]) => (Array.isArray(key) ? key : [key]);
(globalThis as any).chrome = {
  runtime: { id: 'test' },
  storage: {
    local: {
      get: async (key: string | string[]) => Object.fromEntries(asList(key).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
      set: async (values: Record<string, unknown>) => void Object.assign(store, structuredClone(values)),
      remove: async (key: string | string[]) => {
        for (const k of asList(key)) delete store[k];
      },
    },
  },
};

const { SERVER } = await import('../lib/server/config.ts');
const session = await import('../lib/server/session.ts');

interface Call {
  url: string;
  method: string;
  auth: string | undefined;
  body: any;
}
let calls: Call[] = [];
let responses: Response[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

SERVER.url = 'https://example.supabase.co';
SERVER.key = 'public-key';
SERVER.fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({
    url: String(url),
    method: init?.method ?? 'GET',
    auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
  });
  const next = responses.shift();
  if (!next) throw new Error('가짜 응답이 모자라요: ' + String(url));
  return next;
}) as typeof fetch;

const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'me@example.com' };
const landed = (hash: string) => `https://blog.example.com/login?redirect=%2F#${hash}`;
const GOOD = landed('access_token=link-access&expires_at=1900000000&expires_in=3600&refresh_token=link-refresh&token_type=bearer&type=magiclink');
const refreshed = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, expires_at: 1900003600, user: USER };

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  calls = [];
  responses = [];
});

async function requestMail(email = 'me@example.com'): Promise<void> {
  responses.push(json(200, {}));
  await session.sendLoginEmail(email);
  calls = [];
}

test('링크 로그인: 메일을 요청하면 링크를 기다리는 상태가 된다', async () => {
  assert.equal(await session.loadPendingLogin(), null);
  await requestMail(' me@example.com ');
  const pending = await session.loadPendingLogin();
  assert.equal(pending?.email, 'me@example.com');
  assert.equal(await session.loadLastEmail(), 'me@example.com');
});

test('링크 로그인: 링크를 누른 탭의 주소로 로그인하고, 받은 정보는 바로 새것으로 바꾼다', async () => {
  await requestMail();
  responses.push(json(200, USER), json(200, refreshed));
  assert.equal(await session.completeLoginFromUrl(GOOD), 'ok');

  // 먼저 누구 것인지 묻고, 그다음 새 정보로 바꿔 받는다
  assert.equal(calls[0]?.url, 'https://example.supabase.co/auth/v1/user');
  assert.equal(calls[0]?.auth, 'Bearer link-access');
  assert.equal(calls[1]?.url, 'https://example.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual(calls[1]?.body, { refresh_token: 'link-refresh' });

  const saved = await session.loadSession();
  assert.equal(saved?.access_token, 'new-access');
  assert.equal(saved?.refresh_token, 'new-refresh');
  assert.equal(saved?.user.email, 'me@example.com');
  assert.equal(await session.loadPendingLogin(), null, '기다리는 상태가 끝난다');
  const note = await session.takeLoginNote();
  assert.equal(note?.ok, true);
  assert.equal(await session.takeLoginNote(), null, '쪽지는 한 번만 읽힌다');
});

test('링크 로그인: 새 정보로 바꿔 받지 못해도 받은 정보로 로그인된다', async () => {
  await requestMail();
  responses.push(json(200, USER), json(503, {}));
  assert.equal(await session.completeLoginFromUrl(GOOD), 'ok');
  const saved = await session.loadSession();
  assert.equal(saved?.access_token, 'link-access');
  assert.equal(saved?.refresh_token, 'link-refresh');
  assert.equal(saved?.expires_at, 1900000000);
});

test('링크 로그인: 확장에서 메일을 요청한 적이 없으면 건드리지 않는다 (웹에 로그인하려던 링크)', async () => {
  assert.equal(await session.completeLoginFromUrl(GOOD), 'not-waiting');
  assert.equal(calls.length, 0);
  assert.equal(await session.loadSession(), null);

  // 요청한 지 오래됐으면 기다리는 상태가 아니다
  store.serverPendingLogin = { email: 'me@example.com', requested_at: new Date(Date.now() - 31 * 60_000).toISOString() };
  assert.equal(await session.completeLoginFromUrl(GOOD), 'not-waiting');
  assert.equal(calls.length, 0);
});

test('링크 로그인: 적은 이메일과 다른 계정의 링크면 로그인하지 않는다', async () => {
  await requestMail('me@example.com');
  responses.push(json(200, { id: '22222222-2222-2222-2222-222222222222', email: 'someone-else@example.com' }));
  assert.equal(await session.completeLoginFromUrl(GOOD), 'wrong-account');
  assert.equal(await session.loadSession(), null);
  assert.equal(calls.length, 1, '새 정보로 바꿔 받지도 않는다');
  const note = await session.takeLoginNote();
  assert.equal(note?.ok, false);
  assert.ok(!note?.text.includes('someone-else'), '다른 사람의 이메일을 화면에 내보이지 않는다');
  // 이메일의 대소문자는 가리지 않는다
  responses.push(json(200, { ...USER, email: 'Me@Example.com' }), json(200, refreshed));
  assert.equal(await session.completeLoginFromUrl(GOOD), 'ok');
});

test('링크 로그인: 링크의 시간이 지났거나 쓸 수 없는 정보면 알려 준다', async () => {
  await requestMail();
  const expired = landed('error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  assert.equal(await session.completeLoginFromUrl(expired), 'failed');
  assert.match((await session.takeLoginNote())?.text ?? '', /시간이 지났어요/);
  assert.equal(calls.length, 0);

  assert.equal(await session.completeLoginFromUrl('https://blog.example.com/login'), 'no-tokens');
  assert.equal(await session.takeLoginNote(), null);

  responses.push(json(401, { message: 'invalid JWT' }));
  assert.equal(await session.completeLoginFromUrl(GOOD), 'failed');
  assert.equal(await session.loadSession(), null);
  assert.equal((await session.takeLoginNote())?.ok, false);
  // 실패해도 기다리는 상태는 남는다. 메일을 다시 받지 않고 새 링크를 누를 수 있다
  assert.notEqual(await session.loadPendingLogin(), null);
});

test('링크 로그인: 다른 방법으로 로그인하거나 로그아웃하면 기다리는 상태가 끝난다', async () => {
  await requestMail();
  responses.push(json(200, { ...refreshed }));
  await session.loginWithEmailCode('me@example.com', '123456');
  assert.equal(await session.loadPendingLogin(), null);
  assert.equal((await session.loadSession())?.access_token, 'new-access');

  await requestMail();
  responses.push(new Response(null, { status: 204 }));
  await session.logout();
  assert.equal(await session.loadPendingLogin(), null);
  assert.equal(await session.loadSession(), null);
  assert.equal(await session.loadLastEmail(), 'me@example.com', '이메일은 다음에 다시 적지 않게 남겨 둔다');
});

// ── 가족이 함께 쓰는 네이버 키 ──

const SHARED = { clientId: 'shared-id', clientSecret: 'shared-secret', license: 'shared-license', secret: 'shared-ad-secret', customerId: '7654321' };
const sharedRow = (updated_at = '2026-11-18T12:00:00+00:00', keys: unknown = SHARED) => json(200, [{ keys, updated_at }]);
const signIn = () => {
  store.serverSession = { access_token: 'my-access', refresh_token: 'my-refresh', expires_at: 1900000000, user: USER };
};

test('공용 키: 로그인하지 않았으면 서버에 묻지 않는다', async () => {
  assert.equal(await session.syncSharedKeys(), 'signed-out');
  assert.equal(calls.length, 0);
});

test('공용 키: 서버의 키를 받아 이 컴퓨터에 두고, 서버에서 받았다고 적어 둔다', async () => {
  signIn();
  responses.push(sharedRow());
  assert.equal(await session.syncSharedKeys(), 'updated');
  assert.deepEqual(store.naverKeys, SHARED);
  assert.deepEqual(await session.loadNaverKeySource(), { from: 'server', updated_at: '2026-11-18T12:00:00+00:00' });
  assert.equal(calls[0]!.url, 'https://example.supabase.co/rest/v1/shared_keys?id=eq.naver&select=keys,updated_at');
  assert.equal(calls[0]!.auth, 'Bearer my-access', '내 로그인 정보로 묻는다 (권한은 서버가 가린다)');

  // 다시 물었을 때 같은 것이면 같다고 알려 준다. 서버에서 키를 바꿔 올렸으면 새로 받는다.
  responses.push(sharedRow());
  assert.equal(await session.syncSharedKeys(), 'same');
  responses.push(sharedRow('2026-11-19T00:00:00+00:00', { ...SHARED, clientSecret: 'rotated' }));
  assert.equal(await session.syncSharedKeys(), 'updated');
  assert.equal((store.naverKeys as typeof SHARED).clientSecret, 'rotated');
});

test('공용 키: 직접 넣은 키가 있으면 덮어쓰지 않는다. 일부러 받겠다고 하면 바꾼다', async () => {
  signIn();
  const mine = { clientId: 'my-id', clientSecret: 'my-secret', license: '', secret: '', customerId: '' };
  store.naverKeys = mine;
  store.naverKeysSource = { from: 'local' };
  responses.push(sharedRow());
  assert.equal(await session.syncSharedKeys(), 'kept-local');
  assert.deepEqual(store.naverKeys, mine);

  responses.push(sharedRow());
  assert.equal(await session.syncSharedKeys(true), 'updated');
  assert.deepEqual(store.naverKeys, SHARED);
  assert.equal((await session.loadNaverKeySource())?.from, 'server');
});

test('공용 키: 받을 수 없는 계정이거나 서버에 키가 없으면, 전에 서버에서 받은 키는 지운다', async () => {
  signIn();
  responses.push(sharedRow());
  await session.syncSharedKeys();
  // 서버가 빈 답을 준다: 목록에서 빠졌거나 키를 지웠다
  responses.push(json(200, []));
  assert.equal(await session.syncSharedKeys(), 'none');
  assert.equal(store.naverKeys, undefined);
  assert.equal(await session.loadNaverKeySource(), null);

  // 쓸 수 있는 키가 하나도 없는 줄도 없는 것으로 본다. 직접 넣은 키는 지우지 않는다.
  const mine = { clientId: 'my-id', clientSecret: 'my-secret', license: '', secret: '', customerId: '' };
  store.naverKeys = mine;
  store.naverKeysSource = { from: 'local' };
  responses.push(sharedRow('2026-11-18T12:00:00+00:00', { clientId: 'only-id' }));
  assert.equal(await session.syncSharedKeys(), 'none');
  assert.deepEqual(store.naverKeys, mine);
});

test('공용 키: 로그아웃하면 서버에서 받은 키는 지우고, 직접 넣은 키는 남긴다', async () => {
  signIn();
  responses.push(sharedRow());
  await session.syncSharedKeys();
  responses.push(new Response(null, { status: 204 }));
  await session.logout();
  assert.equal(store.naverKeys, undefined);
  assert.equal(store.naverKeysSource, undefined);

  signIn();
  store.naverKeys = { ...SHARED, clientId: 'typed-here' };
  store.naverKeysSource = { from: 'local' };
  responses.push(new Response(null, { status: 204 }));
  await session.logout();
  assert.equal((store.naverKeys as typeof SHARED).clientId, 'typed-here');
});

test('공용 키: 서버에 표가 아직 없으면 오류로 알려 준다 (부르는 쪽이 넘어간다)', async () => {
  signIn();
  responses.push(json(404, { code: 'PGRST205', message: "Could not find the table 'public.shared_keys'" }));
  await assert.rejects(() => session.syncSharedKeys());
  assert.equal(store.naverKeys, undefined);
});
