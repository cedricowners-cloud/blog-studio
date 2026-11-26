// 네이버 API 로 글감을 찾는다: 블로그 글과 뉴스 찾기(검색 API), 키워드의 검색량과 연관 키워드(검색광고 API).
// 웹의 web/lib/naver.ts 와 같은 주소, 같은 서명 방식을 쓴다. 다른 점은 사이드 패널에서 직접 부른다는 것이다.
//   - 키는 사용자가 설정에 넣은 것을 쓴다. 이 컴퓨터에만 둔다. 요청의 헤더에만 싣는다.
//   - 읽기만 한다. 글을 올리거나 고치는 API 는 부르지 않는다.
//   - 받아 온 글자는 꾸밈 표시(<b>)를 떼고 글자로만 쓴다.

const OPENAPI_BASE = 'https://openapi.naver.com';
const SEARCHAD_BASE = 'https://api.searchad.naver.com';

export interface NaverKeys {
  /** 검색 API (developers.naver.com 의 애플리케이션) */
  clientId: string;
  clientSecret: string;
  /** 검색광고 API (searchad.naver.com 의 API 사용 관리) */
  license: string;
  secret: string;
  customerId: string;
}

export const EMPTY_NAVER_KEYS: NaverKeys = { clientId: '', clientSecret: '', license: '', secret: '', customerId: '' };

export const hasSearchKeys = (keys: NaverKeys): boolean => Boolean(keys.clientId.trim() && keys.clientSecret.trim());
export const hasAdKeys = (keys: NaverKeys): boolean => Boolean(keys.license.trim() && keys.secret.trim() && keys.customerId.trim());

export function normalizeNaverKeys(raw: unknown): NaverKeys {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    clientId: text(value.clientId),
    clientSecret: text(value.clientSecret),
    license: text(value.license),
    secret: text(value.secret),
    customerId: text(value.customerId),
  };
}

const ENV_NAMES: Record<string, keyof NaverKeys> = {
  NAVER_CLIENT_ID: 'clientId',
  NAVER_CLIENT_SECRET: 'clientSecret',
  NAVER_SEARCH_ACCESS_LICENSE_KEY: 'license',
  NAVER_SEARCH_SECRET_KEY: 'secret',
  NAVER_SEARCH_CUSTOMER_ID: 'customerId',
};

/**
 * 설정 파일(.env)의 줄을 붙여넣으면 네이버 키를 골라낸다. 한 줄씩 옮겨 적지 않아도 되게 하려는 것이다.
 *   NAVER_CLIENT_ID=abc  →  { clientId: 'abc' }
 * 네이버 키가 아닌 줄은 버린다.
 */
export function parseKeyLines(text: string): Partial<NaverKeys> {
  const out: Partial<NaverKeys> = {};
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const field = ENV_NAMES[match[1] as string];
    const value = (match[2] ?? '').replace(/^(["'])(.*)\1$/, '$2').trim();
    if (field && value) out[field] = value;
  }
  return out;
}

export type NaverErrorKind = 'no-keys' | 'auth' | 'rate' | 'bad-request' | 'network' | 'other';

export class NaverError extends Error {
  kind: NaverErrorKind;
  status: number | null;
  constructor(kind: NaverErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'NaverError';
    this.kind = kind;
    this.status = status;
  }
}

type FetchLike = typeof fetch;

export interface CallOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  /** 시험할 때 시각을 정해 준다 (밀리초) */
  now?: () => number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 네이버가 돌려준 글자에서 꾸밈 표시를 떼고, &quot; 같은 글자를 원래 글자로 바꾼다 */
export function cleanText(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 키가 오류 글에 섞여 나오지 않게 가린다 */
function scrub(text: string, keys: NaverKeys): string {
  let out = text;
  for (const secret of [keys.clientSecret, keys.secret, keys.license, keys.clientId]) {
    if (secret && secret.length >= 6) out = out.split(secret).join('***');
  }
  return out.slice(0, 300);
}

async function failure(what: string, res: Response, keys: NaverKeys): Promise<NaverError> {
  const body = await res.text().catch(() => '');
  let detail = '';
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    detail = String(parsed.errorMessage ?? parsed.message ?? parsed.title ?? '');
  } catch {
    detail = body;
  }
  detail = scrub(detail.replace(/\s+/g, ' ').trim(), keys);
  const tail = detail ? ` (${detail})` : '';
  if (res.status === 401 || res.status === 403) return new NaverError('auth', `${what}: 네이버가 키를 받아 주지 않았어요. 설정의 네이버 키를 확인해 주세요.${tail}`, res.status);
  if (res.status === 429) return new NaverError('rate', `${what}: 오늘 쓸 수 있는 횟수를 넘었거나 너무 빨리 불렀어요. 조금 뒤에 다시 해 주세요.${tail}`, res.status);
  if (res.status === 400) return new NaverError('bad-request', `${what}: 네이버가 요청을 받아 주지 않았어요.${tail}`, res.status);
  return new NaverError('other', `${what}: 네이버가 오류를 돌려줬어요 (${res.status}).${tail}`, res.status);
}

async function call(what: string, url: string, init: RequestInit, keys: NaverKeys, opts: CallOptions): Promise<unknown> {
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url, { ...init, signal: opts.signal });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new NaverError('network', `${what}: 네이버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.`);
  }
  if (!res.ok) throw await failure(what, res, keys);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new NaverError('other', `${what}: 네이버의 답을 읽지 못했어요.`, res.status);
  }
}

