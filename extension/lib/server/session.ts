import { browser } from 'wxt/browser';
import { validatePack } from '../prompts/pack.ts';
import {
  fetchPack,
  fetchUser,
  isExpiring,
  linkErrorFromUrl,
  refreshSession,
  requestLoginEmail,
  ServerError,
  setPassword,
  signIn,
  signInWithEmailCode,
  signOut,
  tokensFromUrl,
  type Session,
} from './client.ts';
import { SERVER } from './config.ts';

// 로그인 정보와, 서버에서 받은 프롬프트 묶음을 이 컴퓨터의 확장 저장소에 둔다.
// 저장소는 확장의 화면에서만 읽힌다 (background.ts 에서 막아 둔다).

const SESSION_KEY = 'serverSession';
const PACK_KEY = 'promptPack';
const SOURCE_KEY = 'promptPackSource';
const EMAIL_KEY = 'serverLastEmail';
const PENDING_KEY = 'serverPendingLogin';
const NOTE_KEY = 'serverLoginNote';

/** 로그인 메일을 보낸 뒤 이 시간 안에 링크를 눌러야 확장에 로그인된다 */
const PENDING_MINUTES = 30;

/** 로그인 메일을 보내고 링크를 기다리는 중인 상태 */
export interface PendingLogin {
  email: string;
  requested_at: string;
}

/** 링크로 로그인한 결과를 화면에 알려 주는 쪽지 */
export interface LoginNote {
  ok: boolean;
  text: string;
  at: string;
}

export async function loadPendingLogin(): Promise<PendingLogin | null> {
  const got = await browser.storage.local.get(PENDING_KEY);
  const pending = got[PENDING_KEY] as PendingLogin | undefined;
  if (!pending || typeof pending.email !== 'string') return null;
  const age = Date.now() - new Date(pending.requested_at).getTime();
  return age >= 0 && age < PENDING_MINUTES * 60_000 ? pending : null;
}

export async function takeLoginNote(): Promise<LoginNote | null> {
  const got = await browser.storage.local.get(NOTE_KEY);
  const note = got[NOTE_KEY] as LoginNote | undefined;
  if (note) await browser.storage.local.remove(NOTE_KEY);
  return note ?? null;
}

const leaveNote = (ok: boolean, text: string) =>
  browser.storage.local.set({ [NOTE_KEY]: { ok, text, at: new Date().toISOString() } satisfies LoginNote });

/** 지금 쓰는 묶음이 어디서 왔는지 */
export interface PackSource {
  from: 'server' | 'file';
  /** 서버에 올린 때 (서버에서 받은 묶음만) */
  updated_at?: string;
  fetched_at: string;
}

export async function loadSession(): Promise<Session | null> {
  const got = await browser.storage.local.get(SESSION_KEY);
  const value = got[SESSION_KEY] as Session | undefined;
  return value && typeof value.access_token === 'string' && typeof value.refresh_token === 'string' ? value : null;
}

export async function loadPackSource(): Promise<PackSource | null> {
  const got = await browser.storage.local.get(SOURCE_KEY);
  return (got[SOURCE_KEY] as PackSource | undefined) ?? null;
}

export const markPackFromFile = () =>
  browser.storage.local.set({ [SOURCE_KEY]: { from: 'file', fetched_at: new Date().toISOString() } satisfies PackSource });

export const clearPackSource = () => browser.storage.local.remove(SOURCE_KEY);

/** 서버에서 받은 묶음이면 지운다. 파일로 불러온 묶음은 그대로 둔다. */
async function dropServerPack(): Promise<void> {
  const source = await loadPackSource();
  if (source?.from === 'server') await browser.storage.local.remove([PACK_KEY, SOURCE_KEY]);
}

export async function login(email: string, password: string): Promise<Session> {
  const session = await signIn(SERVER, email, password);
  await browser.storage.local.set({ [SESSION_KEY]: session, [EMAIL_KEY]: session.user.email || email.trim() });
  await browser.storage.local.remove(PENDING_KEY);
  return session;
}

/** 지난번에 로그인한 이메일. 다시 적지 않게 기억해 둔다 (이 컴퓨터에만). */
export async function loadLastEmail(): Promise<string> {
  const got = await browser.storage.local.get(EMAIL_KEY);
  return typeof got[EMAIL_KEY] === 'string' ? (got[EMAIL_KEY] as string) : '';
}

/** 로그인 메일을 보내 달라고 한다. */
export async function sendLoginEmail(email: string): Promise<void> {
  await requestLoginEmail(SERVER, email);
  await browser.storage.local.set({
    [EMAIL_KEY]: email.trim(),
    [PENDING_KEY]: { email: email.trim(), requested_at: new Date().toISOString() } satisfies PendingLogin,
  });
}

/**
 * ok: 로그인됨 · not-waiting: 확장에서 메일을 요청한 적이 없음 (웹에 로그인하려던 링크는 건드리지 않는다)
 * no-tokens: 주소에 로그인 정보가 없음 · wrong-account: 적은 이메일과 다른 계정의 링크 · failed: 그 밖의 실패
 */
export type LinkLogin = 'ok' | 'not-waiting' | 'no-tokens' | 'wrong-account' | 'failed';

/**
 * 메일의 로그인 링크를 누른 뒤 도착한 탭의 주소로 로그인을 끝낸다. 배경 코드(background.ts)가 부른다.
 * 확장에서 로그인 메일을 요청하고 기다리는 중일 때만 한다.
 */
