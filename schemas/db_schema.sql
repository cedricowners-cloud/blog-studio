-- ============================================================
-- 네이버 블로그 v2 온톨로지 엔진 — Supabase DB 스키마
-- ============================================================
-- 작성일: 2026-04-22
-- 대상 DB: PostgreSQL 15+ / Supabase
-- 실행 방법:
--   1. Supabase 대시보드 → SQL Editor에 이 파일 전체 붙여넣기
--   2. 또는 psql -f db_schema.sql
-- ============================================================

-- UUID 생성 확장 활성화 (Supabase는 기본 활성화되어 있음)
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
    content_type TEXT,  -- 자격진단형/절차형/비교형 등
    
    -- 공리 검증
    axiom_total INT,
    axiom_passed INT,
    axiom_failed INT,
    axiom_pass_rate TEXT,           -- "17/17" 형식
    axiom_failed_list JSONB,        -- 실패 공리 번호 배열
    
    -- 생성 메타
    final_attempt INT,              -- 몇 번째 시도에서 통과
    needs_human_review BOOLEAN DEFAULT FALSE,
    llm_provider TEXT,              -- 'claude' 또는 'gemini'
    generation_duration_ms INT,
    
    -- 전체 메타 JSON (LLM 응답의 §6 전체)
    meta JSONB,
    
    -- 발행 정보
    published_at TIMESTAMPTZ,
    naver_post_id TEXT,
    naver_post_url TEXT,
    
    -- 성과 추적 (Phase 3+)
    view_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    last_performance_check TIMESTAMPTZ,
    
    -- 타임스탬프
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_blog_posts_method ON blog_posts(method_id);
CREATE INDEX idx_blog_posts_main_keyword ON blog_posts(main_keyword);
CREATE INDEX idx_blog_posts_awareness ON blog_posts(target_awareness_level);
CREATE INDEX idx_blog_posts_created ON blog_posts(created_at DESC);
CREATE INDEX idx_blog_posts_review ON blog_posts(needs_human_review) WHERE needs_human_review = TRUE;
CREATE INDEX idx_blog_posts_published ON blog_posts(published_at DESC) WHERE published_at IS NOT NULL;

COMMENT ON TABLE blog_posts IS 'v2 엔진으로 생성된 블로그 글 메타 로그';
COMMENT ON COLUMN blog_posts.axiom_pass_rate IS '공리 통과율 "N/total" 형식. 방식별 total 다름 (1:15, 2:16, 3:16, 4:16, 5:16, 6:17)';
COMMENT ON COLUMN blog_posts.needs_human_review IS 'max_retries 후에도 공리 통과 실패 시 TRUE';


-- ============================================================
-- 2. axiom_stats: 공리별 실패 통계 (프롬프트 개선 재료)
-- ============================================================
CREATE TABLE IF NOT EXISTS axiom_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
    method_id INT NOT NULL,
    axiom_number INT NOT NULL,      -- 1~10 (공통) 또는 11~ (방식특화)
    axiom_rule TEXT NOT NULL,
    passed BOOLEAN NOT NULL,
    evidence TEXT,
    attempt_number INT,             -- 몇 번째 시도의 기록인가
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_axiom_stats_post ON axiom_stats(post_id);
CREATE INDEX idx_axiom_stats_method_axiom ON axiom_stats(method_id, axiom_number);
CREATE INDEX idx_axiom_stats_failed ON axiom_stats(method_id, axiom_number, passed) WHERE passed = FALSE;

COMMENT ON TABLE axiom_stats IS '공리별 통과/실패 로그. 프롬프트 개선 위한 패턴 분석 재료.';