// ───────── 검색 API: 블로그 글, 뉴스 ─────────

export type SearchSort = 'sim' | 'date';

export interface SearchOptions extends CallOptions {
  /** 가져올 개수 (1~100) */
  display?: number;
  /** sim 관련도순, date 최신순 */
  sort?: SearchSort;
}

export interface BlogHit {
  title: string;
  link: string;
  description: string;
  blogger: string;
  /** 2026-11-18 모양. 모르면 빈 글 */
  date: string;
}

export interface NewsHit {
  title: string;
  /** 네이버 뉴스 주소가 있으면 그것, 없으면 언론사 주소 */
  link: string;
  description: string;
  /** 언론사 사이트의 주소에서 뽑은 이름 (예: yna.co.kr) */
  source: string;
  date: string;
}

export interface SearchResult<T> {
  /** 네이버가 찾은 전체 수 */
  total: number;
  items: T[];
}

async function search(kind: 'blog' | 'news', keys: NaverKeys, query: string, opts: SearchOptions): Promise<{ total: number; items: Record<string, unknown>[] }> {
  const what = kind === 'blog' ? '블로그 글 찾기' : '뉴스 찾기';
  if (!hasSearchKeys(keys)) throw new NaverError('no-keys', `${what}: 네이버 검색 API 키가 없어요. 설정에서 넣어 주세요.`);
  const params = new URLSearchParams({
    query: query.trim(),
    display: String(Math.max(1, Math.min(100, opts.display ?? 10))),
    sort: opts.sort ?? 'sim',
  });
  const data = (await call(
    what,
    `${OPENAPI_BASE}/v1/search/${kind}.json?${params.toString()}`,
    { headers: { 'X-Naver-Client-Id': keys.clientId.trim(), 'X-Naver-Client-Secret': keys.clientSecret.trim() } },
    keys,
    opts,
  )) as { total?: unknown; items?: unknown };
  return {
    total: Number(data.total) || 0,
    items: Array.isArray(data.items) ? (data.items.filter((item) => typeof item === 'object' && item !== null) as Record<string, unknown>[]) : [],
  };
}

const httpLink = (value: unknown): string => {
  const text = String(value ?? '').trim();
  return /^https?:\/\//i.test(text) ? text : '';
};

function hostOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** "Mon, 18 Nov 2026 10:00:00 +0900" → "2026-11-18" (한국 시각으로) */
export function newsDate(pubDate: unknown): string {
  const time = Date.parse(String(pubDate ?? ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** 키워드로 블로그 글을 찾는다. 관련도순으로 찾으면 네이버 검색의 윗자리에 나오는 글이다 */
export async function searchBlogs(keys: NaverKeys, query: string, opts: SearchOptions = {}): Promise<SearchResult<BlogHit>> {
  const { total, items } = await search('blog', keys, query, opts);
  return {
    total,
    items: items.map((item) => {
      const day = /^(\d{4})(\d{2})(\d{2})$/.exec(String(item.postdate ?? ''));
      return {
        title: cleanText(item.title),
        link: httpLink(item.link),
        description: cleanText(item.description),
        blogger: cleanText(item.bloggername),
        date: day ? `${day[1]}-${day[2]}-${day[3]}` : '',
      };
    }),
  };
}

/** 키워드로 뉴스를 찾는다 */
export async function searchNews(keys: NaverKeys, query: string, opts: SearchOptions = {}): Promise<SearchResult<NewsHit>> {
  const { total, items } = await search('news', keys, query, opts);
  return {
    total,
    items: items.map((item) => {
      const original = httpLink(item.originallink);
      const link = httpLink(item.link) || original;
      return {
        title: cleanText(item.title),
        link,
        description: cleanText(item.description),
        source: hostOf(original || link),
        date: newsDate(item.pubDate),
      };
    }),
  };
}

// ───────── 검색광고 API: 키워드 도구 ─────────

/** 검색광고 API 의 서명. `${시각}.${방식}.${주소}` 를 비밀키로 HMAC-SHA256 한 뒤 base64 로 적는다 */
export async function signSearchAd(secret: string, timestamp: string, method: string, resource: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${method}.${resource}`)));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface KeywordRow {
  keyword: string;
  /** 한 달 검색 수. 10 미만이면 null (네이버가 "< 10" 이라고만 알려 준다) */
  pc: number | null;
  mobile: number | null;
  /** pc + mobile. 10 미만은 0 으로 센다 */
  total: number;
  /** 광고 경쟁 정도: 높음, 중간, 낮음. 블로그 경쟁과는 다르다 */
  competition: string;
}

function count(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text || text.startsWith('<')) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** 키워드 도구는 띄어쓰기가 있는 키워드를 받지 않는다. 빈칸을 떼고, 다섯 개까지만 보낸다 */
export function hintKeywords(keywords: string[]): string[] {
  const out: string[] = [];
  for (const keyword of keywords) {
    const hint = keyword.replace(/[\s,]+/g, '');
    if (hint && !out.includes(hint)) out.push(hint);
  }
  return out.slice(0, 5);
}

/**
 * 키워드의 한 달 검색 수와 연관 키워드를 받아 온다.
 * 돌려주는 차례는 네이버가 준 차례다 (찾은 키워드가 맨 앞, 그 뒤로 관련이 깊은 순서).
 */
export async function keywordTool(keys: NaverKeys, keywords: string[], opts: CallOptions = {}): Promise<KeywordRow[]> {
  const what = '키워드 찾기';
  if (!hasAdKeys(keys)) throw new NaverError('no-keys', `${what}: 네이버 검색광고 API 키가 없어요. 설정에서 넣어 주세요.`);
  const hints = hintKeywords(keywords);
  if (hints.length === 0) return [];
  const timestamp = String((opts.now ?? Date.now)());
  const resource = '/keywordstool';
  const params = new URLSearchParams({ siteId: 'naver', hintKeywords: hints.join(','), showDetail: '1' });
  const data = (await call(
    what,
    `${SEARCHAD_BASE}${resource}?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'X-Timestamp': timestamp,
        'X-API-KEY': keys.license.trim(),
        'X-Customer': keys.customerId.trim(),
        'X-Signature': await signSearchAd(keys.secret.trim(), timestamp, 'GET', resource),
      },
    },
    keys,
    opts,
  )) as { keywordList?: unknown };
  const rows = Array.isArray(data.keywordList) ? (data.keywordList as Record<string, unknown>[]) : [];
  return rows
    .filter((row) => typeof row === 'object' && row !== null && typeof row.relKeyword === 'string' && row.relKeyword)
    .map((row) => {
      const pc = count(row.monthlyPcQcCnt);
      const mobile = count(row.monthlyMobileQcCnt);
      return { keyword: String(row.relKeyword), pc, mobile, total: (pc ?? 0) + (mobile ?? 0), competition: cleanText(row.compIdx) };
    });
}
