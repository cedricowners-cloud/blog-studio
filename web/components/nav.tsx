"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase";

const NAV_ITEMS = [
  { href: "/", label: "홈" },
  { href: "/keywords", label: "키워드" },
  { href: "/rank-tracker", label: "순위추적" },
  { href: "/seo-write", label: "SEO 글쓰기" },
  { href: "/generate", label: "글 생성" },
  { href: "/posts", label: "내 글" },
  { href: "/cards", label: "카드뉴스" },
  { href: "/images", label: "이미지" },
  { href: "/domains", label: "도메인" },
  { href: "/stats", label: "통계" },
  { href: "/settings", label: "설정" },
];

const HIDDEN_PATHS = ["/login", "/auth"];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const sb = getBrowserSupabase();
    sb.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 경로가 바뀌면 모바일 메뉴 자동 닫기
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (HIDDEN_PATHS.some((p) => pathname.startsWith(p))) return null;

  async function signOut() {
    const sb = getBrowserSupabase();
    await sb.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const items = NAV_ITEMS.filter((i) => i.href !== "/");
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="border-b bg-white sticky top-0 z-40">
      <div className="max-w-[1400px] mx-auto px-4 h-12 flex items-center gap-1">
        <Link
          href="/"
          className="text-sm font-bold mr-2 sm:mr-4 text-neutral-900 hover:text-brand"
        >
          blog_studio
        </Link>

        {/* 데스크톱 메뉴 — md 이상에서만 표시 */}
        <div className="hidden md:flex gap-1 flex-1 overflow-hidden">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded text-sm transition whitespace-nowrap ${
                isActive(item.href)
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* 모바일에서는 햄버거 버튼이 flex-1 자리 차지 (오른쪽 끝으로 sign out 밀기) */}
        <div className="flex-1 md:hidden" />

        {email && (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="hidden lg:inline">{email}</span>
            <button
              onClick={signOut}
              className="border rounded px-2 py-1 hover:bg-neutral-50 hidden sm:inline-block"
            >
              로그아웃
            </button>
          </div>
        )}

        {/* 모바일 햄버거 */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="md:hidden border rounded p-1.5 ml-1 hover:bg-neutral-50"
          aria-label={mobileOpen ? "메뉴 닫기" : "메뉴 열기"}
        >
          {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      {/* 모바일 드로어 */}
      {mobileOpen && (
        <div className="md:hidden border-t bg-white">
          <ul className="max-w-[1400px] mx-auto px-4 py-2 grid grid-cols-2 gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block px-3 py-2 rounded text-sm transition ${
                    isActive(item.href)
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {email && (
              <li className="col-span-2 border-t mt-1 pt-2 flex items-center justify-between text-xs text-neutral-500 px-3">
                <span className="truncate">{email}</span>
                <button
                  onClick={signOut}
                  className="border rounded px-2 py-1 hover:bg-neutral-50"
                >
                  로그아웃
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </nav>
  );
}
