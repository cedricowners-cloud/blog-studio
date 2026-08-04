-- ============================================================
-- Migration 012: 사용자별 API 키 저장 (user_api_keys)
-- ============================================================
-- * 각 사용자가 자기 LLM·네이버·이미지 API 키를 입력 → DB 저장
-- * 글 생성 등 호출 시 사용자 키 우선, 없으면 서버 환경변수 fallback
-- * RLS: 본인만 read/write
-- ============================================================

CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  openai_api_key TEXT,
  anthropic_api_key TEXT,
  gemini_api_key TEXT,
  naver_client_id TEXT,
  naver_client_secret TEXT,
  naver_search_access_license_key TEXT,
  naver_search_secret_key TEXT,
  naver_search_customer_id TEXT,
  unsplash_access_key TEXT,
  pixabay_api_key TEXT,
  openai_default_model TEXT,
  anthropic_default_model TEXT,
  gemini_default_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_api_keys_self_all ON user_api_keys
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));

DROP TRIGGER IF EXISTS trigger_user_api_keys_updated_at ON user_api_keys;
CREATE TRIGGER trigger_user_api_keys_updated_at
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
