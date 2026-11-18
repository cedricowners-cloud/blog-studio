// 서버(Supabase)와 주고받는 코드를 가짜 서버로 시험한다. 진짜 서버는 부르지 않는다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchPack,
  fetchUser,
  isExpiring,
  linkErrorFromUrl,
  parseLoginInput,
  refreshSession,
  requestLoginEmail,
  ServerError,
  setPassword,
  signIn,
  signInWithEmailCode,
  signOut,
  tokensFromUrl,
  type ServerConfig,
  type Session,
} from '../lib/server/client.ts';

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

// ───────────── 메일로 로그인, 비밀번호 정하기 ─────────────

test('서버: 로그인 메일을 요청한다 (새 계정은 만들지 않는다)', async () => {
  const { cfg, calls } = fakeServer([json(200, {})]);
  await requestLoginEmail(cfg, ' me@example.com ');
  const call = calls[0] as Call;
  assert.equal(call.url, 'https://example.supabase.co/auth/v1/otp');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.apikey, 'public-key');
  assert.deepEqual(call.body, { email: 'me@example.com', create_user: false });

  const limited = fakeServer([json(429, { error_code: 'over_email_send_rate_limit' })]);
  await assert.rejects(() => requestLoginEmail(limited.cfg, 'me@example.com'), (err: unknown) => err instanceof ServerError && err.kind === 'rate');
  const unknown = fakeServer([json(422, { error_code: 'otp_disabled', msg: 'Signups not allowed for otp' })]);
  await assert.rejects(() => requestLoginEmail(unknown.cfg, 'nobody@example.com'), (err: unknown) => err instanceof ServerError && err.kind === 'credentials');
  const untouched = fakeServer([]);
  await assert.rejects(() => requestLoginEmail(untouched.cfg, '  '), (err: unknown) => err instanceof ServerError && err.kind === 'credentials');
  assert.equal(untouched.calls.length, 0);
});

test('서버: 적은 것이 코드인지 링크 주소인지 알아본다', () => {
  assert.deepEqual(parseLoginInput(' 123456 '), { kind: 'code', token: '123456' });
  assert.deepEqual(parseLoginInput('123 456'), { kind: 'code', token: '123456' });
  assert.deepEqual(parseLoginInput('12345678'), { kind: 'code', token: '12345678' });
  assert.deepEqual(
    parseLoginInput('https://example.supabase.co/auth/v1/verify?token=abc123hash&type=magiclink&redirect_to=https://site.example'),
    { kind: 'link', token_hash: 'abc123hash', type: 'magiclink' },
  );
  assert.deepEqual(parseLoginInput('https://site.example/auth/confirm?token_hash=pkce_zzz&type=email'), { kind: 'link', token_hash: 'pkce_zzz', type: 'email' });
  // 모르는 종류는 메일 로그인으로 본다
  assert.deepEqual(parseLoginInput('https://example.supabase.co/auth/v1/verify?token=h&type=strange'), { kind: 'link', token_hash: 'h', type: 'email' });
  assert.equal(parseLoginInput('12345'), null);
  assert.equal(parseLoginInput('abcdef'), null);
  assert.equal(parseLoginInput('https://site.example/login'), null);
  assert.equal(parseLoginInput(''), null);
});

test('서버: 메일로 받은 6자리 코드로 로그인한다', async () => {
  const { cfg, calls } = fakeServer([json(200, tokenBody())]);
  const got = await signInWithEmailCode(cfg, ' me@example.com ', ' 123456 ', NOW);
  assert.equal(got.access_token, 'access-2');
  assert.equal(got.user.email, 'me@example.com');
  const call = calls[0] as Call;
  assert.equal(call.url, 'https://example.supabase.co/auth/v1/verify');
  assert.ok(!('Authorization' in call.headers));
  assert.deepEqual(call.body, { type: 'email', email: 'me@example.com', token: '123456' });
});

test('서버: 메일의 링크 주소로도 로그인한다', async () => {
  const { cfg, calls } = fakeServer([json(200, tokenBody({ user: { id: session.user.id } }))]);
  const link = 'https://example.supabase.co/auth/v1/verify?token=abc123hash&type=magiclink&redirect_to=https://site.example';
  const got = await signInWithEmailCode(cfg, 'me@example.com', link, NOW);
  assert.deepEqual((calls[0] as Call).body, { type: 'magiclink', token_hash: 'abc123hash' });
  assert.equal(got.user.email, 'me@example.com', '서버가 이메일을 안 주면 적은 이메일을 쓴다');
});

