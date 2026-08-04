import { getServerSupabase } from "@/lib/supabase-server";
import { USD_TO_KRW } from "@/lib/llm-pricing";
import { Wallet, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

interface LlmUsageRow {
  llm_provider: string | null;
  llm_model: string | null;
  post_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  first_used_at: string | null;
  last_used_at: string | null;
}

interface RecentPost {
  id: string;
  title: string | null;
  main_keyword: string;
  method_id: number;
  body_char_count: number | null;
  axiom_passed: number | null;
  axiom_total: number | null;
  axiom_pass_rate: string | null;
  needs_human_review: boolean;
  created_at: string;
  published_at: string | null;
}

interface WeekSummary {
  week: string;
  method_id: number;
  total_generated: number;
  total_published: number;
  avg_char_count: number | null;
  avg_axiom_pass_rate_pct: number | null;
}

interface DomainAxiomRow {
  domain_code: string | null;
  domain_name: string | null;
  axiom_category: string | null;
  axiom_number: number | null;
  axiom_rule: string | null;
  total_checks: number;
  passed_count: number;
  pass_rate_pct: number;
}

interface RecommendationAccuracyRow {
  domain_code: string | null;
  recommended_strategy: number;
  total_recommendations: number;
  matched_count: number;
  accuracy_pct: number;
}

export default async function StatsPage() {
  const sb = getServerSupabase();

  const [postsRes, weeklyRes, domainAxiomRes, recAccRes, usageRes] = await Promise.all([
    sb
      .from("blog_posts")
      .select(
        "id, title, main_keyword, method_id, body_char_count, axiom_passed, axiom_total, axiom_pass_rate, needs_human_review, created_at, published_at",
      )
      .order("created_at", { ascending: false })
      .limit(20),
    sb.from("v_weekly_performance").select("*").limit(12),
    // v2 — 도메인별 공리 통과율 (낮은 통과율부터 보여줌)
    sb.from("v_domain_axiom_stats").select("*").limit(50),
    // v2 — 전략 추천 정확도
    sb.from("v_strategy_recommendation_accuracy").select("*").limit(20),
    // 모델별 누적 토큰/비용 (마이그레이션 013)
    sb.from("v_llm_usage_by_model").select("*"),
  ]);

  const posts = (postsRes.data ?? []) as RecentPost[];
  const weekly = (weeklyRes.data ?? []) as WeekSummary[];
  const domainAxioms = (domainAxiomRes.data ?? []) as DomainAxiomRow[];
  const recAccs = (recAccRes.data ?? []) as RecommendationAccuracyRow[];
  const llmUsage = (usageRes.data ?? []) as LlmUsageRow[];
  const usageTotalUsd = llmUsage.reduce((sum, r) => sum + Number(r.total_cost_usd ?? 0), 0);
  const usageTotalKrw = Math.round(usageTotalUsd * USD_TO_KRW);
  const loadError = postsRes.error || weeklyRes.error;

  const totals = {
    generated: posts.length,
    published: posts.filter((p) => p.published_at).length,
    needsReview: posts.filter((p) => p.needs_human_review).length,
    avgAxiom:
      posts.length > 0
        ? posts.reduce(
            (acc, p) =>
              p.axiom_total && p.axiom_passed !== null
                ? acc + p.axiom_passed / p.axiom_total
                : acc,
            0,
          ) / posts.length
        : 0,
  };

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">통계 대시보드</h1>
          <p className="text-sm text-neutral-500 mt-1">
            최근 생성 이력 · 공리 통과율 · 주간 성과
          </p>
        </header>

        {loadError && (
          <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm text-amber-800">
            Supabase 조회 실패: {loadError.message}. 마이그레이션이 적용되었는지
            확인해주세요 (supabase/migrations/).
          </div>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="최근 생성" value={totals.generated} />
          <Stat label="발행됨" value={totals.published} />
          <Stat
            label="수동 검토 필요"
            value={totals.needsReview}
            tone={totals.needsReview > 0 ? "warn" : "ok"}
          />
          <Stat
            label="평균 공리 통과율"
            value={`${(totals.avgAxiom * 100).toFixed(0)}%`}
          />
        </section>

        {/* 모델별 토큰·비용 누적 */}
        <section className="bg-white border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold inline-flex items-center gap-2">
              <Wallet className="w-5 h-5 text-neutral-700" />
              LLM 사용량 (모델별 누적)
            </h2>
            {llmUsage.length > 0 && (
              <span className="text-xs text-neutral-500">
                전체 합계 ${usageTotalUsd.toFixed(4)} (약 ₩{usageTotalKrw.toLocaleString("ko-KR")})
              </span>
            )}
          </div>
          {llmUsage.length === 0 ? (
            <p className="text-sm text-neutral-400">
              아직 토큰 사용 기록이 없습니다 (마이그레이션 013 적용 이후 생성된 글만 집계됨).
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-neutral-500 border-b text-xs">
                  <th className="px-2 py-2">Provider</th>
                  <th className="px-2 py-2">모델</th>
                  <th className="px-2 py-2 text-right">생성 글 수</th>
                  <th className="px-2 py-2 text-right">입력 토큰</th>
                  <th className="px-2 py-2 text-right">출력 토큰</th>
                  <th className="px-2 py-2 text-right">USD</th>
                  <th className="px-2 py-2 text-right">KRW</th>
                  <th className="px-2 py-2 text-right">최근 사용</th>
                </tr>
              </thead>
              <tbody>
                {llmUsage
                  .slice()
                  .sort((a, b) => Number(b.total_cost_usd) - Number(a.total_cost_usd))
                  .map((r, i) => {
                    const usd = Number(r.total_cost_usd ?? 0);
                    return (
                      <tr key={i} className="border-b">
                        <td className="px-2 py-2 text-xs font-medium">{r.llm_provider}</td>
                        <td className="px-2 py-2 text-xs font-mono">{r.llm_model ?? "(unknown)"}</td>
                        <td className="px-2 py-2 text-right">{r.post_count}</td>
                        <td className="px-2 py-2 text-right text-neutral-600">
                          {Number(r.total_input_tokens).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right text-neutral-600">
                          {Number(r.total_output_tokens).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right font-medium">
                          ${usd.toFixed(4)}
                        </td>
                        <td className="px-2 py-2 text-right text-neutral-700">
                          ₩{Math.round(usd * USD_TO_KRW).toLocaleString("ko-KR")}
                        </td>
                        <td className="px-2 py-2 text-right text-xs text-neutral-500">
                          {r.last_used_at ? new Date(r.last_used_at).toLocaleDateString("ko-KR") : "-"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            </div>
          )}
          <p className="text-xs text-neutral-400 mt-2">
            ※ 단가는 lib/llm-pricing.ts 기준 · USD/KRW = {USD_TO_KRW} 고정 환율 ·
            모델 단가표에 없으면 cost_usd = NULL 로 저장되어 합계에서 제외됨
          </p>
        </section>

        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-3">주간 성과</h2>
          {weekly.length === 0 ? (
            <p className="text-sm text-neutral-400">데이터 없음</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-neutral-500 border-b">
                  <th className="px-2 py-2">주차</th>
                  <th className="px-2 py-2">방식</th>
                  <th className="px-2 py-2 text-right">생성</th>
                  <th className="px-2 py-2 text-right">발행</th>
                  <th className="px-2 py-2 text-right">평균 글자</th>
                  <th className="px-2 py-2 text-right">공리 통과율</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((w, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-2">{w.week?.slice(0, 10)}</td>
                    <td className="px-2 py-2">M{w.method_id}</td>
                    <td className="px-2 py-2 text-right">{w.total_generated}</td>
                    <td className="px-2 py-2 text-right">{w.total_published}</td>
                    <td className="px-2 py-2 text-right">
                      {w.avg_char_count ? Math.round(w.avg_char_count) : "-"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {w.avg_axiom_pass_rate_pct
                        ? `${w.avg_axiom_pass_rate_pct}%`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>

        {/* v2 — 도메인 × 공리 카테고리 통과율 */}
        <section className="bg-white border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">도메인 × 공리 통과율 (Ontology v2)</h2>
            <span className="text-xs text-neutral-500">통과율 낮은 순</span>
          </div>
          {domainAxioms.length === 0 ? (
            <p className="text-sm text-neutral-400">아직 v2 데이터 없음 (도메인 지정해서 글 한 개라도 생성하면 채워짐)</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-neutral-500 border-b text-xs">
                  <th className="px-2 py-2 w-32">도메인</th>
                  <th className="px-2 py-2 w-20">카테고리</th>
                  <th className="px-2 py-2 w-12 text-center">번호</th>
                  <th className="px-2 py-2">공리</th>
                  <th className="px-2 py-2 text-right w-20">전체</th>
                  <th className="px-2 py-2 text-right w-20">통과</th>
                  <th className="px-2 py-2 text-right w-20">통과율</th>
                </tr>
              </thead>
              <tbody>
                {domainAxioms.map((r, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-2 text-xs">{r.domain_code ?? "(미지정)"}</td>
                    <td className="px-2 py-2 text-xs">
                      <CategoryBadge category={r.axiom_category} />
                    </td>
                    <td className="px-2 py-2 text-center text-neutral-500">{r.axiom_number ?? "-"}</td>
                    <td className="px-2 py-2 text-xs truncate" title={r.axiom_rule ?? ""}>
                      {r.axiom_rule ?? ""}
                    </td>
                    <td className="px-2 py-2 text-right text-neutral-600">{r.total_checks}</td>
                    <td className="px-2 py-2 text-right text-neutral-600">{r.passed_count}</td>
                    <td
                      className={`px-2 py-2 text-right font-medium ${
                        r.pass_rate_pct >= 100
                          ? "text-green-700"
                          : r.pass_rate_pct >= 80
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}
                    >
                      {r.pass_rate_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </section>

        {/* v2 — 추천 정확도 */}
        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Strategy Recommender 정확도 (도메인 × 추천 방식)</h2>
          {recAccs.length === 0 ? (
            <p className="text-sm text-neutral-400">아직 추천 로그 없음 (intent/JTBD 지정해서 글 생성하면 자동 기록)</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-neutral-500 border-b text-xs">
                  <th className="px-2 py-2">도메인</th>
                  <th className="px-2 py-2">추천 방식</th>
                  <th className="px-2 py-2 text-right">총 추천</th>
                  <th className="px-2 py-2 text-right">사용자 채택</th>
                  <th className="px-2 py-2 text-right">정확도</th>
                </tr>
              </thead>
              <tbody>
                {recAccs.map((r, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-2">{r.domain_code ?? "(미지정)"}</td>
                    <td className="px-2 py-2">M{r.recommended_strategy}</td>
                    <td className="px-2 py-2 text-right">{r.total_recommendations}</td>
                    <td className="px-2 py-2 text-right">{r.matched_count}</td>
                    <td
                      className={`px-2 py-2 text-right font-medium ${
                        r.accuracy_pct >= 80
                          ? "text-green-700"
                          : r.accuracy_pct >= 50
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}
                    >
                      {r.accuracy_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          <p className="text-xs text-neutral-400 mt-2">
            정확도가 낮으면 → 추천 룰(STRATEGY_MAPPINGS) 또는 사용자 좌표 입력 패턴을 점검하세요.
          </p>
        </section>

        <section className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold mb-3">최근 생성 20건</h2>
          {posts.length === 0 ? (
            <p className="text-sm text-neutral-400">아직 생성된 글이 없습니다.</p>
          ) : (
            <ul className="divide-y">
              {posts.map((p) => (
                <li key={p.id} className="py-3 flex items-start gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {p.title || "(제목 없음)"}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      M{p.method_id} · {p.main_keyword} · {p.body_char_count ?? 0}자
                      {p.needs_human_review && (
                        <span className="ml-2 text-red-600 font-medium inline-flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" />
                          검토 필요
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-xs text-neutral-500 whitespace-nowrap">
                    {p.axiom_pass_rate && <div>공리 {p.axiom_pass_rate}</div>}
                    <div>{new Date(p.created_at).toLocaleDateString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return <span className="text-neutral-400">-</span>;
  const styles: Record<string, string> = {
    algorithm: "bg-blue-50 text-blue-700",
    "4c": "bg-green-50 text-green-700",
    brand_voice: "bg-purple-50 text-purple-700",
  };
  const cls = styles[category] ?? "bg-neutral-100 text-neutral-600";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{category}</span>;
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "ok" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "text-red-600"
      : tone === "ok"
        ? "text-green-700"
        : "text-neutral-900";
  return (
    <div className="border rounded-lg p-4 bg-white">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}
