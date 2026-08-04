-- ============================================================
-- Migration 009: Card News Design (도메인별 카드뉴스 디자인 설정)
-- ============================================================
-- * domains.card_design JSONB 컬럼 추가
-- * 구조: { brand_name, colors{...}, mood, font_family }
-- * public_procurement 시드: 현재 navy 톤 그대로 (카드 디자인 무난)
-- ============================================================

ALTER TABLE domains ADD COLUMN IF NOT EXISTS card_design JSONB;

-- 시드는 MCP apply_migration 으로 함께 적용됨 (public_procurement → navy 톤)
-- 수동 재적용 시:
-- UPDATE domains SET card_design = '{...}' WHERE domain_code = 'public_procurement';
