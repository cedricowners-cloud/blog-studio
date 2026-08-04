/**
 * POST /api/preview-prompt
 * Body: { input: BlogGenerationInput, domain_code?: string|null }
 *
 * LLM 호출 없이 buildFullPrompt 결과만 반환.
 * 사용자가 ChatGPT/Claude 웹 UI에 직접 붙여넣을 수 있도록 "프롬프트 복사" 용도.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildFullPrompt, type BlogGenerationInput } from "@/lib/ontology/prompt-builder";
import { getServerSupabase } from "@/lib/supabase-server";
import { injectAnnouncementBody } from "@/lib/announcement-scraper";
import { loadDomainPack, DomainNotFoundError } from "@/lib/ontology/domain-loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PreviewPromptBody {
  input: BlogGenerationInput;
  domain_code?: string | null;
}

export async function POST(req: NextRequest) {
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ detail: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: PreviewPromptBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "잘못된 JSON 본문" }, { status: 400 });
  }

  const inp = body.input;
  if (!inp || typeof inp !== "object") {
    return NextResponse.json({ detail: "input은 필수" }, { status: 400 });
  }

  const errors: string[] = [];
  if (typeof inp.method_id !== "number" || inp.method_id < 1 || inp.method_id > 6)
    errors.push("method_id (1-6) 필요");
  if (!inp.topic?.trim()) errors.push("topic 필요");
  if (!inp.main_keyword?.trim()) errors.push("main_keyword 필요");
  if (!Array.isArray(inp.sub_keywords) || inp.sub_keywords.length === 0)
    errors.push("sub_keywords (배열, 최소 1개) 필요");
  if (errors.length > 0) {
    return NextResponse.json({ detail: errors.join(", ") }, { status: 400 });
  }

  if (inp.domain_info) {
    const enriched = await injectAnnouncementBody(inp.domain_info);
    inp.domain_info = enriched ?? inp.domain_info;
  }

  if (body.domain_code) {
    try {
      const pack = await loadDomainPack(supabase, body.domain_code);
      inp.domain_pack = pack;
    } catch (e) {
      if (e instanceof DomainNotFoundError) {
        return NextResponse.json({ detail: e.message }, { status: 400 });
      }
      throw e;
    }
  }

  try {
    const prompt = await buildFullPrompt(inp);
    return NextResponse.json({ prompt, length: prompt.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ detail: `프롬프트 빌드 실패: ${msg}` }, { status: 500 });
  }
}
