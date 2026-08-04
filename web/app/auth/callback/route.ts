import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * 매직 링크 이메일에서 복귀할 때 세션 교환 처리.
 *
 * 실패를 삼키면 미들웨어가 세션 없음으로 판단해 /login 으로 되돌리기 때문에
 * 원인을 알 수 없다. 모든 실패 경로를 /login?error= 로 드러낸다.
 */
function fail(url: URL, reason: string) {
  console.error("[auth/callback]", reason);
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(reason)}`, url),
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";

  // 링크 검증 단계에서 실패하면 Supabase가 code 대신 error 파라미터로 돌려보낸다.
  const providerError =
    url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) return fail(url, `Supabase: ${providerError}`);

  if (!code) {
    return fail(
      url,
      "인증 코드가 없습니다. 링크가 이미 사용됐거나 만료됐을 수 있습니다.",
    );
  }

  const store = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) =>
          cookiesToSet.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          ),
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // 대표 사례: code_verifier 쿠키 부재 (링크를 요청한 브라우저와 다른
    // 브라우저에서 열었을 때). 메시지를 그대로 노출해 원인을 식별한다.
    return fail(url, `세션 교환 실패: ${error.message}`);
  }

  return NextResponse.redirect(new URL(next, url));
}
