/**
 * POST /api/images/search
 * Body: { keyword: string, count?: number (default 3, max 10) }
 *
 * Unsplash + Pixabay 이미지 검색 결과 병합.
 */
import { NextRequest, NextResponse } from "next/server";
import { searchImages } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { keyword?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  const keyword = body.keyword?.trim();
  if (!keyword) {
    return NextResponse.json({ detail: "keyword는 필수" }, { status: 400 });
  }
  const count = Math.max(1, Math.min(10, Math.trunc(body.count ?? 3)));

  try {
    const images = await searchImages(keyword, count);
    return NextResponse.json({ images });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: msg }, { status: 502 });
  }
}
