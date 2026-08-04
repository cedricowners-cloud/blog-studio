/**
 * POST /api/cards/build
 * Body: {
 *   title: string,
 *   body: string,
 *   keywords?: string[],
 *   card_count?: number | "auto" (default "auto"),
 *   use_ai?: boolean (default true),
 *   provider?: "gemini" | "openai" | "anthropic" (default "gemini"),
 *   model?: string
 * }
 *
 * 본문 markup 파싱 → 카드 배열 + (옵션) AI로 lead/body_text 자연스럽게 다시 씀.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildCards } from "@/lib/cards-parser";
import type { LLMProvider } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOWED_PROVIDERS: LLMProvider[] = ["gemini", "openai", "anthropic"];

export async function POST(req: NextRequest) {
  let body: {
    title?: string;
    body?: string;
    keywords?: string[];
    card_count?: number | "auto";
    use_ai?: boolean;
    provider?: LLMProvider;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  const title = body.title?.trim();
  const blogBody = body.body?.trim();
  if (!title || !blogBody) {
    return NextResponse.json({ detail: "title, body는 필수" }, { status: 400 });
  }

  const useAi = body.use_ai !== false;
  const provider = body.provider ?? "gemini";
  if (useAi && !ALLOWED_PROVIDERS.includes(provider)) {
    return NextResponse.json({ detail: `provider는 ${ALLOWED_PROVIDERS.join("|")} 중 하나여야 합니다.` }, { status: 400 });
  }

  try {
    const cards = await buildCards({
      title,
      body: blogBody,
      keywords: body.keywords ?? [],
      cardCount: body.card_count ?? "auto",
      ai: useAi ? { provider, model: body.model } : undefined,
    });
    return NextResponse.json({ cards, used_ai: useAi });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: `카드 생성 실패: ${msg}` }, { status: 500 });
  }
}
