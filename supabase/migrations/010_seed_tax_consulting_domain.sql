-- ============================================================
-- Migration 010: 두 번째 도메인 시드 (tax_consulting / 세무·절세)
-- ============================================================
-- * 카드 디자인 차별화 — teal 톤 (#0F766E, 회계·신뢰 연상)
--   (정부지원 navy 와 시각적 구분)
-- * differentiating_benefit = '안전' (가산세·세무조사 리스크 회피)
-- * domain_packs/tax_consulting/ 디렉토리는 더 이상 만들지 않음 (DB-only)
--
-- ★ 전체 INSERT/UPDATE SQL은 너무 길어서 별도 파일로 분리.
--   실제 DB 적용은 MCP apply_migration으로 완료됨.
--   재적용 필요 시 docs/seed_tax_consulting.sql 참조 (또는 git history).
-- ============================================================

-- 1) 도메인 행 추가 ----------------------------------------------
INSERT INTO domains (domain_code, domain_name, positioning_benefit, package_path, is_active)
VALUES (
  'tax_consulting',
  '세무·절세',
  '안전',
  'web/domain_packs/tax_consulting',
  true
)
ON CONFLICT (domain_code) DO NOTHING;

-- 2) JSONB 데이터 시드 ------------------------------------------
-- positioning_data, reader_data, lexicon_data, class_markdown, card_design
-- (긴 JSONB 본문은 MCP 적용 시 함께 실행됨 — 가독성 위해 본문 생략)

-- 핵심 값 요약:
--   positioning.differentiating_benefit = '안전'
--   positioning.core_answer_type = '자가진단 체크리스트'
--   reader.L1~L4 pains/triggers + 5 intents + 5 jtbds
--   lexicon.terms 14개 (가산세, 비과세, 면세, 환급, 종합소득세, 법인세, 부가세, 원천세, 간이/일반과세, 성실신고, 세액공제/감면, 경정청구)
--   lexicon.confusables 5개 (비과세 vs 면세, 간이 vs 일반, 종소세 vs 법인세, 가산세 vs 가산금, 세액공제 vs 감면)
--   lexicon.forbidden 5개, recommended 6개
--   class_markdown: 세금 종류 / 절세 방법 / 신고 의무 / 제외요건/위험 / 컨설팅톤 + Relation
--   card_design: teal #0F766E / #134E4A 그라데이션
