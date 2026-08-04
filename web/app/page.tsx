import Link from "next/link";
import {
  Search,
  BarChart3,
  PenLine,
  Zap,
  Newspaper,
  LayoutGrid,
  Image as ImageIcon,
  Tag,
  TrendingUp,
  Settings,
  Rocket,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { getServerSupabase } from "@/lib/supabase-server";
import { USD_TO_KRW } from "@/lib/llm-pricing";
import { DashboardSearch } from "@/components/dashboard-search";

export const dynamic = "force-dynamic";

interface RecentPost {
  id: string;
  title: string | null;
  main_keyword: string;
  body_char_count: number | null;
  axiom_pass_rate: string | null;
  needs_human_review: boolean;
  created_at: string;
}

interface InProgressRun {
  id: string;
  main_keyword: string;
  platform: "naver_blog" | "custom_domain";
  mode: "api" | "copy";
  current_step_index: number;
  updated_at: string;
}

interface WeeklyAggregate {
  posts_count: number;
  total_cost_usd: number;
  avg_pass_rate: number | null;
}

const QUICK_ACTIONS = [
  { href: "/keywords", Icon: Search, title: "키워드 분석", desc: "검색량 · 자동완성 · 트렌드" },
  { href: "/rank-tracker", Icon: BarChart3, title: "순위 추적", desc: "도메인 × 키워드 SERP 체크" },
  { href: "/seo-write", Icon: PenLine, title: "SEO 글쓰기", desc: "강의 8단계 가이드 워크플로" },
  { href: "/generate", Icon: Zap, title: "글 빠른 생성", desc: "Ontology v2 · 6가지 SEO 방식" },
  { href: "/posts", Icon: Newspaper, title: "내 글", desc: "생성한 모든 글 관리" },
  { href: "/cards", Icon: LayoutGrid, title: "카드뉴스", desc: "본문 → PNG 카드 변환" },
  { href: "/images", Icon: ImageIcon, title: "이미지", desc: "무료 스톡 · AI 생성" },
  { href: "/domains", Icon: Tag, title: "도메인 관리", desc: "포지셔닝 · 어휘집 · 카드 디자인" },
  { href: "/stats", Icon: TrendingUp, title: "통계", desc: "공리 통과율 · 모델별 비용" },
  { href: "/settings", Icon: Settings, title: "설정", desc: "API 키 · 기본 모델" },
];

export default async function DashboardPage() {
  const sb = getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();

  // 미인증 사용자는 간단한 안내만 (로그인 미들웨어가 가로채는 경우 도달 X)
  if (!user) {
    return (
      <main className="min-h-screen p-6 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">blog_studio</h1>
          <p className="text-sm text-neutral-500">로그인이 필요합니다.</p>
        </div>
      </main>
    );
  }

  // 병렬 데이터 조회
  const [recentPostsRes, inProgressRunsRes, weeklyRes] = await Promise.all([
    sb
      .from("blog_posts")
      .select(
        "id, title, main_keyword, body_char_count, axiom_pass_rate, needs_human_review, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(5),
    sb
      .from("seo_workflow_runs")
      .select("id, main_keyword, platform, mode, current_step_index, updated_at")
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(3),
    sb
      .from("blog_posts")
      .select("axiom_passed, axiom_total, cost_usd")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const recentPosts = (recentPostsRes.data ?? []) as RecentPost[];
  const inProgressRuns = (inProgressRunsRes.data ?? []) as InProgressRun[];
  const weeklyRows = (weeklyRes.data ?? []) as Array<{
    axiom_passed: number | null;
    axiom_total: number | null;
    cost_usd: number | null;
  }>;

  const weekly: WeeklyAggregate = {
    posts_count: weeklyRows.length,
    total_cost_usd: weeklyRows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
    avg_pass_rate: (() => {
      const valid = weeklyRows.filter(
        (r) => r.axiom_passed !== null && r.axiom_total !== null && r.axiom_total > 0,
      );
      if (valid.length === 0) return null;
      const sum = valid.reduce(
        (s, r) => s + (r.axiom_passed ?? 0) / (r.axiom_total ?? 1),
        0,
      );
      return (sum / valid.length) * 100;
    })(),
  };

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        {/* 헤더 + 즉시 검색 */}
        <header className="space-y-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">blog_studio</h1>
            <p className="text-xs sm:text-sm text-neutral-500 mt-1">
              키워드 발굴 → SEO 글쓰기 → 카드뉴스 → 발행까지 한 곳에서
            </p>
          </div>
          <DashboardSearch />
        </header>

        {/* 이번 주 활동 요약 */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="이번 주 생성" value={`${weekly.posts_count}건`} />
          <Stat
            label="이번 주 LLM 비용 (USD)"
            value={`$${weekly.total_cost_usd.toFixed(3)}`}
          />
          <Stat
            label="이번 주 LLM 비용 (KRW)"
            value={`₩${Math.round(weekly.total_cost_usd * USD_TO_KRW).toLocaleString("ko-KR")}`}
          />
          <Stat
            label="평균 공리 통과율"
            value={
              weekly.avg_pass_rate !== null ? `${weekly.avg_pass_rate.toFixed(0)}%` : "-"
            }
          />
        </section>

        {/* 진행 중인 SEO 워크플로 */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold inline-flex items-center gap-2">
              <PenLine className="w-5 h-5 text-neutral-700" />
              진행 중인 SEO 워크플로
            </h2>
            <Link
              href="/seo-write"
              className="text-xs text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-0.5"
            >
              전체 보기 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {inProgressRuns.length === 0 ? (
            <div className="bg-white border rounded-lg p-6 text-center">
              <p className="text-sm text-neutral-500 mb-1">
                진행 중인 SEO 워크플로가 없습니다.
              </p>
              <p className="text-xs text-neutral-400 mb-3">
                먼저 키워드를 분석해서 메인 키워드를 고른 뒤 시작하세요.
              </p>
              <Link
                href="/keywords"
                className="inline-flex items-center gap-1.5 bg-neutral-900 text-white text-sm rounded px-4 py-2 hover:bg-neutral-800"
              >
                <Search className="w-4 h-4" />
                키워드 분석부터 시작
              </Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {inProgressRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/seo-write/${r.id}`}
                  className="bg-white border rounded-lg p-4 hover:border-neutral-900 transition group"
                >
                  <div className="text-sm font-medium truncate group-hover:text-brand">
                    {r.main_keyword}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    {r.platform === "naver_blog" ? "네이버" : "자체 도메인"} ·{" "}
                    {r.mode === "api" ? "API" : "복사"} 모드
                  </div>
                  <div className="text-xs text-neutral-400 mt-2">
                    {r.current_step_index + 1}단계 진행 중 ·{" "}
                    {new Date(r.updated_at).toLocaleDateString("ko-KR")}
                  </div>
                  <div className="text-xs text-brand mt-2 group-hover:underline inline-flex items-center gap-0.5">
                    이어가기 <ArrowRight className="w-3 h-3" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 빠른 액션 */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Rocket className="w-5 h-5 text-neutral-700" />
            빠른 액션
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {QUICK_ACTIONS.map((a) => {
              const Icon = a.Icon;
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  className="bg-white border rounded-lg p-3 hover:border-neutral-900 transition"
                >
                  <Icon className="w-6 h-6 text-neutral-700" strokeWidth={1.75} />
                  <div className="text-sm font-medium mt-2">{a.title}</div>
                  <div className="text-[11px] text-neutral-500 mt-0.5">{a.desc}</div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* 최근 글 */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold inline-flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-neutral-700" />
              최근 생성한 글
            </h2>
            <Link
              href="/posts"
              className="text-xs text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-0.5"
            >
              전체 보기 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {recentPosts.length === 0 ? (
            <div className="bg-white border rounded-lg p-6 text-center">
              <p className="text-sm text-neutral-500 mb-3">
                아직 생성한 글이 없습니다.
              </p>
              <div className="flex justify-center gap-2">
                <Link
                  href="/keywords"
                  className="bg-neutral-900 text-white text-sm rounded px-4 py-2 hover:bg-neutral-800 inline-flex items-center gap-1.5"
                >
                  <Search className="w-4 h-4" />
                  키워드 분석부터 시작
                </Link>
                <Link
                  href="/generate"
                  className="border border-neutral-300 text-sm rounded px-4 py-2 hover:bg-neutral-50"
                >
                  빠른 글 생성
                </Link>
              </div>
            </div>
          ) : (
            <ul className="bg-white border rounded-lg divide-y">
              {recentPosts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/posts/${p.id}`}
                    className="block px-4 py-3 hover:bg-neutral-50 transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {p.title || "(제목 없음)"}
                        </div>
                        <div className="text-xs text-neutral-500 mt-0.5">
                          {p.main_keyword} · {p.body_char_count ?? 0}자
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
                        <div>{new Date(p.created_at).toLocaleDateString("ko-KR")}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-neutral-900">{value}</div>
    </div>
  );
}
