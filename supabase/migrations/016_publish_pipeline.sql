-- ============================================================
-- Migration 016: 발행 파이프라인 연결
-- ============================================================
-- 배경: 002에서 jobs 큐를, 005/006에서 RLS를 만들었지만 웹 ↔ 에이전트
-- 경로가 한 번도 연결된 적이 없다(jobs 0건). 실제로 연결해보니 세 가지가
-- 막혀 있었다.
--
-- (1) jobs_insert 조건이 account_name = ANY(my_accounts()) 인데
--     my_accounts()의 소스인 user_accounts 에 INSERT 정책이 없어서
--     사용자가 자기 네이버 계정명을 등록할 방법이 아예 없었다.
--
-- (2) 005 주석은 에이전트가 "백엔드가 Supabase JWT secret으로 서명한"
--     is_agent=true JWT를 쓸 것으로 가정했지만, local_agent/pairing.py 는
--     사용자 refresh_token 을 그대로 저장한다. 즉 에이전트는 사용자로
--     인증된다 → is_agent()=false → job_logs / agent_heartbeat /
--     publish_history 의 agent INSERT 정책에 전부 걸려 쓰기가 유실된다.
--     단일 사용자 시스템이므로 소유자 본인에게 쓰기를 허용한다.
--     (is_agent 정책은 향후 멀티테넌트 확장을 위해 그대로 남겨둔다.)
--
-- (3) jobs → blog_posts 연결이 payload JSONB 안에만 있어서 "이 글의 발행
--     작업"을 조회하기 어려웠다. 실제 컬럼으로 승격한다.
-- ============================================================

-- ============================================================
-- 1. user_accounts — 본인 계정 등록/해제 허용
-- ============================================================
-- PK가 (user_id, account_name)이라 UPDATE는 필요 없다. 이름을 바꾸려면
-- 지우고 다시 넣는다.
CREATE POLICY user_accounts_self_insert ON user_accounts
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY user_accounts_self_delete ON user_accounts
  FOR DELETE USING (user_id = (SELECT auth.uid()));

-- ============================================================
-- 2. jobs — blog_posts 역참조
-- ============================================================
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS blog_post_id UUID REFERENCES blog_posts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_blog_post ON jobs(blog_post_id, created_at DESC);

-- ============================================================
-- 3. job_logs — 사용자 토큰으로 도는 에이전트가 진행 로그를 쓸 수 있게
-- ============================================================
-- 기존 job_logs_agent_insert(is_agent 전용)는 유지. SELECT 정책은 이미
-- my_accounts() 경로를 커버한다.
CREATE POLICY job_logs_user_insert ON job_logs
  FOR INSERT WITH CHECK (
    NOT (SELECT is_agent())
    AND EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.id = job_logs.job_id
        AND j.account_name = ANY(my_accounts())
    )
  );

-- ============================================================
-- 4. agent_heartbeat — 소유자 식별 컬럼 + 사용자 쓰기 허용
-- ============================================================
-- 기존 user 읽기 정책은 accounts JSONB 가 my_accounts() 와 겹치는지로
-- 판별했는데, 에이전트가 accounts 를 안 보내면 영구히 안 보인다(= 첫
-- 설정 시 "에이전트 연결됨" 표시 불가). 소유자를 명시 컬럼으로 둔다.
--
-- DEFAULT auth.uid() 를 쓰지 않는 이유: is_agent JWT의 auth.uid()는 실제
-- auth.users 행이 아닌 에이전트 UUID라 FK 위반이 난다. 워커가 자기 세션의
-- user_id 를 명시적으로 넣는다.
ALTER TABLE agent_heartbeat
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_agent_heartbeat_user ON agent_heartbeat(user_id, last_seen DESC);

CREATE POLICY agent_heartbeat_user_select ON agent_heartbeat
  FOR SELECT USING (
    NOT (SELECT is_agent())
    AND user_id = (SELECT auth.uid())
  );

CREATE POLICY agent_heartbeat_user_insert ON agent_heartbeat
  FOR INSERT WITH CHECK (
    NOT (SELECT is_agent())
    AND user_id = (SELECT auth.uid())
  );

CREATE POLICY agent_heartbeat_user_update ON agent_heartbeat
  FOR UPDATE
  USING (
    NOT (SELECT is_agent())
    AND user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    NOT (SELECT is_agent())
    AND user_id = (SELECT auth.uid())
  );

-- agent_heartbeat 에는 DELETE 정책이 아예 없어서, 폐기한 기기가 목록에
-- 영구히 남는다(그리고 RLS 는 0건 삭제를 204로 돌려줘 조용히 실패한다).
CREATE POLICY agent_heartbeat_user_delete ON agent_heartbeat
  FOR DELETE USING (
    NOT (SELECT is_agent())
    AND user_id = (SELECT auth.uid())
  );

-- ============================================================
-- 5. publish_history — 사용자 토큰 에이전트가 발행 이력을 남길 수 있게
-- ============================================================
-- DELETE 정책은 의도적으로 두지 않는다 — 발행 이력은 감사 기록이므로
-- append-only 로 유지한다.
CREATE POLICY publish_history_user_insert ON publish_history
  FOR INSERT WITH CHECK (
    NOT (SELECT is_agent())
    AND account_name = ANY(my_accounts())
  );
