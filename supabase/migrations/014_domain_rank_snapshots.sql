-- ============================================================
-- Migration 014: domain_rank_snapshots — 경쟁사·자기 도메인 순위 스냅샷
-- ============================================================
-- 사용자가 /rank-tracker 에서 (도메인, 키워드) 조합 순위를 체크할 때마다 한 행 저장.
-- 시간이 쌓이면 "지난주 5위 → 이번주 3위" 같은 변동 추적 가능.
-- ============================================================

CREATE TABLE IF NOT EXISTS domain_rank_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_domain TEXT NOT NULL,
  keyword TEXT NOT NULL,
  search_type TEXT NOT NULL CHECK (search_type IN ('blog', 'web')),
  rank INTEGER, -- NULL = topN 미진입
  matched_url TEXT,
  matched_title TEXT,
  total_results INTEGER,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drs_user_domain
  ON domain_rank_snapshots (user_id, target_domain, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_drs_keyword
  ON domain_rank_snapshots (keyword, checked_at DESC);

ALTER TABLE domain_rank_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY drs_self_all ON domain_rank_snapshots
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));
