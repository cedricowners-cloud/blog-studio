-- ============================================================
-- Migration 001: blog_ontology_v2 코어 스키마
-- ============================================================
-- 출처: blog_auto/blog_ontology_v2/schemas/db_schema.sql
-- Supabase 대시보드 SQL Editor에 붙여넣거나 supabase db push로 적용
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. blog_posts: 생성된 글 메타 로그
-- ============================================================
CREATE TABLE IF NOT EXISTS blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 입력 정보
    method_id INT NOT NULL CHECK (method_id BETWEEN 1 AND 6),
    topic TEXT NOT NULL,
    main_keyword TEXT NOT NULL,
    sub_keywords TEXT[] NOT NULL DEFAULT '{}',
    target_awareness_level TEXT CHECK (target_awareness_level IN ('L1', 'L2', 'L3', 'L4')),
    persona TEXT,

    -- 생성 결과
    title TEXT,
    body TEXT,
    body_char_count INT,
    content_type TEXT,

    -- 공리 검증
    axiom_total INT,
    axiom_passed INT,
    axiom_failed INT,
    axiom_pass_rate TEXT,
    axiom_failed_list JSONB,

    -- 생성 메타
    final_attempt INT,
    needs_human_review BOOLEAN DEFAULT FALSE,
    llm_provider TEXT,
    generation_duration_ms INT,

    meta JSONB,

    -- 발행 정보
    published_at TIMESTAMPTZ,
    naver_post_id TEXT,
    naver_post_url TEXT,

    -- 성과 추적
    view_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    last_performance_check TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_method ON blog_posts(method_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_main_keyword ON blog_posts(main_keyword);
CREATE INDEX IF NOT EXISTS idx_blog_posts_awareness ON blog_posts(target_awareness_level);
CREATE INDEX IF NOT EXISTS idx_blog_posts_created ON blog_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_review ON blog_posts(needs_human_review) WHERE needs_human_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published_at DESC) WHERE published_at IS NOT NULL;

-- ============================================================
-- 2. axiom_stats: 공리별 실패 통계
-- ============================================================
CREATE TABLE IF NOT EXISTS axiom_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
    method_id INT NOT NULL,
    axiom_number INT NOT NULL,
    axiom_rule TEXT NOT NULL,
    passed BOOLEAN NOT NULL,
    evidence TEXT,
    attempt_number INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_axiom_stats_post ON axiom_stats(post_id);
CREATE INDEX IF NOT EXISTS idx_axiom_stats_method_axiom ON axiom_stats(method_id, axiom_number);
CREATE INDEX IF NOT EXISTS idx_axiom_stats_failed ON axiom_stats(method_id, axiom_number, passed) WHERE passed = FALSE;

-- ============================================================
-- 3. domain_programs: 정부지원사업 온톨로지 DB (Phase 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS domain_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    사업명 TEXT NOT NULL,
    주관기관 TEXT,
    근거법령 TEXT,
    사업유형 TEXT,
    지원유형 TEXT,
    지원규모 JSONB,
    자격요건 JSONB,
    제외요건 JSONB,
    접수방식 TEXT,
    공고주기 TEXT,
    확인필요항목 TEXT[],
    source_url TEXT,
    source_announcement_id TEXT,
    valid_from DATE,
    valid_until DATE,
    is_active BOOLEAN DEFAULT TRUE,
    last_verified DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_programs_name ON domain_programs(사업명);
CREATE INDEX IF NOT EXISTS idx_domain_programs_agency ON domain_programs(주관기관);
CREATE INDEX IF NOT EXISTS idx_domain_programs_active ON domain_programs(is_active, valid_until) WHERE is_active = TRUE;

-- ============================================================
-- 4. post_series: L1~L4 시리즈 관계 (Phase 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS post_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_name TEXT NOT NULL,
    main_keyword TEXT NOT NULL,
    l1_post_id UUID REFERENCES blog_posts(id),
    l2_post_id UUID REFERENCES blog_posts(id),
    l3_post_id UUID REFERENCES blog_posts(id),
    l4_post_id UUID REFERENCES blog_posts(id),
    planned_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_series_keyword ON post_series(main_keyword);

-- ============================================================
-- 5. generation_requests: 요청 로그
-- ============================================================
CREATE TABLE IF NOT EXISTS generation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
    input_payload JSONB NOT NULL,
    full_prompt TEXT,
    raw_response TEXT,
    parsed_response JSONB,
    error_message TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_requests_post ON generation_requests(post_id);
CREATE INDEX IF NOT EXISTS idx_generation_requests_error ON generation_requests(error_code) WHERE error_code IS NOT NULL;

-- ============================================================
-- 트리거: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_blog_posts_updated_at ON blog_posts;
CREATE TRIGGER trigger_blog_posts_updated_at
    BEFORE UPDATE ON blog_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_domain_programs_updated_at ON domain_programs;
CREATE TRIGGER trigger_domain_programs_updated_at
    BEFORE UPDATE ON domain_programs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 분석 뷰
-- ============================================================
CREATE OR REPLACE VIEW v_method_axiom_failures AS
SELECT
    method_id,
    axiom_number,
    axiom_rule,
    COUNT(*) AS failure_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY method_id), 2) AS failure_pct
FROM axiom_stats
WHERE passed = FALSE
GROUP BY method_id, axiom_number, axiom_rule
ORDER BY method_id, failure_count DESC;

CREATE OR REPLACE VIEW v_weekly_performance AS
SELECT
    DATE_TRUNC('week', created_at) AS week,
    method_id,
    COUNT(*) AS total_generated,
    SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END) AS total_published,
    AVG(body_char_count) AS avg_char_count,
    SUM(view_count) AS total_views,
    ROUND(AVG(axiom_passed * 1.0 / NULLIF(axiom_total, 0)) * 100, 2) AS avg_axiom_pass_rate_pct
FROM blog_posts
GROUP BY week, method_id
ORDER BY week DESC, method_id;
