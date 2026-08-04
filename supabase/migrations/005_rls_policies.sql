-- ============================================================
-- Migration 005: RLS 정책 (최종판 — 006에서 성능 최적화됨)
-- ============================================================
-- * 유저 JWT: Supabase Auth (role=authenticated, sub=user_id)
-- * 에이전트 JWT: 백엔드가 Supabase JWT secret으로 서명
--   claims: role=authenticated, sub=<agent uuid>, agent_id, accounts[], is_agent=true
-- * service_role은 모든 RLS 우회 (content_service/admin 용)
--
-- 주의: 이 파일은 최초 정책 생성 내역이며 006에서 성능 최적화로 재작성됨.
--       DB에 새로 적용할 때는 005 적용 후 006을 반드시 적용할 것.
-- ============================================================

-- Helper functions (006에서도 그대로 사용됨)
CREATE OR REPLACE FUNCTION public.is_agent()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$ SELECT COALESCE((auth.jwt() ->> 'is_agent')::boolean, false); $$;

CREATE OR REPLACE FUNCTION public.agent_accounts()
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(auth.jwt() -> 'accounts')),
    ARRAY[]::TEXT[]
  );
$$;

CREATE OR REPLACE FUNCTION public.my_accounts()
RETURNS TEXT[] LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    ARRAY(SELECT account_name FROM public.user_accounts WHERE user_id = auth.uid()),
    ARRAY[]::TEXT[]
  );
$$;

-- 최초 정책 (006에서 DROP 후 재생성됨 - 이 파일은 이력 보존용)
CREATE POLICY user_accounts_self_read ON user_accounts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY blog_posts_owner_all ON blog_posts
  FOR ALL
  USING (user_id = auth.uid() AND NOT is_agent())
  WITH CHECK (user_id = auth.uid() AND NOT is_agent());

CREATE POLICY axiom_stats_via_post ON axiom_stats
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM blog_posts bp
    WHERE bp.id = axiom_stats.post_id AND bp.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM blog_posts bp
    WHERE bp.id = axiom_stats.post_id AND bp.user_id = auth.uid()
  ));

CREATE POLICY post_series_owner_all ON post_series
  FOR ALL
  USING (user_id = auth.uid() AND NOT is_agent())
  WITH CHECK (user_id = auth.uid() AND NOT is_agent());

CREATE POLICY generation_requests_owner_all ON generation_requests
  FOR ALL
  USING (user_id = auth.uid() AND NOT is_agent())
  WITH CHECK (user_id = auth.uid() AND NOT is_agent());

CREATE POLICY domain_programs_auth_read ON domain_programs
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY keyword_lookups_owner_all ON keyword_lookups
  FOR ALL
  USING (user_id = auth.uid() AND NOT is_agent())
  WITH CHECK (user_id = auth.uid() AND NOT is_agent());

CREATE POLICY jobs_user_select ON jobs
  FOR SELECT USING (NOT is_agent() AND account_name = ANY(my_accounts()));
CREATE POLICY jobs_user_insert ON jobs
  FOR INSERT WITH CHECK (NOT is_agent() AND account_name = ANY(my_accounts()));
CREATE POLICY jobs_user_update ON jobs
  FOR UPDATE
  USING (NOT is_agent() AND account_name = ANY(my_accounts()))
  WITH CHECK (NOT is_agent() AND account_name = ANY(my_accounts()));
CREATE POLICY jobs_user_delete ON jobs
  FOR DELETE USING (NOT is_agent() AND account_name = ANY(my_accounts()));

CREATE POLICY jobs_agent_select ON jobs
  FOR SELECT USING (is_agent() AND account_name = ANY(agent_accounts()));
CREATE POLICY jobs_agent_update ON jobs
  FOR UPDATE
  USING (is_agent() AND account_name = ANY(agent_accounts()))
  WITH CHECK (is_agent() AND account_name = ANY(agent_accounts()));

CREATE POLICY job_logs_select_via_jobs ON job_logs
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_logs.job_id
      AND (
        (NOT is_agent() AND j.account_name = ANY(my_accounts()))
        OR (is_agent() AND j.account_name = ANY(agent_accounts()))
      )
  ));
CREATE POLICY job_logs_agent_insert ON job_logs
  FOR INSERT WITH CHECK (is_agent() AND EXISTS (
    SELECT 1 FROM jobs j WHERE j.id = job_logs.job_id
      AND j.account_name = ANY(agent_accounts())
  ));

CREATE POLICY agent_heartbeat_self_all ON agent_heartbeat
  FOR ALL
  USING (is_agent() AND agent_id = (auth.jwt() ->> 'agent_id'))
  WITH CHECK (is_agent() AND agent_id = (auth.jwt() ->> 'agent_id'));

CREATE POLICY agent_heartbeat_user_read ON agent_heartbeat
  FOR SELECT USING (
    NOT is_agent() AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(accounts) AS acc
      WHERE acc = ANY(my_accounts())
    )
  );

CREATE POLICY publish_history_user_select ON publish_history
  FOR SELECT USING (NOT is_agent() AND account_name = ANY(my_accounts()));
CREATE POLICY publish_history_agent_select ON publish_history
  FOR SELECT USING (is_agent() AND account_name = ANY(agent_accounts()));
CREATE POLICY publish_history_agent_insert ON publish_history
  FOR INSERT WITH CHECK (is_agent() AND account_name = ANY(agent_accounts()));
