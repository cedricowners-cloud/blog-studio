-- ============================================================
-- Migration 004: RLS 준비를 위한 스키마 변경
-- ============================================================
-- * user_accounts: 유저 ↔ 네이버 계정 소유권
-- * blog_posts / post_series / generation_requests / keyword_lookups
--   에 user_id 추가 (NOT NULL, CASCADE)
-- * keyword_lookups: UNIQUE(keyword) → UNIQUE(user_id, keyword)
-- ============================================================

-- 1. user_accounts 조인 테이블
CREATE TABLE IF NOT EXISTS user_accounts (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, account_name)
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_account ON user_accounts(account_name);
ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

-- 2. user_id 컬럼 추가 (테이블이 비어있어 NOT NULL 즉시 가능)
ALTER TABLE blog_posts
    ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE post_series
    ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE generation_requests
    ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. keyword_lookups 유저별 격리
ALTER TABLE keyword_lookups DROP CONSTRAINT keyword_lookups_keyword_key;
ALTER TABLE keyword_lookups
    ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE keyword_lookups
    ADD CONSTRAINT keyword_lookups_user_keyword_key UNIQUE (user_id, keyword);

-- 4. user_id 인덱스 (RLS 필터 효율화)
CREATE INDEX IF NOT EXISTS idx_blog_posts_user ON blog_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_post_series_user ON post_series(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_requests_user ON generation_requests(user_id);
