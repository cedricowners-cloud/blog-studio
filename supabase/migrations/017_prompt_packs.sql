-- ============================================================
-- Migration 017: 프롬프트 묶음 (크롬 확장이 로그인해서 받아 간다)
-- ============================================================
-- * prompt_packs  : 프롬프트 묶음. 지금은 'default' 한 줄만 쓴다.
--                   내용은 extension/scripts/build-prompt-pack.ts 가 만든 JSON 이다.
-- * prompt_access : 프롬프트를 받아도 되는 사람 목록.
--
-- 이 프로젝트는 가입이 열려 있다 (이메일만 있으면 누구나 계정을 만들 수 있다).
-- 그래서 "로그인한 사람"이 아니라 "prompt_access 에 있는 사람"만 읽게 한다.
-- 쓰기 정책은 두지 않는다. service_role(올리는 명령, SQL 편집기)만 쓸 수 있다.
--
-- 사람을 더할 때 (SQL 편집기에서):
--   INSERT INTO public.prompt_access (user_id, note)
--   SELECT id, '가족' FROM auth.users WHERE email = '더할 사람의 이메일';
-- 뺄 때:
--   DELETE FROM public.prompt_access
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = '뺄 사람의 이메일');
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prompt_access (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text,
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prompt_packs (
  id         text PRIMARY KEY,
  format     integer NOT NULL,
  pack       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prompt_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_packs  ENABLE ROW LEVEL SECURITY;

-- 로그인하지 않은 요청은 표에 손대지 못한다. 로그인한 사람은 읽기만 한다.
REVOKE ALL ON public.prompt_access FROM anon, authenticated;
REVOKE ALL ON public.prompt_packs  FROM anon, authenticated;
GRANT SELECT ON public.prompt_access TO authenticated;
GRANT SELECT ON public.prompt_packs  TO authenticated;

-- 내가 목록에 있는지는 본인만 볼 수 있다.
CREATE POLICY prompt_access_self_read ON public.prompt_access
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT public.is_agent()));

-- 목록에 있는 사람만 프롬프트를 읽는다. 로컬 에이전트의 토큰으로는 읽지 못한다.
CREATE POLICY prompt_packs_allowed_read ON public.prompt_packs
  FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.is_agent())
    AND EXISTS (
      SELECT 1 FROM public.prompt_access a WHERE a.user_id = (SELECT auth.uid())
    )
  );
