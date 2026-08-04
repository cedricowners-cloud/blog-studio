-- ============================================================
-- Migration 011: 세 번째 도메인 시드 (corp_management / 법인설립·경영)
-- ============================================================
-- * 카드 디자인: slate 톤 (#334155, 보수적·법무 권위감)
-- * differentiating_benefit = '안전' (등기 반려·과태료·임원 분쟁 리스크 회피)
-- * core_answer_type = '단계별 체크리스트' (다른 두 도메인은 자가진단 체크리스트)
--
-- 본문 INSERT/UPDATE SQL은 MCP apply_migration 으로 적용됨.
-- ============================================================

INSERT INTO domains (domain_code, domain_name, positioning_benefit, package_path, is_active)
VALUES (
  'corp_management',
  '법인설립·경영',
  '안전',
  'web/domain_packs/corp_management',
  true
)
ON CONFLICT (domain_code) DO NOTHING;

-- positioning_data, reader_data, lexicon_data, class_markdown, card_design
-- (긴 JSONB 본문은 MCP 적용 시 함께 실행됨 — git history 참조)

-- 핵심 값 요약:
--   positioning.target_audience = '법인 설립·운영을 검토 중이거나 초기 단계인 SME 대표 (예비~5년차)'
--   positioning.differentiating_benefit = '안전'
--   positioning.core_answer_type = '단계별 체크리스트'
--   reader.L1~L4 + 5 intents + 5 jtbds
--   lexicon.terms 14개 (주식회사, 유한회사, 정관, 자본금, 등기부, 대표이사, 이사회, 주주총회, 변경등기, 과태료, 본점, 신주발행, 주식양도, 청산)
--   lexicon.confusables 5개, forbidden 5개, recommended 6개
--   class_markdown: 법인 형태 / 등기 사항 / 의무 일정 / 제외요건/위험 / 컨설팅톤 + Relation
--   card_design: slate #334155 / #0F172A 그라데이션