-- ============================================================
-- 3. domain_programs: 정부지원사업 온톨로지 DB (Phase 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS domain_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 기본 정보
    사업명 TEXT NOT NULL,
    주관기관 TEXT,
    근거법령 TEXT,
    사업유형 TEXT,                   -- '정책자금' / 'R&D' / '인증' / '바우처' 등
    
    -- Ontology A 구조
    지원유형 TEXT,                   -- 융자/출연/보조/보증/바우처/인증
    지원규모 JSONB,                  -- {"한도금액": "...", "금리": "...", "상환기간": "..."}
    자격요건 JSONB,                  -- {"기업요건": {...}, "대표자요건": {...}, "업종요건": {...}}
    제외요건 JSONB,                  -- [...]
    접수방식 TEXT,
    공고주기 TEXT,
    확인필요항목 TEXT[],             -- 아직 파악 안 된 항목들
    
    -- 원본 추적
    source_url TEXT,
    source_announcement_id TEXT,     -- 기업마당 pblancId 등
    
    -- 유효 기간
    valid_from DATE,
    valid_until DATE,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- 타임스탬프
    last_verified DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_domain_programs_name ON domain_programs(사업명);
CREATE INDEX idx_domain_programs_agency ON domain_programs(주관기관);
CREATE INDEX idx_domain_programs_active ON domain_programs(is_active, valid_until) WHERE is_active = TRUE;

COMMENT ON TABLE domain_programs IS 'Phase 3: 정부지원사업 온톨로지 DB. 글 생성 시 domain_info에 자동 주입되어 사용됨.';


-- ============================================================
-- 4. post_series: L1~L4 시리즈 관계 (Phase 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS post_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_name TEXT NOT NULL,       -- 예: "혁신성장촉진자금 스마트기술 시리즈"
    main_keyword TEXT NOT NULL,
    
    -- 시리즈 구성
    l1_post_id UUID REFERENCES blog_posts(id),
    l2_post_id UUID REFERENCES blog_posts(id),
    l3_post_id UUID REFERENCES blog_posts(id),
    l4_post_id UUID REFERENCES blog_posts(id),
    
    -- 상태
    planned_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_post_series_keyword ON post_series(main_keyword);


-- ============================================================
-- 5. generation_requests: 요청 로그 (디버깅/재현용)
-- ============================================================
CREATE TABLE IF NOT EXISTS generation_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
    
    -- 원본 입력 전체
    input_payload JSONB NOT NULL,
    
    -- 프롬프트 전체 (재현/디버깅용)
    full_prompt TEXT,
    
    -- 응답 전체
    raw_response TEXT,
    parsed_response JSONB,
    
    -- 에러 정보
    error_message TEXT,
    error_code TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_generation_requests_post ON generation_requests(post_id);
CREATE INDEX idx_generation_requests_error ON generation_requests(error_code) WHERE error_code IS NOT NULL;


-- ============================================================
-- 트리거: updated_at 자동 업데이트
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_blog_posts_updated_at
    BEFORE UPDATE ON blog_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_domain_programs_updated_at
    BEFORE UPDATE ON domain_programs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- 뷰: 분석 편의용
-- ============================================================

-- 방식별 공리 실패 TOP 3
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

COMMENT ON VIEW v_method_axiom_failures IS '방식별 어떤 공리가 가장 자주 실패하는지 분석';


-- 주간 발행 성과
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


-- ============================================================
-- 초기 시드 데이터 (예시): 혁신성장촉진자금 스마트기술
-- ============================================================
INSERT INTO domain_programs (
    사업명, 주관기관, 근거법령, 사업유형,
    지원유형, 지원규모, 자격요건, 제외요건, 접수방식, 공고주기,
    source_url, last_verified, valid_from, is_active
) VALUES (
    '혁신성장촉진자금 - 스마트기술',
    '소상공인시장진흥공단(소진공)',
    '소상공인 보호 및 지원에 관한 법률 제9조',
    '정책자금',
    '융자(직접대출)',
    '{"한도금액": "업체당 최대 1억 원", "금리": "2026년 1분기 기준 연 2.96% + 자금별 가산금리", "상환기간": "5년 이내(거치기간 2년 포함)"}'::JSONB,
    '{"기업요건": {"상시근로자": "5인 이하(제조·건설·운수·광업은 10인 미만)", "영업상태": "정상 영업 중"}, "업종요건": {"포함": "소상공인기본법상 소상공인 + 스마트기술 도입 예정", "제외": "유흥·사행성 등 융자제한업종"}}'::JSONB,
    '["2026년 4월부터 일부 자동화 기기 제외", "국세·지방세 체납", "휴업·폐업 상태", "동일 스마트기술 중복수혜", "연체·부실 이력"]'::JSONB,
    '온라인(ols.semas.or.kr) 또는 소진공 지역센터 방문',
    '분기별(2026년 4월부터)',
    'https://ols.semas.or.kr',
    '2026-04-22',
    '2026-04-01',
    TRUE
) ON CONFLICT DO NOTHING;


-- ============================================================
-- 완료
-- ============================================================
-- 다음 확인 쿼리로 설치 검증:
--   SELECT table_name FROM information_schema.tables 
--   WHERE table_schema = 'public' 
--   AND table_name IN ('blog_posts', 'axiom_stats', 'domain_programs', 'post_series', 'generation_requests');
-- ============================================================
