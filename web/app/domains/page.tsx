"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase";
import {
  listDomains,
  createDomain,
  deactivateDomain,
  type DomainRow,
} from "@/lib/ontology/domain-loader";

export default function DomainsListPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<DomainRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  async function reload() {
    setError(null);
    try {
      const sb = getBrowserSupabase();
      const list = await listDomains(sb);
      setDomains(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;
    if (!/^[a-z0-9_]+$/.test(newCode.trim())) {
      alert("도메인 코드는 영문 소문자·숫자·밑줄(_)만 가능합니다.");
      return;
    }
    setCreating(true);
    try {
      const sb = getBrowserSupabase();
      await createDomain(sb, { domain_code: newCode.trim(), domain_name: newName.trim() });
      router.push(`/domains/${newCode.trim()}/edit`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function onDeactivate(code: string, name: string) {
    if (!confirm(`도메인 "${name}" 을 비활성화할까요?\n\n비활성화하면 글 생성 시 선택지에서 사라집니다 (기존 글은 유지).`)) return;
    try {
      const sb = getBrowserSupabase();
      await deactivateDomain(sb, code);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-bold">도메인</h1>
          <p className="text-xs text-neutral-500 mt-1">
            글 생성 시 선택할 도메인 (정부지원사업·세무·법인경영 등). 각 도메인의 포지셔닝·독자 페르소나·어휘집을 편집해 모든 글의 톤을 일관시킴.
          </p>
        </header>

        {/* 새 도메인 생성 */}
        <section className="bg-white border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-2">+ 새 도메인 생성</h2>
          <form onSubmit={onCreate} className="grid sm:grid-cols-[160px_1fr_auto] gap-2 items-end">
            <label className="block">
              <span className="text-xs text-neutral-500">코드 (영문 소문자, 예: tax)</span>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toLowerCase())}
                placeholder="tax_consulting"
                className="mt-1 w-full border rounded px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-neutral-500">표시명 (한국어)</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="세무·절세"
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={creating || !newCode.trim() || !newName.trim()}
              className="bg-brand text-white text-sm rounded px-4 py-2 disabled:opacity-40"
            >
              {creating ? "생성 중..." : "생성"}
            </button>
          </form>
          <p className="text-xs text-neutral-400 mt-2">
            생성하면 빈 템플릿으로 시작 → 편집 페이지로 이동
          </p>
        </section>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 목록 */}
        <section className="bg-white border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-neutral-50 border-b text-neutral-600 text-left text-xs">
              <tr>
                <th className="px-3 py-2 w-40">코드</th>
                <th className="px-3 py-2">표시명</th>
                <th className="px-3 py-2 w-24">차별 편익</th>
                <th className="px-3 py-2 w-32">생성일</th>
                <th className="px-3 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {domains === null && (
                <tr>
                  <td colSpan={5} className="text-center text-neutral-400 py-8">불러오는 중...</td>
                </tr>
              )}
              {domains !== null && domains.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-neutral-400 py-8">
                    활성 도메인이 없습니다. 위에서 새로 생성하세요.
                  </td>
                </tr>
              )}
              {(domains ?? []).map((d) => {
                const benefit = d.positioning_data?.differentiating_benefit ?? "(미설정)";
                return (
                  <tr key={d.id} className="border-b hover:bg-neutral-50">
                    <td className="px-3 py-2 font-mono text-neutral-700">{d.domain_code}</td>
                    <td className="px-3 py-2">
                      <Link href={`/domains/${d.domain_code}/edit`} className="font-medium hover:underline">
                        {d.domain_name}
                      </Link>
                      {!d.positioning_data && (
                        <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          설정 비어있음
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block bg-brand-50 text-brand text-xs rounded px-2 py-0.5 font-medium">
                        {benefit}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      {new Date(d.created_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/domains/${d.domain_code}/edit`} className="text-xs text-brand hover:underline mr-3">
                        편집
                      </Link>
                      <button
                        onClick={() => onDeactivate(d.domain_code, d.domain_name)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        비활성화
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
