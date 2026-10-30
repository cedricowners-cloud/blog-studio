"use client";

import { useCallback, useEffect, useState } from "react";

import { getBrowserSupabase } from "@/lib/supabase";
import {
  JOB_STATUS_LABEL,
  addAccount,
  getAgents,
  getJobLogs,
  isAgentOnline,
  listAccounts,
  listRecentJobs,
  removeAccount,
  removeAgent,
  type AgentStatus,
  type JobLog,
  type PublishJob,
} from "@/lib/publish";

export default function AgentPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const sb = getBrowserSupabase();
    const { data: userRes } = await sb.auth.getUser();
    if (!userRes.user) throw new Error("로그인이 필요합니다.");
    setUserId(userRes.user.id);
    const [a, acc, j] = await Promise.all([
      getAgents(sb),
      listAccounts(sb),
      listRecentJobs(sb, 15),
    ]);
    setAgents(a);
    setAccounts(acc);
    setJobs(j);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await refresh();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    // 하트비트 주기(30초)보다 조금 짧게 폴링해 상태가 밀리지 않게 한다.
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refresh]);

  if (loading) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-sm text-neutral-400">불러오는 중...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-3xl mx-auto border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-bold">발행 에이전트</h1>
          <p className="text-xs text-neutral-500 mt-1">
            네이버 발행은 Chrome 자동화가 필요해서 사용자 PC에서 돌아가는 로컬
            에이전트가 담당합니다. 웹은 작업을 큐에 넣고 진행 상황만 보여줍니다.
          </p>
        </header>

        <AgentStatusCard
          agents={agents}
          onChanged={() => refresh().catch(() => {})}
        />
        <AccountsCard
          accounts={accounts}
          userId={userId}
          onChanged={() => refresh().catch(() => {})}
        />
        <PairingCard />
        <JobsCard jobs={jobs} />
      </div>
    </main>
  );
}

