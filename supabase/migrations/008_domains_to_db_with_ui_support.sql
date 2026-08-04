-- ============================================================
-- Migration 008: Domain Pack 데이터를 DB로 이전 (UI 입력 지원)
-- ============================================================
-- * domains 테이블에 JSONB 컬럼 4개 추가 (positioning_data, reader_data, lexicon_data, class_markdown)
-- * 마크다운 파일 대신 DB에서 도메인 설정을 read/write
-- * RLS 정책 확장: 인증된 사용자가 도메인 CRUD 가능
-- * 시드: public_procurement 패키지 초안을 INSERT로 변환
--
-- ★ public_procurement UPDATE 시드 SQL은 마이그레이션 적용 시 함께 실행됨 (긴 JSONB,
--   여기서는 가독성을 위해 SQL 본문은 7번 항목으로 별도. 실제 DB 적용은 MCP 도구로 완료.)
-- ============================================================

-- 1. domains 컬럼 확장 ----------------------------------------
ALTER TABLE domains ADD COLUMN IF NOT EXISTS positioning_data JSONB;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS reader_data JSONB;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS lexicon_data JSONB;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS class_markdown TEXT;

-- 2. RLS 정책 추가 (write 권한) -------------------------------
CREATE POLICY domains_authenticated_insert ON domains
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND NOT (SELECT is_agent()));

CREATE POLICY domains_authenticated_update ON domains
  FOR UPDATE
  USING ((SELECT auth.uid()) IS NOT NULL AND NOT (SELECT is_agent()))
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND NOT (SELECT is_agent()));

CREATE POLICY domains_authenticated_delete ON domains
  FOR DELETE USING ((SELECT auth.uid()) IS NOT NULL AND NOT (SELECT is_agent()));

-- 3. public_procurement 시드 (전체 SQL은 docs/seed_public_procurement.sql 참조)
--    실제 DB에는 MCP apply_migration으로 시드 완료됨.
--    수동 재적용 시: UPDATE domains SET positioning_data = '...', reader_data = '...',
--    lexicon_data = '...', class_markdown = '...' WHERE domain_code = 'public_procurement';
