/**
 * GET /api/research?q=<키워드>&n=<개수>&with_body=true
 *
 * 키워드로 네이버 블로그 상위 N개 검색 + (옵션) 본문 병렬 스크래핑.
 *
 * Response: { query, items: ResearchItem[] }
 *   ResearchItem: { title, description, link, bloggername, postdate, body }
 *     - title/description: HTML 태그 제거됨
 *     - body: 모바일 페이지에서 추출. 실패 시 null
 */
import { NextRequest, NextResponse } from "next/server";
import { searchBlog } from "@/lib/naver";
import { fetchNaverBlogBodies } from "@/lib/naver-blog-scraper";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export interface ResearchItem {
  title: string;
  description: string;
  link: string;
  bloggername: string;
  postdate: string;
  body: string | null;
}

export interface ResearchResponse {
  query: string;
  items: ResearchItem[];
}

function stripHtmlTags(s: string): string {
  return s
    .replace(/<\/?[bi]>/g, "") // <b>, <i> 강조 태그 제거 (네이버가 매칭 키워드 강조용으로 넣음)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ detail: "q (키워드) 필수" }, { status: 400 });

  const nRaw = parseInt(req.nextUrl.searchParams.get("n") ?? "10", 10);
  const n = Math.max(1, Math.min(30, isNaN(nRaw) ? 10 : nRaw));
  const withBody = req.nextUrl.searchParams.get("with_body") !== "false"; // 기본 true

  let blogResp;
  try {
    blogResp = await searchBlog(q, n, "sim");
  } catch (e) {
    return NextResponse.json({ detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const links = blogResp.items.map((it) => it.link);
  const bodies = withBody ? await fetchNaverBlogBodies(links) : links.map(() => null);

  const items: ResearchItem[] = blogResp.items.map((it, i) => ({
    title: stripHtmlTags(it.title),
    description: stripHtmlTags(it.description),
    link: it.link,
    bloggername: it.bloggername,
    postdate: it.postdate,
    body: bodies[i],
  }));

  const response: ResearchResponse = { query: q, items };
  return NextResponse.json(response);
}
