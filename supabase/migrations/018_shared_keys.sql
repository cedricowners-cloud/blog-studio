-- ============================================================
-- Migration 018: 가족이 함께 쓰는 키 (크롬 확장이 로그인해서 받아 간다)
-- ============================================================
-- * shared_keys : 함께 쓰는 API 키. 지금은 'naver' 한 줄만 쓴다.
--                 keys 는 { clientId, clientSecret, license, secret, customerId } 모양의 JSON 이다.
--                 (네이버 검색 API 와 검색광고 API 의 키. 확장의 "자료" 탭이 쓴다.)
--
-- 키를 확장 파일이나 저장소(GitHub)에 넣지 않으려고 서버에 둔다.
-- 파일에 넣으면, 암호화하더라도 푸는 열쇠가 같이 들어가서 파일을 가진 사람은 누구나 풀 수 있다.
-- 여기에 두면 로그인한 사람 중 prompt_access 에 있는 사람만 받을 수 있다 (017 과 같은 목록).
--
-- 쓰기 정책은 두지 않는다. service_role(올리는 명령, SQL 편집기)만 쓸 수 있다.
--   올리기: extension 폴더에서 npm run keys:push  (web/.env.local 의 NAVER_* 값을 올린다)
--   지우기: DELETE FROM public.shared_keys WHERE id = 'naver';
--
-- 알아 둘 점: 검색광고 API 의 키는 키워드 조회뿐 아니라 그 광고 계정을 다루는 데도 쓸 수 있다.
-- 받을 수 있는 사람(prompt_access)을 가족으로만 둔다.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shared_keys (
  id         text PRIMARY KEY,
  keys       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_keys ENABLE ROW LEVEL SECURITY;

-- 로그인하지 않은 요청은 표에 손대지 못한다. 로그인한 사람은 읽기만 한다.
REVOKE ALL ON public.shared_keys FROM anon, authenticated;
GRANT SELECT ON public.shared_keys TO authenticated;

-- 목록에 있는 사람만 읽는다. 로컬 에이전트의 토큰으로는 읽지 못한다.
CREATE POLICY shared_keys_allowed_read ON public.shared_keys
  FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.is_agent())
    AND EXISTS (
      SELECT 1 FROM public.prompt_access a WHERE a.user_id = (SELECT auth.uid())
    )
  );
