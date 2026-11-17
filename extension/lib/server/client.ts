// blog_studio 서버(Supabase)와 주고받는 코드: 로그인, 로그인 유지, 프롬프트 묶음 받기.
// 웹과 같은 계정(이메일·비밀번호)으로 로그인한다. 웹의 로그인 정보를 넘겨받지 않고 따로 로그인한다.
//   - 비밀번호는 로그인 요청에만 쓰고 어디에도 저장하지 않는다.
//   - 프롬프트는 서버의 권한 규칙이 지킨다. 허락된 사람이 아니면 빈 답이 온다.
// 여기서는 요청만 다룬다. 저장은 session.ts 에서 한다.

export interface ServerConfig {
  /** 예: https://xxxx.supabase.co */
  url: string;
  /** 공개용 키. 확장에 들어가도 되는 키다 (데이터는 서버의 권한 규칙이 지킨다) */
  key: string;
  fetchImpl?: typeof fetch;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  /** 로그인 정보가 끝나는 때 (1970년부터의 초) */
  expires_at: number;
  user: { id: string; email: string };
}

export type ServerErrorKind = 'config' | 'credentials' | 'expired' | 'rate' | 'network' | 'other';

export class ServerError extends Error {
  kind: ServerErrorKind;
  status: number | null;
  constructor(kind: ServerErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'ServerError';
    this.kind = kind;
    this.status = status;
  }
}

function requireConfig(cfg: ServerConfig): void {
  if (!cfg.url || !cfg.key) {
    throw new ServerError('config', '서버 주소가 설정되지 않았어요. extension 폴더의 .env 파일을 확인하고 다시 빌드해 주세요.');
  }
}

async function call(cfg: ServerConfig, path: string, init: RequestInit & { token?: string }): Promise<Response> {
  requireConfig(cfg);
  const headers: Record<string, string> = { apikey: cfg.key, ...(init.headers as Record<string, string> | undefined) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  try {
    return await (cfg.fetchImpl ?? fetch)(cfg.url + path, { method: init.method, body: init.body, headers });
  } catch {
    throw new ServerError('network', '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = (await res.json()) as unknown;
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toSession(data: Record<string, unknown>, nowMs: number): Session {
  const user = data.user as { id?: unknown; email?: unknown } | undefined;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof user?.id !== 'string') {
    throw new ServerError('other', '서버의 답을 알아보지 못했어요. 잠시 뒤에 다시 해 주세요.');
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: typeof data.expires_at === 'number' ? data.expires_at : Math.floor(nowMs / 1000) + expiresIn,
    user: { id: user.id, email: typeof user.email === 'string' ? user.email : '' },
  };
}

/** 이메일과 비밀번호로 로그인한다. 비밀번호는 이 요청에만 쓴다. */
export async function signIn(cfg: ServerConfig, email: string, password: string, nowMs: number = Date.now()): Promise<Session> {
  if (!email.trim() || !password) throw new ServerError('credentials', '이메일과 비밀번호를 적어 주세요.');
  const res = await call(cfg, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const data = await readJson(res);
  if (res.ok) return toSession(data, nowMs);

  const code = String(data.error_code ?? data.error ?? '');
  if (res.status === 429) throw new ServerError('rate', '로그인을 너무 여러 번 시도했어요. 잠시 뒤에 다시 해 주세요.', 429);
  if (code === 'email_not_confirmed') {
    throw new ServerError('credentials', '이메일 확인이 끝나지 않은 계정이에요. 가입할 때 받은 메일의 링크를 눌러 주세요.', res.status);
  }
  if (res.status === 400 || res.status === 401 || res.status === 422) {
    throw new ServerError(
      'credentials',
      '이메일이나 비밀번호가 맞지 않아요. 메일 링크로만 로그인해 왔다면, 웹에서 비밀번호를 먼저 정해 주세요.',
      res.status,
    );
  }
  throw new ServerError('other', `로그인하지 못했어요 (${res.status}). 잠시 뒤에 다시 해 주세요.`, res.status);
}

/** 로그인 정보가 곧 끝나는지. 끝나기 조금 전에 미리 새로 받는다. */
export function isExpiring(session: Session, nowMs: number = Date.now(), marginSeconds = 120): boolean {
  return session.expires_at - Math.floor(nowMs / 1000) < marginSeconds;
}

/** 로그인 정보를 새로 받는다. 서버가 거절하면 다시 로그인해야 한다. */
export async function refreshSession(cfg: ServerConfig, session: Session, nowMs: number = Date.now()): Promise<Session> {
  const res = await call(cfg, '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const data = await readJson(res);
  if (res.ok) {
    const next = toSession(data, nowMs);
    return { ...next, user: { id: next.user.id, email: next.user.email || session.user.email } };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new ServerError('expired', '로그인이 풀렸어요. 다시 로그인해 주세요.', res.status);
  }
  throw new ServerError('other', `로그인을 이어 가지 못했어요 (${res.status}). 잠시 뒤에 다시 해 주세요.`, res.status);
}

/** 서버에 로그아웃을 알린다. 실패해도 이 컴퓨터의 로그인 정보는 지운다 (부르는 쪽에서). */
export async function signOut(cfg: ServerConfig, session: Session): Promise<void> {
  try {
    await call(cfg, '/auth/v1/logout?scope=local', { method: 'POST', token: session.access_token });
  } catch {
    // 연결이 안 되어도 괜찮다. 이 컴퓨터에서 지우면 로그아웃된 것이다.
  }
}

export interface PackRow {
  format: number;
  pack: unknown;
  updated_at: string;
}

/**
 * ok: 묶음을 받음 · not-allowed: 프롬프트를 받아도 되는 사람 목록에 없음 · not-uploaded: 목록에는 있는데 서버에 묶음이 없음
 */
export type PackFetch = { status: 'ok'; row: PackRow } | { status: 'not-allowed' } | { status: 'not-uploaded' };

async function restRows(cfg: ServerConfig, session: Session, path: string): Promise<unknown[]> {
  const res = await call(cfg, path, { method: 'GET', token: session.access_token, headers: { Accept: 'application/json' } });
  if (res.status === 401) throw new ServerError('expired', '로그인이 풀렸어요. 다시 로그인해 주세요.', 401);
  if (!res.ok) throw new ServerError('other', `서버에서 읽지 못했어요 (${res.status}). 잠시 뒤에 다시 해 주세요.`, res.status);
  const data = (await res.json().catch(() => null)) as unknown;
  return Array.isArray(data) ? data : [];
}

/** 프롬프트 묶음을 받는다. 권한이 없으면 서버가 빈 답을 준다. 그때 왜 비었는지도 알아본다. */
export async function fetchPack(cfg: ServerConfig, session: Session): Promise<PackFetch> {
  const rows = await restRows(cfg, session, '/rest/v1/prompt_packs?id=eq.default&select=format,pack,updated_at');
  const row = rows[0] as Partial<PackRow> | undefined;
  if (row && typeof row.format === 'number' && typeof row.updated_at === 'string' && row.pack !== undefined) {
    return { status: 'ok', row: { format: row.format, pack: row.pack, updated_at: row.updated_at } };
  }
  const access = await restRows(cfg, session, `/rest/v1/prompt_access?user_id=eq.${encodeURIComponent(session.user.id)}&select=user_id`);
  return { status: access.length > 0 ? 'not-uploaded' : 'not-allowed' };
}
