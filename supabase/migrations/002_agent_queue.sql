-- ============================================================
-- Migration 002: Agent 작업 큐 + 키워드 캐시 + 발행 이력
-- ============================================================
-- 웹 ↔ 로컬 에이전트 통신을 위한 Supabase 브로커 패턴
-- ============================================================

-- ============================================================
-- jobs: 로컬 에이전트 작업 큐
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('publish', 'neighbor_add', 'interact_like', 'interact_comment')),
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    account_name TEXT NOT NULL,
    agent_id TEXT,                      -- 처리한 에이전트 식별
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_account ON jobs(status, account_name) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

-- ============================================================
-- job_logs: 작업 진행 로그 (Realtime 구독용)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_logs (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id, created_at);

-- ============================================================
-- agent_heartbeat: 로컬 에이전트 상태
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_heartbeat (
    agent_id TEXT PRIMARY KEY,
    label TEXT,                          -- 사용자가 붙인 이름 (예: "집 데스크탑")
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version TEXT,
    status TEXT CHECK (status IN ('idle', 'busy', 'logging_in')),
    accounts JSONB,                      -- 이 에이전트가 다루는 네이버 계정명 목록
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- keyword_lookups: 키워드 조회 결과 캐시 (TTL 24시간)
-- ============================================================
CREATE TABLE IF NOT EXISTS keyword_lookups (
    id BIGSERIAL PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    metrics JSONB NOT NULL,              -- 검색수·클릭수·클릭율·경쟁도·노출광고수 등
    related_keywords JSONB,              -- 연관 키워드 배열(각 항목에 metrics 포함)
    shopping_category TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_lookups_fetched ON keyword_lookups(fetched_at);

-- 만료된 캐시 자동 정리 함수 (24시간 초과)
CREATE OR REPLACE FUNCTION purge_stale_keyword_lookups()
RETURNS void AS $$
BEGIN
    DELETE FROM keyword_lookups WHERE fetched_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- publish_history: 발행 이력 (기존 publish_stats.py 대체)
-- ============================================================
CREATE TABLE IF NOT EXISTS publish_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blog_post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL,
    account_name TEXT NOT NULL,
    title TEXT NOT NULL,
    tags TEXT[],
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    naver_post_url TEXT,
    published_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_history_account ON publish_history(account_name, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_publish_history_date ON publish_history(published_at DESC);