export async function completeLoginFromUrl(url: string): Promise<LinkLogin> {
  const pending = await loadPendingLogin();
  if (!pending) return 'not-waiting';

  const tokens = tokensFromUrl(url);
  if (!tokens) {
    const problem = linkErrorFromUrl(url);
    if (!problem) return 'no-tokens';
    await leaveNote(false, problem === 'otp_expired'
      ? '메일의 링크가 이미 쓰였거나 시간이 지났어요. 메일을 다시 받아서 새 링크를 눌러 주세요.'
      : `메일의 링크로 로그인하지 못했어요 (${problem}). 메일을 다시 받아 주세요.`);
    return 'failed';
  }

  try {
    const user = await fetchUser(SERVER, tokens.access_token);
    // 다른 사람이 만든 링크로 엉뚱한 계정에 로그인되지 않게, 적어 둔 이메일의 계정인지 확인한다.
    if (!user.email || user.email.toLowerCase() !== pending.email.toLowerCase()) {
      await leaveNote(false, '누른 링크가 아까 적은 이메일의 계정이 아니었어요. 메일을 다시 받아 주세요.');
      return 'wrong-account';
    }
    let session: Session = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      user,
    };
    // 탭의 주소에 남은 로그인 정보가 다시 쓰이지 않게, 바로 새 정보로 바꿔 받는다.
    try {
      session = await refreshSession(SERVER, session);
    } catch {
      // 바꿔 받지 못해도 받은 정보로 로그인은 된다.
    }
    await browser.storage.local.set({ [SESSION_KEY]: session, [EMAIL_KEY]: user.email });
    await browser.storage.local.remove(PENDING_KEY);
    await leaveNote(true, '메일의 링크로 로그인했어요.');
    return 'ok';
  } catch (err) {
    await leaveNote(false, '메일의 링크로 로그인하지 못했어요. ' + (err instanceof Error ? err.message : String(err)));
    return 'failed';
  }
}

/** 메일로 받은 코드나 링크 주소로 로그인한다. */
export async function loginWithEmailCode(email: string, input: string): Promise<Session> {
  const session = await signInWithEmailCode(SERVER, email, input);
  await browser.storage.local.set({ [SESSION_KEY]: session, [EMAIL_KEY]: session.user.email || email.trim() });
  await browser.storage.local.remove(PENDING_KEY);
  return session;
}

/** 로그인한 계정의 비밀번호를 새로 정한다. 비밀번호는 저장하지 않는다. */
export async function changePassword(password: string): Promise<void> {
  const session = await freshSession();
  if (!session) throw new ServerError('expired', '로그인이 풀렸어요. 다시 로그인한 뒤에 해 주세요.');
  await setPassword(SERVER, session, password);
}

/** 로그아웃한다. 서버에서 받은 프롬프트도 이 컴퓨터에서 지운다. */
export async function logout(): Promise<void> {
  const session = await loadSession();
  if (session) await signOut(SERVER, session);
  await browser.storage.local.remove([SESSION_KEY, PENDING_KEY]);
  await dropServerPack();
}

/** 쓸 수 있는 로그인 정보를 돌려준다. 곧 끝나면 새로 받는다. 로그인이 풀렸으면 지우고 null. */
export async function freshSession(): Promise<Session | null> {
  const session = await loadSession();
  if (!session) return null;
  if (!isExpiring(session)) return session;
  try {
    const next = await refreshSession(SERVER, session);
    await browser.storage.local.set({ [SESSION_KEY]: next });
    return next;
  } catch (err) {
    if (err instanceof ServerError && err.kind === 'expired') {
      await browser.storage.local.remove(SESSION_KEY);
      await dropServerPack();
      return null;
    }
    throw err;
  }
}

/**
 * updated: 새 묶음을 받음 · same: 이미 최신 · signed-out: 로그인하지 않음
 * not-allowed: 받을 수 있는 사람이 아님 · not-uploaded: 서버에 묶음이 없음 · outdated: 서버의 묶음이 이 확장과 맞지 않음
 */
export type SyncStatus = 'updated' | 'same' | 'signed-out' | 'not-allowed' | 'not-uploaded' | 'outdated';

export interface SyncResult {
  status: SyncStatus;
  detail: string;
}

/** 서버에서 프롬프트 묶음을 받아 온다. 서버 것이 달라졌을 때만 바꾼다. */
export async function syncPack(): Promise<SyncResult> {
  const session = await freshSession();
  if (!session) return { status: 'signed-out', detail: '' };

  const fetched = await fetchPack(SERVER, session);
  if (fetched.status === 'not-allowed') {
    await dropServerPack();
    return { status: 'not-allowed', detail: '' };
  }
  if (fetched.status === 'not-uploaded') return { status: 'not-uploaded', detail: '' };

  const check = validatePack(fetched.row.pack);
  if (!check.ok) return { status: 'outdated', detail: check.errors.join(' / ') };

  const source = await loadPackSource();
  const same = source?.from === 'server' && source.updated_at === fetched.row.updated_at;
  await browser.storage.local.set({
    [PACK_KEY]: check.pack,
    [SOURCE_KEY]: { from: 'server', updated_at: fetched.row.updated_at, fetched_at: new Date().toISOString() } satisfies PackSource,
  });
  return { status: same ? 'same' : 'updated', detail: fetched.row.updated_at };
}