test('서버: 코드나 링크가 틀리면 알맞게 알려 준다', async () => {
  const wrongCode = fakeServer([json(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' })]);
  await assert.rejects(() => signInWithEmailCode(wrongCode.cfg, 'me@example.com', '000000'), /코드가 맞지 않거나/);
  const usedLink = fakeServer([json(403, { error_code: 'otp_expired' })]);
  await assert.rejects(() => signInWithEmailCode(usedLink.cfg, 'me@example.com', 'https://x.supabase.co/auth/v1/verify?token=h&type=magiclink'), /링크는 이미 썼거나/);
  const limited = fakeServer([json(429, {})]);
  await assert.rejects(() => signInWithEmailCode(limited.cfg, 'me@example.com', '123456'), (err: unknown) => err instanceof ServerError && err.kind === 'rate');
  // 알아볼 수 없는 글이나 빈 이메일이면 서버를 부르지 않는다
  const untouched = fakeServer([]);
  await assert.rejects(() => signInWithEmailCode(untouched.cfg, 'me@example.com', '코드 아님'), (err: unknown) => err instanceof ServerError && err.kind === 'credentials');
  await assert.rejects(() => signInWithEmailCode(untouched.cfg, ' ', '123456'), (err: unknown) => err instanceof ServerError && err.kind === 'credentials');
  assert.equal(untouched.calls.length, 0);
});

test('서버: 비밀번호를 새로 정한다 (오류 글에 비밀번호를 넣지 않는다)', async () => {
  const { cfg, calls } = fakeServer([json(200, { id: session.user.id })]);
  await setPassword(cfg, session, 'new-test-password');
  const call = calls[0] as Call;
  assert.equal(call.url, 'https://example.supabase.co/auth/v1/user');
  assert.equal(call.method, 'PUT');
  assert.equal(call.headers.Authorization, 'Bearer access-1');
  assert.deepEqual(call.body, { password: 'new-test-password' });

  const short = fakeServer([]);
  await assert.rejects(() => setPassword(short.cfg, session, '1234567'), /8자 이상/);
  assert.equal(short.calls.length, 0);

  const cases: [number, Record<string, unknown>, RegExp][] = [
    [422, { error_code: 'weak_password' }, /너무 쉬워요/],
    [422, { error_code: 'same_password' }, /같아요/],
    [400, { error_code: 'reauthentication_needed' }, /보안 설정/],
    [401, {}, /로그인이 풀렸어요/],
    [500, {}, /정하지 못했어요/],
  ];
  for (const [status, body, expected] of cases) {
    const failing = fakeServer([json(status, body)]);
    await assert.rejects(
      () => setPassword(failing.cfg, session, 'secret-password-123'),
      (err: unknown) => {
        assert.ok(err instanceof ServerError);
        assert.match(err.message, expected);
        assert.ok(!err.message.includes('secret-password-123'));
        return true;
      },
    );
  }
});

test('서버: 링크를 누른 뒤 도착한 주소에서 로그인 정보를 꺼낸다', () => {
  const hash = 'access_token=aaa.bbb.ccc&expires_at=1900000000&expires_in=3600&refresh_token=rrr&token_type=bearer&type=magiclink';
  assert.deepEqual(tokensFromUrl('https://blog.example.com/#' + hash), { access_token: 'aaa.bbb.ccc', refresh_token: 'rrr', expires_at: 1900000000 });
  // 웹이 로그인 화면으로 넘겨도 # 뒤는 그대로 따라온다
  assert.deepEqual(tokensFromUrl('https://blog.example.com/login?redirect=%2F#' + hash)?.refresh_token, 'rrr');
  assert.equal(tokensFromUrl('https://blog.example.com/#access_token=a&refresh_token=r')?.expires_at, null);
  assert.equal(tokensFromUrl('https://blog.example.com/#access_token=only'), null);
  assert.equal(tokensFromUrl('https://blog.example.com/?access_token=a&refresh_token=r'), null, '# 뒤에 있는 것만 받는다');
  assert.equal(tokensFromUrl('https://blog.example.com/login'), null);
  assert.equal(tokensFromUrl('주소가 아님'), null);

  assert.equal(linkErrorFromUrl('https://blog.example.com/#error=access_denied&error_code=otp_expired&error_description=x'), 'otp_expired');
  assert.equal(linkErrorFromUrl('https://blog.example.com/#error=server_error'), 'server_error');
  assert.equal(linkErrorFromUrl('https://blog.example.com/#' + hash), null);
  assert.equal(linkErrorFromUrl('주소가 아님'), null);
});

test('서버: 로그인 정보가 누구 것인지 묻는다', async () => {
  const { cfg, calls } = fakeServer([json(200, { id: session.user.id, email: 'me@example.com', role: 'authenticated' })]);
  assert.deepEqual(await fetchUser(cfg, 'some-access-token'), { id: session.user.id, email: 'me@example.com' });
  assert.equal((calls[0] as Call).url, 'https://example.supabase.co/auth/v1/user');
  assert.equal((calls[0] as Call).method, 'GET');
  assert.equal((calls[0] as Call).headers.Authorization, 'Bearer some-access-token');

  const bad = fakeServer([json(401, { message: 'invalid JWT' })]);
  await assert.rejects(() => fetchUser(bad.cfg, 'x'), (err: unknown) => err instanceof ServerError && err.kind === 'expired');
  const odd = fakeServer([json(200, { email: 'me@example.com' })]);
  await assert.rejects(() => fetchUser(odd.cfg, 'x'), (err: unknown) => err instanceof ServerError && err.kind === 'other');
});
