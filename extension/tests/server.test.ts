// 서버(Supabase)와 주고받는 코드를 가짜 서버로 시험한다. 진짜 서버는 부르지 않는다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchPack, isExpiring, refreshSession, ServerError, signIn, signOut, type ServerConfig, type Session } from '../lib/server/client.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeServer(responses: (Response | Error)[]): { cfg: ServerConfig; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    const next = responses.shift();
    if (!next) throw new Error('가짜 응답이 모자라요');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { cfg: { url: 'https://example.supabase.co', key: 'public-key', fetchImpl }, calls };
}

const NOW = 1_800_000_000_000;
const session: Session = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: NOW / 1000 + 3600,
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'me@example.com' },
};
const tokenBody = (over: Record<string, unknown> = {}) => ({
  access_token: 'access-2',
  refresh_token: 'refresh-2',
  expires_in: 3600,
  user: { id: session.user.id, email: 'me@example.com' },
  ...over,
});

test('서버: 로그인 요청의 모양과 받은 로그인 정보', async () => {
  const { cfg, calls } = fakeServer([json(200, tokenBody())]);
  const got = await signIn(cfg, '  me@example.com ', 'test-password', NOW);
  assert.deepEqual(got, {
    access_token: 'access-2',
    refresh_token: 'refresh-2',
    expires_at: NOW / 1000 + 3600,
    user: { id: session.user.id, email: 'me@example.com' },
  });
  const call = calls[0] as Call;
  assert.equal(call.url, 'https://example.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.apikey, 'public-key');
  assert.ok(!('Authorization' in call.headers), '로그인 전에는 사람의 토큰을 싣지 않는다');
  assert.deepEqual(call.body, { email: 'me@example.com', password: 'test-password' });
  // 서버가 끝나는 때를 알려 주면 그 값을 쓴다
  const other = fakeServer([json(200, tokenBody({ expires_at: 1_900_000_000 }))]);
  assert.equal((await signIn(other.cfg, 'me@example.com', 'x', NOW)).expires_at, 1_900_000_000);
});

test('서버: 로그인이 안 될 때 까닭을 알려 주고, 오류 글에 비밀번호를 넣지 않는다', async () => {
  const wrong = fakeServer([json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })]);
  await assert.rejects(
    () => signIn(wrong.cfg, 'me@example.com', 'secret-password-123'),
    (err: unknown) => {
      assert.ok(err instanceof ServerError);
      assert.equal(err.kind, 'credentials');
      assert.ok(!err.message.includes('secret-password-123'));
      return true;
    },
  );
  const unconfirmed = fakeServer([json(400, { error_code: 'email_not_confirmed' })]);
  await assert.rejects(() => signIn(unconfirmed.cfg, 'me@example.com', 'x'), /이메일 확인/);
  const limited = fakeServer([json(429, {})]);
  await assert.rejects(() => signIn(limited.cfg, 'me@example.com', 'x'), (err: unknown) => err instanceof ServerError && err.kind === 'rate');
  const down = fakeServer([new TypeError('Failed to fetch')]);
  await assert.rejects(() => signIn(down.cfg, 'me@example.com', 'x'), (err: unknown) => err instanceof ServerError && err.kind === 'network');
  const broken = fakeServer([json(200, { access_token: 'a' })]);
  await assert.rejects(() => signIn(broken.cfg, 'me@example.com', 'x'), (err: unknown) => err instanceof ServerError && err.kind === 'other');

  // 빈 칸이면 서버를 부르지 않는다
  const untouched = fakeServer([]);
  await assert.rejects(() => signIn(untouched.cfg, '  ', 'x'), (err: unknown) => err instanceof ServerError && err.kind === 'credentials');
  await assert.rejects(() => signIn(untouched.cfg, 'me@example.com', ''), (err: unknown) => err instanceof ServerError && err.kind === 'credentials');
  assert.equal(untouched.calls.length, 0);
  // 서버 주소가 없으면 부르지 않는다
  await assert.rejects(() => signIn({ url: '', key: '' }, 'me@example.com', 'x'), (err: unknown) => err instanceof ServerError && err.kind === 'config');
});

