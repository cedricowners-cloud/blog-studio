/**
 * POST /api/images/generate
 * Body: { prompt: string, provider?: "pollinations" | "dalle" | "gemini" (default "pollinations") }
 *
 * 응답에는 path가 항상 null 입니다 (서버리스 환경에서 디스크 저장 안 함).
 * URL을 그대로 사용해 <img src=...> 로 렌더링하거나, 클라이언트에서 fetch 후 Storage 업로드.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateImage, type ImageProvider } from "@/lib/images";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOWED: ImageProvider[] = ["pollinations", "dalle", "gemini"];

export async function POST(req: NextRequest) {
  let body: { prompt?: string; provider?: ImageProvider };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ detail: "prompt는 필수" }, { status: 400 });
  }
  const provider = body.provider ?? "pollinations";
  if (!ALLOWED.includes(provider)) {
    return NextResponse.json({ detail: `provider는 ${ALLOWED.join("|")} 중 하나여야 합니다.` }, { status: 400 });
  }

  try {
    const result = await generateImage(prompt, provider);
    if (!result) {
      return NextResponse.json({ detail: "이미지 생성 실패" }, { status: 502 });
    }
    return NextResponse.json({
      path: null,
      url: result.url,
      provider: result.provider,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: msg }, { status: 502 });
  }
}
