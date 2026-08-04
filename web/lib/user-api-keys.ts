/**
 * 사용자별 API 키 관리.
 *
 * - DB 테이블 user_api_keys 에서 사용자 키 read/write
 * - 글 생성 등 호출 시 사용자 키 우선, 없으면 process.env fallback
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserApiKeys {
  user_id: string;
  openai_api_key: string | null;
  anthropic_api_key: string | null;
  gemini_api_key: string | null;
  naver_client_id: string | null;
  naver_client_secret: string | null;
  naver_search_access_license_key: string | null;
  naver_search_secret_key: string | null;
  naver_search_customer_id: string | null;
  unsplash_access_key: string | null;
  pixabay_api_key: string | null;
  openai_default_model: string | null;
  anthropic_default_model: string | null;
  gemini_default_model: string | null;
  created_at?: string;
  updated_at?: string;
}

export type UserApiKeysPatch = Partial<Omit<UserApiKeys, "user_id" | "created_at" | "updated_at">>;

/**
 * 인증된 사용자의 API 키 row 조회 (없으면 null).
 */
export async function loadUserApiKeys(client: SupabaseClient, userId: string): Promise<UserApiKeys | null> {
  const { data, error } = await client
    .from("user_api_keys")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("loadUserApiKeys 실패:", error.message);
    return null;
  }
  return (data as UserApiKeys | null) ?? null;
}

/**
 * 사용자 키 저장 (upsert).
 */
export async function saveUserApiKeys(
  client: SupabaseClient,
  userId: string,
  patch: UserApiKeysPatch,
): Promise<void> {
  // null/empty string 정리 — 빈 문자열은 null로 저장
  const cleaned: Record<string, string | null> = { user_id: userId };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    cleaned[k] = typeof v === "string" && v.trim() === "" ? null : v ?? null;
  }
  const { error } = await client.from("user_api_keys").upsert(cleaned, { onConflict: "user_id" });
  if (error) throw new Error(`API 키 저장 실패: ${error.message}`);
}

/**
 * 글 생성 등에서 사용 — 사용자 키 우선, 없으면 환경변수 fallback.
 */
export interface ResolvedKeys {
  openai_api_key: string | undefined;
  anthropic_api_key: string | undefined;
  gemini_api_key: string | undefined;
  naver_client_id: string | undefined;
  naver_client_secret: string | undefined;
  naver_search_access_license_key: string | undefined;
  naver_search_secret_key: string | undefined;
  naver_search_customer_id: string | undefined;
  unsplash_access_key: string | undefined;
  pixabay_api_key: string | undefined;
  openai_default_model: string | undefined;
  anthropic_default_model: string | undefined;
  gemini_default_model: string | undefined;
}

export function resolveKeys(userKeys: UserApiKeys | null): ResolvedKeys {
  const pick = (userVal: string | null | undefined, envVal: string | undefined) => {
    const u = (userVal ?? "").trim();
    if (u) return u;
    const e = (envVal ?? "").trim();
    return e || undefined;
  };
  return {
    openai_api_key: pick(userKeys?.openai_api_key, process.env.OPENAI_API_KEY),
    anthropic_api_key: pick(userKeys?.anthropic_api_key, process.env.ANTHROPIC_API_KEY),
    gemini_api_key: pick(userKeys?.gemini_api_key, process.env.GEMINI_API_KEY),
    naver_client_id: pick(userKeys?.naver_client_id, process.env.NAVER_CLIENT_ID),
    naver_client_secret: pick(userKeys?.naver_client_secret, process.env.NAVER_CLIENT_SECRET),
    naver_search_access_license_key: pick(
      userKeys?.naver_search_access_license_key,
      process.env.NAVER_SEARCH_ACCESS_LICENSE_KEY,
    ),
    naver_search_secret_key: pick(userKeys?.naver_search_secret_key, process.env.NAVER_SEARCH_SECRET_KEY),
    naver_search_customer_id: pick(userKeys?.naver_search_customer_id, process.env.NAVER_SEARCH_CUSTOMER_ID),
    unsplash_access_key: pick(userKeys?.unsplash_access_key, process.env.UNSPLASH_ACCESS_KEY),
    pixabay_api_key: pick(userKeys?.pixabay_api_key, process.env.PIXABAY_API_KEY),
    openai_default_model: pick(userKeys?.openai_default_model, process.env.OPENAI_DEFAULT_MODEL),
    anthropic_default_model: pick(userKeys?.anthropic_default_model, process.env.ANTHROPIC_DEFAULT_MODEL),
    gemini_default_model: pick(userKeys?.gemini_default_model, process.env.GEMINI_DEFAULT_MODEL),
  };
}
