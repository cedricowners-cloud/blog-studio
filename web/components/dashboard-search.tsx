"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 대시보드 상단의 즉시 키워드 검색.
 * Enter 또는 버튼 클릭 → /keywords?q=... 로 이동.
 */
export function DashboardSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    router.push(`/keywords?q=${encodeURIComponent(v)}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2 max-w-2xl">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="키워드 검색 (예: 종합소득세, 절세, 종합소득세 신고)"
        className="flex-1 border border-neutral-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-neutral-900 transition"
        autoFocus
      />
      <button
        type="submit"
        disabled={!q.trim()}
        className="bg-neutral-900 text-white text-sm rounded-lg px-5 font-medium disabled:opacity-40 hover:bg-neutral-800 transition"
      >
        검색 →
      </button>
    </form>
  );
}
