-- ============================================================
-- Migration 006: RLS 성능 최적화
-- ============================================================
-- 005에서 생성한 정책을 다음 기준으로 재작성:
-- * auth.uid() / is_agent() (스칼라) → (SELECT ...) InitPlan 래핑
--   → Postgres가 쿼리당 1회만 평가하도록 유도 (행별 재평가 제거)
-- * my_accounts() / agent_accounts() (배열) → 직접 호출 유지
--   → (SELECT 배열함수())는 text = text[] 타입 충돌 유발하므로 래핑 안 함
-- * 다중 permissive 정책(jobs/publish_history/agent_heartbeat SELECT, jobs UPDATE)
--   → CASE로 단일 정책에 통합
-- ============================================================

-- 기존 정책 전부 DROP
DROP POLICY IF EXISTS user_accounts_self_read ON user_accounts;
DROP POLICY IF EXISTS blog_posts_owner_all ON blog_posts;
DROP POLICY IF EXISTS axiom_stats_via_post ON axiom_stats;
DROP POLICY IF EXISTS post_series_owner_all ON post_series;
DROP POLICY IF EXISTS generation_requests_owner_all ON generation_requests;
DROP POLICY IF EXISTS domain_programs_auth_read ON domain_programs;
DROP POLICY IF EXISTS keyword_lookups_owner_all ON keyword_lookups;
DROP POLICY IF EXISTS jobs_user_select ON jobs;
DROP POLICY IF EXISTS jobs_user_insert ON jobs;
DROP POLICY IF EXISTS jobs_user_update ON jobs;
DROP POLICY IF EXISTS jobs_user_delete ON jobs;
DROP POLICY IF EXISTS jobs_agent_select ON jobs;
DROP POLICY IF EXISTS jobs_agent_update ON jobs;
DROP POLICY IF EXISTS job_logs_select_via_jobs ON job_logs;
DROP POLICY IF EXISTS job_logs_agent_insert ON job_logs;
DROP POLICY IF EXISTS agent_heartbeat_self_all ON agent_heartbeat;
DROP POLICY IF EXISTS agent_heartbeat_user_read ON agent_heartbeat;
DROP POLICY IF EXISTS publish_history_user_select ON publish_history;
DROP POLICY IF EXISTS publish_history_agent_select ON publish_history;
DROP POLICY IF EXISTS publish_history_agent_insert ON publish_history;

-- ======== user_accounts ========
CREATE POLICY user_accounts_self_read ON user_accounts
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- ======== blog_posts ========
CREATE POLICY blog_posts_owner_all ON blog_posts
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));

-- ======== axiom_stats ========
CREATE POLICY axiom_stats_via_post ON axiom_stats
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM blog_posts bp
    WHERE bp.id = axiom_stats.post_id AND bp.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM blog_posts bp
    WHERE bp.id = axiom_stats.post_id AND bp.user_id = (SELECT auth.uid())
  ));

-- ======== post_series ========
CREATE POLICY post_series_owner_all ON post_series
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));

-- ======== generation_requests ========
CREATE POLICY generation_requests_owner_all ON generation_requests
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));

-- ======== domain_programs ========
CREATE POLICY domain_programs_auth_read ON domain_programs
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

-- ======== keyword_lookups ========
CREATE POLICY keyword_lookups_owner_all ON keyword_lookups
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));

-- ======== jobs (user + agent 단일 정책) ========
CREATE POLICY jobs_select ON jobs
  FOR SELECT USING (
    CASE WHEN (SELECT is_agent())
      THEN account_name = ANY(agent_accounts())
      ELSE account_name = ANY(my_accounts())
    END
  );

CREATE POLICY jobs_insert ON jobs
  FOR INSERT WITH CHECK (
    NOT (SELECT is_agent())
    AND account_name = ANY(my_accounts())
  );

CREATE POLICY jobs_update ON jobs
  FOR UPDATE
  USING (
    CASE WHEN (SELECT is_agent())
      THEN account_name = ANY(agent_accounts())
      ELSE account_name = ANY(my_accounts())
    END
  )
  WITH CHECK (
    CASE WHEN (SELECT is_agent())
      THEN account_name = ANY(agent_accounts())
      ELSE account_name = ANY(my_accounts())
    END
  );

CREATE POLICY jobs_delete ON jobs
  FOR DELETE USING (
    NOT (SELECT is_agent())
    AND account_name = ANY(my_accounts())
  );

-- ======== job_logs ========
CREATE POLICY job_logs_select ON job_logs
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_logs.job_id
      AND (
        CASE WHEN (SELECT is_agent())
          THEN j.account_name = ANY(agent_accounts())
          ELSE j.account_name = ANY(my_accounts())
        END
      )
  ));

CREATE POLICY job_logs_agent_insert ON job_logs
  FOR INSERT WITH CHECK (
    (SELECT is_agent()) AND EXISTS (
      SELECT 1 FROM jobs j WHERE j.id = job_logs.job_id
        AND j.account_name = ANY(agent_accounts())
    )
  );

-- ======== agent_heartbeat (SELECT 병합, INSERT/UPDATE 분리) ========
CREATE POLICY agent_heartbeat_select ON agent_heartbeat
  FOR SELECT USING (
    CASE WHEN (SELECT is_agent())
      THEN agent_id = ((SELECT auth.jwt()) ->> 'agent_id')
      ELSE EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(agent_heartbeat.accounts) AS acc
        WHERE acc = ANY(my_accounts())
      )
    END
  );

CREATE POLICY agent_heartbeat_agent_insert ON agent_heartbeat
  FOR INSERT WITH CHECK (
    (SELECT is_agent())
    AND agent_id = ((SELECT auth.jwt()) ->> 'agent_id')
  );

CREATE POLICY agent_heartbeat_agent_update ON agent_heartbeat
  FOR UPDATE
  USING (
    (SELECT is_agent())
    AND agent_id = ((SELECT auth.jwt()) ->> 'agent_id')
  )
  WITH CHECK (
    (SELECT is_agent())
    AND agent_id = ((SELECT auth.jwt()) ->> 'agent_id')
  );

-- ======== publish_history ========
CREATE POLICY publish_history_select ON publish_history
  FOR SELECT USING (
    CASE WHEN (SELECT is_agent())
      THEN account_name = ANY(agent_accounts())
      ELSE account_name = ANY(my_accounts())
    END
  );

CREATE POLICY publish_history_agent_insert ON publish_history
  FOR INSERT WITH CHECK (
    (SELECT is_agent())
    AND account_name = ANY(agent_accounts())
  );