function AgentStatusCard({
  agents,
  onChanged,
}: {
  agents: AgentStatus[];
  onChanged: () => void;
}) {
  if (agents.length === 0) {
    return (
      <Card title="에이전트 상태">
        <div className="text-sm text-neutral-600">
          연결된 에이전트가 없습니다. 아래 <b>페어링</b> 안내를 따라 PC에서
          에이전트를 실행하세요.
        </div>
      </Card>
    );
  }

  return (
    <Card title="에이전트 상태">
      <ul className="space-y-2">
        {agents.map((a) => {
          const online = isAgentOnline(a);
          return (
            <li
              key={a.agent_id}
              className="flex items-start justify-between gap-3 border rounded p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      online ? "bg-green-500" : "bg-neutral-300"
                    }`}
                  />
                  <span className="text-sm font-medium truncate">
                    {a.label || a.agent_id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {online ? JOB_STATUS_LABEL_FOR_AGENT[a.status ?? "idle"] : "오프라인"}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">
                  마지막 수신 {formatWhen(a.last_seen)}
                  {a.version ? ` · v${a.version}` : ""}
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  로그인 가능 계정:{" "}
                  {a.accounts && a.accounts.length > 0 ? (
                    a.accounts.join(", ")
                  ) : (
                    <span className="text-amber-700">
                      없음 — 첫 발행 시 브라우저에서 직접 로그인해야 합니다
                    </span>
                  )}
                </div>
              </div>
              {!online && (
                <button
                  onClick={() =>
                    removeAgent(getBrowserSupabase(), a.agent_id)
                      .then(onChanged)
                      .catch(() => {})
                  }
                  className="shrink-0 text-xs text-red-600 hover:underline"
                >
                  목록에서 제거
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const JOB_STATUS_LABEL_FOR_AGENT: Record<string, string> = {
  idle: "대기",
  busy: "작업 중",
  logging_in: "로그인 중",
};

function AccountsCard({
  accounts,
  userId,
  onChanged,
}: {
  accounts: string[];
  userId: string | null;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    if (!userId) return;
    setBusy(true);
    setMsg(null);
    try {
      await addAccount(getBrowserSupabase(), userId, name);
      setName("");
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: string) {
    setBusy(true);
    setMsg(null);
    try {
      await removeAccount(getBrowserSupabase(), account);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="네이버 계정 등록"
      description="여기 등록한 이름으로만 발행 작업을 걸 수 있습니다. 비밀번호는 저장하지 않습니다 — 에이전트가 쿠키로 로그인하고, 쿠키가 없으면 브라우저를 띄워 직접 로그인하게 합니다."
    >
      {accounts.length === 0 ? (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          등록된 계정이 없어 아직 발행할 수 없습니다. 아래에 블로그를 구분할
          이름을 넣어주세요 (예: <code>본계정</code>).
        </div>
      ) : (
        <ul className="divide-y border rounded">
          {accounts.map((a) => (
            <li key={a} className="flex items-center justify-between px-3 py-2">
              <code className="text-sm">{a}</code>
              <button
                onClick={() => remove(a)}
                disabled={busy}
                className="text-xs text-red-600 hover:underline disabled:opacity-40"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="계정 이름 (예: 본계정)"
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !name.trim()}
          className="bg-neutral-900 text-white text-sm rounded px-4 py-2 disabled:opacity-40"
        >
          등록
        </button>
      </div>

      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </Card>
  );
}

function PairingCard() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reveal() {
    setErr(null);
    try {
      const sb = getBrowserSupabase();
      const { data } = await sb.auth.getSession();
      const s = data.session;
      if (!s) throw new Error("세션이 없습니다. 다시 로그인하세요.");
      setToken(
        JSON.stringify(
          { access_token: s.access_token, refresh_token: s.refresh_token },
          null,
          2,
        ),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function copy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card
      title="페어링"
      description="에이전트가 Supabase에 접근할 수 있도록 현재 로그인 세션을 PC로 옮기는 과정입니다."
    >
      <ol className="text-sm space-y-2 list-decimal list-inside text-neutral-700">
        <li>
          PC에서 저장소를 받고 의존성 설치:
          <pre className="mt-1 bg-neutral-50 border rounded p-2 text-xs overflow-x-auto">
{`cd blog_studio/local_agent
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt`}
          </pre>
        </li>
        <li>
          <code>local_agent/.env</code> 에 Supabase 접속 정보 입력:
          <pre className="mt-1 bg-neutral-50 border rounded p-2 text-xs overflow-x-auto">
{`SUPABASE_URL=${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "<프로젝트 URL>"}
SUPABASE_ANON_KEY=<anon key>`}
          </pre>
        </li>
        <li>
          아래 페어링 값을 복사해서{" "}
          <code>./.venv/bin/python -m local_agent.pairing</code> 실행 후 붙여넣기
        </li>
        <li>
          <code>./.venv/bin/python -m local_agent.main</code> 으로 상시 실행
        </li>
        <li className="text-amber-800">
          첫 발행 때는 브라우저 창이 열리고 <b>180초 동안 직접 로그인</b>해야
          합니다. 이후에는 저장된 쿠키로 자동 진행됩니다.
        </li>
      </ol>

      <div className="border-t pt-3 space-y-2">
        {token === null ? (
          <button
            onClick={reveal}
            className="text-sm border rounded px-3 py-1.5 hover:bg-neutral-50"
          >
            페어링 값 보기
          </button>
        ) : (
          <>
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              이 값은 <b>로그인 세션 자체</b>입니다. 내 PC의 에이전트에만
              붙여넣고, 캡처·공유·채팅 전송은 하지 마세요.
            </div>
            <textarea
              readOnly
              value={token}
              rows={5}
              className="w-full border rounded p-2 text-[11px] font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="text-sm border rounded px-3 py-1.5 hover:bg-neutral-50"
              >
                {copied ? "복사됨" : "복사"}
              </button>
              <button
                onClick={() => setToken(null)}
                className="text-sm border rounded px-3 py-1.5 hover:bg-neutral-50"
              >
                숨기기
              </button>
            </div>
          </>
        )}
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </Card>
  );
}

function JobsCard({ jobs }: { jobs: PublishJob[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [logs, setLogs] = useState<JobLog[]>([]);

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setLogs([]);
    try {
      setLogs(await getJobLogs(getBrowserSupabase(), id));
    } catch {
      /* 로그 없으면 빈 상태 유지 */
    }
  }

  if (jobs.length === 0) {
    return (
      <Card title="최근 작업">
        <p className="text-sm text-neutral-500">아직 작업이 없습니다.</p>
      </Card>
    );
  }

  return (
    <Card title="최근 작업">
      <ul className="divide-y border rounded">
        {jobs.map((j) => (
          <li key={j.id}>
            <button
              onClick={() => toggle(j.id)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-neutral-50"
            >
              <div className="min-w-0">
                <div className="text-sm truncate">
                  {(j.payload?.title as string) || j.type}
                </div>
                <div className="text-[11px] text-neutral-500">
                  {j.account_name} · {formatWhen(j.created_at)}
                </div>
              </div>
              <StatusBadge status={j.status} />
            </button>
            {openId === j.id && (
              <div className="px-3 pb-3 space-y-2">
                {j.error_message && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    {j.error_message}
                  </p>
                )}
                {j.result?.post_url && (
                  <a
                    href={j.result.post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-700 hover:underline break-all"
                  >
                    {j.result.post_url}
                  </a>
                )}
                {logs.length === 0 ? (
                  <p className="text-xs text-neutral-400">로그 없음</p>
                ) : (
                  <ul className="space-y-0.5">
                    {logs.map((l) => (
                      <li key={l.id} className="text-[11px] font-mono">
                        <span className="text-neutral-400">
                          {new Date(l.created_at).toLocaleTimeString("ko-KR")}
                        </span>{" "}
                        <span
                          className={
                            l.level === "error"
                              ? "text-red-600"
                              : l.level === "warn"
                                ? "text-amber-600"
                                : "text-neutral-700"
                          }
                        >
                          {l.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// page.tsx 는 default 외 임의 export 를 허용하지 않으므로 파일 내부용으로 둔다.
function StatusBadge({ status }: { status: PublishJob["status"] }) {
  const cls: Record<string, string> = {
    pending: "bg-neutral-100 text-neutral-700",
    running: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    cancelled: "bg-neutral-100 text-neutral-500",
  };
  return (
    <span
      className={`shrink-0 text-[11px] rounded px-2 py-0.5 ${cls[status] ?? ""}`}
    >
      {JOB_STATUS_LABEL[status]}
    </span>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return "방금";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return d.toLocaleString("ko-KR");
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <header>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && (
          <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}