test('서버: 로그인 정보가 곧 끝나면 새로 받는다', async () => {
  assert.equal(isExpiring(session, NOW), false);
  assert.equal(isExpiring({ ...session, expires_at: NOW / 1000 + 60 }, NOW), true);
  assert.equal(isExpiring({ ...session, expires_at: NOW / 1000 - 10 }, NOW), true);

  const { cfg, calls } = fakeServer([json(200, tokenBody({ user: { id: session.user.id } }))]);
  const next = await refreshSession(cfg, session, NOW);
  assert.equal(next.access_token, 'access-2');
  assert.equal(next.refresh_token, 'refresh-2');
  assert.equal(next.user.email, 'me@example.com', '서버가 이메일을 안 주면 알던 이메일을 쓴다');
  assert.equal((calls[0] as Call).url, 'https://example.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual((calls[0] as Call).body, { refresh_token: 'refresh-1' });

  const revoked = fakeServer([json(400, { error_code: 'refresh_token_not_found' })]);
  await assert.rejects(() => refreshSession(revoked.cfg, session), (err: unknown) => err instanceof ServerError && err.kind === 'expired');
  const busy = fakeServer([json(503, {})]);
  await assert.rejects(() => refreshSession(busy.cfg, session), (err: unknown) => err instanceof ServerError && err.kind === 'other');
});

test('서버: 로그아웃은 연결이 안 되어도 오류를 내지 않는다', async () => {
  // 로그아웃의 답에는 내용이 없다 (204)
  const { cfg, calls } = fakeServer([new Response(null, { status: 204 })]);
  await signOut(cfg, session);
  assert.equal((calls[0] as Call).headers.Authorization, 'Bearer access-1');
  assert.ok((calls[0] as Call).url.startsWith('https://example.supabase.co/auth/v1/logout'));
  const down = fakeServer([new TypeError('Failed to fetch')]);
  await signOut(down.cfg, session);
});

test('서버: 프롬프트 묶음을 받는다 (내 토큰을 실어서)', async () => {
  const row = { format: 2, pack: { format: 2 }, updated_at: '2026-11-17T10:00:00+00:00' };
  const { cfg, calls } = fakeServer([json(200, [row])]);
  assert.deepEqual(await fetchPack(cfg, session), { status: 'ok', row });
  const call = calls[0] as Call;
  assert.equal(call.url, 'https://example.supabase.co/rest/v1/prompt_packs?id=eq.default&select=format,pack,updated_at');
  assert.equal(call.headers.apikey, 'public-key');
  assert.equal(call.headers.Authorization, 'Bearer access-1');
  assert.equal(calls.length, 1);
});

test('서버: 묶음이 안 보이면 왜 그런지 알아본다', async () => {
  // 받을 수 있는 사람 목록에 없으면 서버는 빈 답을 준다
  const stranger = fakeServer([json(200, []), json(200, [])]);
  assert.deepEqual(await fetchPack(stranger.cfg, session), { status: 'not-allowed' });
  assert.equal(
    (stranger.calls[1] as Call).url,
    `https://example.supabase.co/rest/v1/prompt_access?user_id=eq.${session.user.id}&select=user_id`,
  );
  // 목록에는 있는데 서버에 묶음이 없다
  const empty = fakeServer([json(200, []), json(200, [{ user_id: session.user.id }])]);
  assert.deepEqual(await fetchPack(empty.cfg, session), { status: 'not-uploaded' });
  // 모양이 다른 줄은 묶음으로 치지 않는다
  const odd = fakeServer([json(200, [{ format: '2', pack: {} }]), json(200, [{ user_id: session.user.id }])]);
  assert.deepEqual(await fetchPack(odd.cfg, session), { status: 'not-uploaded' });

  const expired = fakeServer([json(401, { message: 'JWT expired' })]);
  await assert.rejects(() => fetchPack(expired.cfg, session), (err: unknown) => err instanceof ServerError && err.kind === 'expired');
  const failing = fakeServer([json(500, {})]);
  await assert.rejects(() => fetchPack(failing.cfg, session), (err: unknown) => err instanceof ServerError && err.kind === 'other');
});
