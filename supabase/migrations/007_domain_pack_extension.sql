-- ============================================================
-- Migration 007: Domain Pack & STP/4C Extension (Ontology v2)
-- ============================================================
-- * domains 마스터 테이블 (도메인 패키지 메타)
-- * blog_posts: domain_id, search_intent, jtbd_type, positioning_attribute 컬럼 추가
-- * axiom_stats: domain_id, axiom_category 컬럼 추가
-- * strategy_recommendations 테이블 (전략 추천 로그)
-- * 분석 뷰 2개 (domain × axiom, 전략 추천 정확도)
-- * 1A 백필: 기존 글들을 public_procurement 도메인에 자동 할당
-- ============================================================

-- 1. domains 마스터 테이블 ------------------------------------
CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_code TEXT UNIQUE NOT NULL,
  domain_name TEXT NOT NULL,
  positioning_benefit TEXT NOT NULL CHECK (positioning_benefit IN ('안전','신속','심층','동반','독창')),
  package_path TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_code ON domains(domain_code);
CREATE INDEX IF NOT EXISTS idx_domains_active ON domains(is_active);

ALTER TABLE domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY domains_authenticated_read ON domains
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
-- write는 service_role 전용 (정책 없음)

DROP TRIGGER IF EXISTS trigger_domains_updated_at ON domains;
CREATE TRIGGER trigger_domains_updated_at
  BEFORE UPDATE ON domains
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 2. blog_posts 확장 -----------------------------------------
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS domain_id UUID REFERENCES domains(id) ON DELETE SET NULL;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS search_intent TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS jtbd_type TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS positioning_attribute TEXT;

CREATE INDEX IF NOT EXISTS idx_blog_posts_domain ON blog_posts(domain_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_intent ON blog_posts(search_intent);
CREATE INDEX IF NOT EXISTS idx_blog_posts_jtbd ON blog_posts(jtbd_type);

-- 3. axiom_stats 확장 ----------------------------------------
ALTER TABLE axiom_stats ADD COLUMN IF NOT EXISTS domain_id UUID REFERENCES domains(id) ON DELETE SET NULL;
ALTER TABLE axiom_stats ADD COLUMN IF NOT EXISTS axiom_category TEXT;

UPDATE axiom_stats SET axiom_category = 'algorithm' WHERE axiom_category IS NULL;

CREATE INDEX IF NOT EXISTS idx_axiom_stats_domain ON axiom_stats(domain_id);
CREATE INDEX IF NOT EXISTS idx_axiom_stats_category ON axiom_stats(axiom_category);

-- 4. strategy_recommendations 테이블 -------------------------
CREATE TABLE IF NOT EXISTS strategy_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  input_l_level TEXT NOT NULL,
  input_intent TEXT NOT NULL,
  input_jtbd TEXT NOT NULL,
  recommended_strategy INT NOT NULL,
  user_selected_strategy INT NOT NULL,
  matched BOOLEAN GENERATED ALWAYS AS (recommended_strategy = user_selected_strategy) STORED,
  recommendation_score JSONB,
  reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_post ON strategy_recommendations(post_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_user ON strategy_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_matched ON strategy_recommendations(matched);

ALTER TABLE strategy_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY strategy_recommendations_owner_all ON strategy_recommendations
  FOR ALL
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND NOT (SELECT is_agent()));

-- 5. 도메인별 공리 통과율 분석 뷰 -----------------------------
CREATE OR REPLACE VIEW v_domain_axiom_stats
WITH (security_invoker = true) AS
SELECT
  d.domain_code,
  d.domain_name,
  ax.axiom_category,
  ax.axiom_number,
  ax.axiom_rule,
  COUNT(*) AS total_checks,
  SUM(CASE WHEN ax.passed THEN 1 ELSE 0 END) AS passed_count,
  ROUND(SUM(CASE WHEN ax.passed THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS pass_rate_pct
FROM axiom_stats ax
LEFT JOIN domains d ON ax.domain_id = d.id
GROUP BY d.domain_code, d.domain_name, ax.axiom_category, ax.axiom_number, ax.axiom_rule
ORDER BY d.domain_code NULLS LAST, ax.axiom_category, pass_rate_pct ASC;

-- 6. 전략 추천 정확도 분석 뷰 ---------------------------------
CREATE OR REPLACE VIEW v_strategy_recommendation_accuracy
WITH (security_invoker = true) AS
SELECT
  d.domain_code,
  sr.recommended_strategy,
  COUNT(*) AS total_recommendations,
  SUM(CASE WHEN sr.matched THEN 1 ELSE 0 END) AS matched_count,
  ROUND(SUM(CASE WHEN sr.matched THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS accuracy_pct
FROM strategy_recommendations sr
LEFT JOIN domains d ON sr.domain_id = d.id
GROUP BY d.domain_code, sr.recommended_strategy
ORDER BY d.domain_code NULLS LAST, accuracy_pct DESC;

-- 7. 첫 도메인 시드 ------------------------------------------
INSERT INTO domains (domain_code, domain_name, positioning_benefit, package_path)
VALUES (
  'public_procurement',
  '공공조달·정책자금',
  '안전',
  'web/domain_packs/public_procurement'
)
ON CONFLICT (domain_code) DO NOTHING;

-- 8. 1A 백필 — 기존 blog_posts / axiom_stats 자동 할당 ----------
UPDATE blog_posts
SET domain_id = (SELECT id FROM domains WHERE domain_code = 'public_procurement')
WHERE domain_id IS NULL;

UPDATE axiom_stats
SET domain_id = (SELECT bp.domain_id FROM blog_posts bp WHERE bp.id = axiom_stats.post_id)
WHERE domain_id IS NULL;
