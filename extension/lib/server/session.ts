import { browser } from 'wxt/browser';
import { validatePack } from '../prompts/pack.ts';
import { fetchPack, isExpiring, refreshSession, ServerError, signIn, signOut, type Session } from './client.ts';
import { SERVER } from './config.ts';

// 로그인 정보와, 서버에서 받은 프롬프트 묶음을 이 컴퓨터의 확장 저장소에 둔다.
// 저장소는 확장의 화면에서만 읽힌다 (background.ts 에서 막아 둔다).

const SESSION_KEY = 'serverSession';
const PACK_KEY = 'promptPack';
const SOURCE_KEY = 'promptPackSource';

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
  await browser.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

/** 로그아웃한다. 서버에서 받은 프롬프트도 이 컴퓨터에서 지운다. */
export async function logout(): Promise<void> {
  const session = await loadSession();
  if (session) await signOut(SERVER, session);
  await browser.storage.local.remove(SESSION_KEY);
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
