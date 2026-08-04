-- ============================================================
-- Migration 013: blog_posts 에 LLM 토큰·비용 컬럼 추가
-- ============================================================
-- 글 생성 시 input/output 토큰과 USD 비용을 저장 → /stats 에서 모델별 집계
-- * cost_usd 는 NUMERIC(10,6) — 0.000001 USD 단위까지
-- * llm_model — 실제 호출에 사용된 모델 이름 (settings 의 사용자 선택과 다를 수 있음)
-- * 기존 행은 NULL (마이그레이션 이후 생성된 글만 채워짐)
-- ============================================================

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS llm_model TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 6);

-- 인덱스 — provider/model 별 집계 쿼리 가속
CREATE INDEX IF NOT EXISTS idx_blog_posts_llm_model ON blog_posts (llm_provider, llm_model);

-- 모델별 누적 사용량 뷰 (stats 페이지가 직접 읽음)
CREATE OR REPLACE VIEW v_llm_usage_by_model AS
SELECT
  user_id,
  llm_provider,
  llm_model,
  COUNT(*) AS post_count,
  COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
  COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
  COALESCE(SUM(cost_usd), 0)::NUMERIC(12, 6) AS total_cost_usd,
  MIN(created_at) AS first_used_at,
  MAX(created_at) AS last_used_at
FROM blog_posts
WHERE llm_provider IS NOT NULL
GROUP BY user_id, llm_provider, llm_model;

-- 뷰는 RLS를 우회하므로 — 호출자 권한으로 SELECT 되도록 설정
ALTER VIEW v_llm_usage_by_model SET (security_invoker = true);
