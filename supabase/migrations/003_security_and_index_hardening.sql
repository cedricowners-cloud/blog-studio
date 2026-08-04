-- ============================================================
-- Migration 003: 보안 강화 + FK 커버링 인덱스
-- ============================================================
-- Supabase advisors ERROR/WARN 해소:
--   * SECURITY DEFINER 뷰 → security_invoker 전환
--   * 함수 search_path 고정 (search_path 주입 방지)
--   * post_series / publish_history FK 커버링 인덱스 추가
-- ============================================================

-- 1. SECURITY DEFINER 뷰 → security_invoker
ALTER VIEW public.v_method_axiom_failures SET (security_invoker = true);
ALTER VIEW public.v_weekly_performance SET (security_invoker = true);

-- 2. 함수 search_path 고정
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.purge_stale_keyword_lookups() SET search_path = public, pg_temp;

-- 3. FK 커버링 인덱스
CREATE INDEX IF NOT EXISTS idx_post_series_l1 ON public.post_series(l1_post_id);
CREATE INDEX IF NOT EXISTS idx_post_series_l2 ON public.post_series(l2_post_id);
CREATE INDEX IF NOT EXISTS idx_post_series_l3 ON public.post_series(l3_post_id);
CREATE INDEX IF NOT EXISTS idx_post_series_l4 ON public.post_series(l4_post_id);
CREATE INDEX IF NOT EXISTS idx_publish_history_blog_post ON public.publish_history(blog_post_id);
