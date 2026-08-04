-- ============================================================
-- Migration 015: SEO 단계별 글쓰기 워크플로 실행 기록
-- ============================================================
-- /seo-write 에서 사용자가 시작한 워크플로 한 건 = seo_workflow_runs 1행
-- 단계별 진행 상태 = seo_workflow_step_results
--   - API 모드: conversation (JSONB) 에 chat history 저장
--   - 복사 모드: user_pasted_result 에 사용자가 LLM에서 받아 붙여넣은 텍스트
--   - final_output: 다음 단계의 prev_output 으로 주입되는 최종 산출물
-- ============================================================

CREATE TABLE IF NOT EXISTS seo_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL DEFAULT 'seo_course_v1',
  platform TEXT NOT NULL CHECK (platform IN ('naver_blog', 'custom_domain')),
  mode TEXT NOT NULL CHECK (mode IN ('api', 'copy')),
  main_keyword TEXT NOT NULL,
  -- API 모드일 때만 의미 있음 (복사 모드는 사용자가 외부 LLM 사용)
  llm_provider TEXT,
  llm_model TEXT,
  -- 옵션 단계(롱테일 등) 포함 여부
  include_optional BOOLEAN DEFAULT TRUE,
  -- 사용자가 step 6 이후 선택한 타이틀 (step 7에서 사용)
  selected_title TEXT,
  -- 진행 상태
  current_step_index INTEGER NOT NULL DEFAULT 0, -- 0-based, getStepsForPlatform 결과 배열의 인덱스
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_workflow_step_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES seo_workflow_runs(id) ON DELETE CASCADE,
  step_id INTEGER NOT NULL CHECK (step_id BETWEEN 1 AND 8),
  -- API 모드: [{role: "user"|"assistant", content: "..."}, ...]
  conversation JSONB DEFAULT '[]'::jsonb,
  -- 복사 모드: 사용자가 LLM에서 받아 붙여넣은 결과
  user_pasted_result TEXT,
  -- 양쪽 공통: 다음 단계로 넘길 최종 산출물
  -- API 모드 = 마지막 assistant 메시지, 복사 모드 = user_pasted_result
  final_output TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_swr_user_status
  ON seo_workflow_runs (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_swsr_run_step
  ON seo_workflow_step_results (run_id, step_id);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trigger_swr_updated_at ON seo_workflow_runs;
CREATE TRIGGER trigger_swr_updated_at
  BEFORE UPDATE ON seo_workflow_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trigger_swsr_updated_at ON seo_workflow_step_results;
CREATE TRIGGER trigger_swsr_updated_at
  BEFORE UPDATE ON seo_workflow_step_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS — 본인만
ALTER TABLE seo_workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY swr_self_all ON seo_workflow_runs
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));

ALTER TABLE seo_workflow_step_results ENABLE ROW LEVEL SECURITY;
-- step_results 는 run을 통해 user 매핑 → run의 user_id 검사
CREATE POLICY swsr_self_all ON seo_workflow_step_results
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM seo_workflow_runs r
      WHERE r.id = run_id
        AND r.user_id = (SELECT auth.uid())
        AND NOT (SELECT is_agent())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM seo_workflow_runs r
      WHERE r.id = run_id
        AND r.user_id = (SELECT auth.uid())
        AND NOT (SELECT is_agent())
    )
  );
