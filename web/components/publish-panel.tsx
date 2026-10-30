"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Send } from "lucide-react";

import { getBrowserSupabase } from "@/lib/supabase";
import { toNaverMarkup } from "@/lib/naver-markup";
import {
  JOB_STATUS_LABEL,
  cancelJob,
  createPublishJob,
  getAgents,
  getJobLogs,
  isAgentOnline,
  listAccounts,
  listJobsForPost,
  type JobLog,
  type PublishJob,
} from "@/lib/publish";

interface Props {
  postId: string;
  /** 편집창의 현재 값 — 저장 전 수정분도 그대로 발행되게 한다. */
  title: string;
  body: string;
  mainKeyword: string;
  subKeywords: string[];
  publishedAt: string | null;
  naverPostUrl: string | null;
  /** 발행이 완료되어 글 상태가 바뀌었을 때 상위 갱신용. */
  onPublished?: () => void;
}

const ACTIVE: PublishJob["status"][] = ["pending", "running"];

export default function PublishPanel({
  postId,
  title,
  body,
  mainKeyword,
  subKeywords,
  publishedAt,
  naverPostUrl,
  onPublished,
}: Props) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [agentOnline, setAgentOnline] = useState(false);
  const [account, setAccount] = useState("");
  const [tagText, setTagText] = useState("");
  const [stayMinutes, setStayMinutes] = useState(15);
  const [templateIndex, setTemplateIndex] = useState("");
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const conversion = useMemo(() => toNaverMarkup(body), [body]);
  const activeJob = jobs.find((j) => ACTIVE.includes(j.status)) ?? null;

  // 기본 태그는 키워드에서 뽑아준다 (사용자가 수정 가능).
  useEffect(() => {
    if (tagText) return;
    const seeds = [mainKeyword, ...subKeywords].filter(Boolean);
    if (seeds.length > 0) setTagText(seeds.join(", "));
  }, [mainKeyword, subKeywords, tagText]);

  const refresh = useCallback(async () => {
    const sb = getBrowserSupabase();
    const [acc, agents, js] = await Promise.all([
      listAccounts(sb),
      getAgents(sb),
      listJobsForPost(sb, postId),
    ]);
    setAccounts(acc);
    setAgentOnline(agents.some((a) => isAgentOnline(a)));
    setJobs(js);
    setAccount((prev) => prev || acc[0] || "");
    return js;
  }, [postId]);

  useEffect(() => {
    if (!open || loaded) return;
    refresh()
      .then(() => setLoaded(true))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, loaded, refresh]);

  // 진행 중 작업이 있으면 로그를 따라간다. 발행은 15분 이상 걸리므로
  // 폴링 간격을 짧게 두되(5초) 작업이 없으면 아예 돌리지 않는다.
  useEffect(() => {
    if (!open || !activeJob) return;
    let alive = true;
    const tick = async () => {
      try {
        const sb = getBrowserSupabase();
        const [ls, js] = await Promise.all([
          getJobLogs(sb, activeJob.id),
          listJobsForPost(sb, postId),
        ]);
        if (!alive) return;
        setLogs(ls);
        setJobs(js);
        const done = js.find((j) => j.id === activeJob.id);
        if (done && !ACTIVE.includes(done.status)) {
          if (done.status === "completed") onPublished?.();
        }
      } catch {
        /* 일시적 실패는 다음 틱에서 회복 */
      }
    };
    tick();
    const t = setInterval(tick, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, activeJob, postId, onPublished]);

  async function publish() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const tags = tagText
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const parsedTemplate =
        templateIndex.trim() === "" ? null : Number(templateIndex);
      if (parsedTemplate !== null && !Number.isInteger(parsedTemplate)) {
        throw new Error("템플릿 번호는 정수로 입력하세요.");
      }

      const { conversion: conv } = await createPublishJob(
        getBrowserSupabase(),
        {
          accountName: account,
          blogPostId: postId,
          title,
          body,
          tags,
          templateIndex: parsedTemplate,
          stayMinutes,
        },
      );
      setNotice(
        `발행 작업을 큐에 넣었습니다 (${conv.charCount}자). ` +
          `에이전트가 집어가면 아래에 진행 상황이 표시됩니다.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(jobId: string) {
    setBusy(true);
    try {
      await cancelJob(getBrowserSupabase(), jobId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="bg-white border rounded-lg p-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className="bg-[#03C75A] text-white text-sm rounded px-3 py-1.5 hover:brightness-95 inline-flex items-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" />
          네이버 블로그에 발행
        </button>
        {publishedAt && (
          <span className="text-xs text-green-700">
            {new Date(publishedAt).toLocaleString("ko-KR")} 발행됨
          </span>
        )}
        {naverPostUrl && (
          <a
            href={naverPostUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            글 보기
          </a>
        )}
      </section>
    );
  }

  const blocked = accounts.length === 0;

  return (
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">네이버 블로그 발행</h2>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 hover:underline"
        >
          접기
        </button>
      </header>

      {!loaded ? (
        <p className="text-sm text-neutral-400">불러오는 중...</p>
      ) : (
        <>
          {/* 사전 조건 */}
          {blocked && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
              발행할 네이버 계정이 등록되지 않았습니다.{" "}
              <Link href="/agent" className="underline font-medium">
                발행 에이전트 설정
              </Link>
              에서 계정 이름을 먼저 등록하세요.
            </div>
          )}
          {!blocked && !agentOnline && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
              로컬 에이전트가 오프라인입니다. 작업은 큐에 쌓이고, PC에서
              에이전트를 실행하면 자동으로 처리됩니다.{" "}
              <Link href="/agent" className="underline font-medium">
                실행 방법
              </Link>
            </div>
          )}

          {/* 변환 결과 미리보기 */}
          {conversion.warnings.length > 0 && (
            <div className="text-xs bg-neutral-50 border rounded p-3 space-y-1">
              <div className="font-medium text-neutral-700 inline-flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                발행 시 본문이 이렇게 바뀝니다
              </div>
              <ul className="list-disc list-inside text-neutral-600 space-y-0.5">
                {conversion.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 입력 */}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-neutral-600">계정</span>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                disabled={blocked}
                className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white disabled:bg-neutral-50"
              >
                {accounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-neutral-600">
                에디터 체류 시간 (분)
              </span>
              <input
                type="number"
                min={1}
                max={120}
                value={stayMinutes}
                onChange={(e) => setStayMinutes(Number(e.target.value))}
                className="mt-1 w-full border rounded px-3 py-2 text-sm"
              />
              <span className="text-[11px] text-neutral-400">
                차단 회피용. 이 시간만큼 브라우저가 점유됩니다.
              </span>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-neutral-600">태그 (쉼표 구분, 최대 30개)</span>
            <textarea
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              rows={2}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs text-neutral-600">
              내 템플릿 번호 (선택, 0부터)
            </span>
            <input
              value={templateIndex}
              onChange={(e) => setTemplateIndex(e.target.value)}
              placeholder="비우면 템플릿 미적용"
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            />
          </label>

          <div className="text-xs text-neutral-500 border-t pt-2">
            제목 {title.length}자 · 본문 {conversion.charCount}자
            {conversion.removedImagePlaceholders.length > 0 &&
              ` · 이미지 자리 ${conversion.removedImagePlaceholders.length}개 제거`}
          </div>

          {notice && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2">
              {notice}
            </p>
          )}
          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={publish}
              disabled={busy || blocked || !account || !!activeJob || !title.trim()}
              className="bg-[#03C75A] text-white text-sm rounded px-4 py-2 hover:brightness-95 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {busy ? "처리 중..." : "발행 작업 보내기"}
            </button>
            {activeJob && (
              <span className="text-xs text-neutral-500">
                진행 중인 작업이 끝나야 다시 보낼 수 있습니다.
              </span>
            )}
            {publishedAt && (
              <span className="text-xs text-amber-700">
                이미 발행된 글입니다 — 다시 보내면 새 글로 올라갑니다.
              </span>
            )}
          </div>

          {/* 작업 이력 */}
          {jobs.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <h3 className="text-xs font-semibold text-neutral-700">
                이 글의 발행 작업
              </h3>
              <ul className="space-y-2">
                {jobs.map((j) => (
                  <li key={j.id} className="border rounded p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-600">
                        {j.account_name} ·{" "}
                        {new Date(j.created_at).toLocaleString("ko-KR")}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-[11px] rounded px-2 py-0.5 bg-neutral-100">
                          {JOB_STATUS_LABEL[j.status]}
                        </span>
                        {j.status === "pending" && (
                          <button
                            onClick={() => onCancel(j.id)}
                            disabled={busy}
                            className="text-[11px] text-red-600 hover:underline disabled:opacity-40"
                          >
                            취소
                          </button>
                        )}
                      </span>
                    </div>
                    {j.error_message && (
                      <p className="text-[11px] text-red-700">{j.error_message}</p>
                    )}
                    {j.result?.post_url && (
                      <a
                        href={j.result.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-blue-700 hover:underline break-all"
                      >
                        {j.result.post_url}
                      </a>
                    )}
                    {activeJob?.id === j.id && logs.length > 0 && (
                      <ul className="space-y-0.5 pt-1">
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
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
