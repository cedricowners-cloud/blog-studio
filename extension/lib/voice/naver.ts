// 네이버 블로그의 글 목록과 글 한 편을 읽어 글자만 꺼낸다. 내 블로그의 공개 글만 읽는다.
// 네이버가 공개한 기능이 아니라서 모양이 바뀔 수 있다. 바뀌어 읽지 못하면 null 을 돌려주고, 직접 붙여넣는 방법을 안내한다.
// 2026-11-17 에 공개 블로그로 확인한 모양:
//   목록  /PostTitleListAsync.naver?blogId=…  → { postList: [{ logNo, title(주소 인코딩), addDate }] } (JSON 인데 \' 가 섞여 있다)
//   글    /PostView.naver?blogId=…&logNo=…    → 본문은 .se-main-container 안의 p.se-text-paragraph
// 다른 곳(확장 화면)에서 부르면 네이버가 막는다 (403). 그래서 열려 있는 블로그 탭 안에서 부른다 (entrypoints/naver-reader.ts).

export interface BlogPage {
  blogId: string;
  /** 글쓰기 화면인지. 글쓰기 화면의 아이디는 내 블로그가 틀림없다 */
  isWritePage: boolean;
}

/** 탭의 주소에서 블로그 아이디를 알아낸다. 네이버 블로그 주소가 아니면 null. */
export function blogIdFromUrl(url: string): BlogPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'blog.naver.com') return null;
  const isWritePage = /postwrite|PostWriteForm|PostUpdateForm/i.test(parsed.pathname + parsed.search);
  const fromQuery = parsed.searchParams.get('blogId');
  const first = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  const candidate = fromQuery ?? (first.includes('.') ? '' : first);
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(candidate)) return null;
  return { blogId: candidate, isWritePage };
}

export function listUrl(blogId: string, count: number): string {
  const params = new URLSearchParams({
    blogId,
    viewdate: '',
    currentPage: '1',
    categoryNo: '0',
    parentCategoryNo: '',
    countPerPage: String(count),
  });
  return `https://blog.naver.com/PostTitleListAsync.naver?${params.toString()}`;
}

export function postUrl(blogId: string, logNo: string): string {
  return `https://blog.naver.com/PostView.naver?${new URLSearchParams({ blogId, logNo }).toString()}`;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** &amp; &#39; 같은 표시를 글자로 바꾼다 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

export interface ListedPost {
  logNo: string;
  title: string;
  date: string;
}

/** 글 목록의 답을 읽는다. 목록이 아니면 (없는 블로그, 오류 화면) null. */
export function parsePostList(text: string): ListedPost[] | null {
  let data: unknown;
  try {
    // 네이버의 답에는 JSON 에 없는 \' 가 들어 있다. ' 로 바꾼 뒤 읽는다.
    data = JSON.parse(text.replace(/\\'/g, "'"));
  } catch {
    return null;
  }
  const list = (data as { postList?: unknown } | null)?.postList;
  if (!Array.isArray(list)) return null;
  const posts: ListedPost[] = [];
  for (const row of list as Array<Record<string, unknown>>) {
    const logNo = typeof row?.logNo === 'string' || typeof row?.logNo === 'number' ? String(row.logNo) : '';
    if (!/^\d+$/.test(logNo)) continue;
    let title = typeof row.title === 'string' ? row.title : '';
    try {
      title = decodeURIComponent(title.replace(/\+/g, ' '));
    } catch {
      // 인코딩이 깨져 있으면 받은 그대로 쓴다
    }
    posts.push({ logNo, title: decodeEntities(title).trim(), date: typeof row.addDate === 'string' ? row.addDate.trim() : '' });
  }
  return posts;
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/[​﻿]/g, '');

export interface ReadPost {
  title: string;
  body: string;
}

/** 글 한 편의 화면에서 제목과 본문 글자를 꺼낸다. 본문을 찾지 못하면 null. */
export function extractPost(html: string): ReadPost | null {
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(html);
  const titleTag = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeEntities(og?.[1] ?? titleTag?.[1] ?? '').replace(/\s*:\s*네이버 블로그\s*$/, '').trim();

  const lines: string[] = [];
  const start = html.indexOf('se-main-container');
  if (start >= 0) {
    // 스마트에디터로 쓴 글: 문단마다 p.se-text-paragraph 가 있다.
    const paragraph = /<p[^>]*class="[^"]*se-text-paragraph[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
    const region = html.slice(start);
    for (let m = paragraph.exec(region); m; m = paragraph.exec(region)) {
      const line = stripTags(m[1] ?? '').replace(/[ \t ]+/g, ' ').trim();
      if (line) lines.push(line);
    }
  } else {
    // 예전 에디터로 쓴 글: #postViewArea 안의 글자를 줄 단위로 꺼낸다.
    const old = html.indexOf('id="postViewArea"');
    if (old < 0) return null;
    let region = html.slice(old, old + 300_000);
    const end = region.search(/class="post_footer|id="printPost|class="post-btn|<!--\s*\/\/\s*본문/);
    // 찾은 곳은 태그의 가운데다. 그 태그가 시작하는 < 앞에서 자른다.
    if (end > 0) region = region.slice(0, Math.max(0, region.lastIndexOf('<', end)));
    region = region
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n');
    for (const raw of stripTags(region.slice(region.indexOf('>') + 1)).split('\n')) {
      const line = raw.replace(/[ \t ]+/g, ' ').trim();
      if (line) lines.push(line);
    }
  }

  if (lines.length === 0) return null;
  return { title, body: lines.join('\n') };
}
