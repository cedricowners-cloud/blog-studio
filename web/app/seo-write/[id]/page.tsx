"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  Play,
  Clipboard,
  Inbox,
  PartyPopper,
} from "lucide-react";
import { getStepsForPlatform, type Platform, type WorkflowStep } from "@/lib/seo-workflow";
import { extractFirstTitle } from "@/lib/seo-workflow-engine";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RunData {
  id: string;
  platform: Platform;
  mode: "api" | "copy";
  main_keyword: string;
  llm_provider: string | null;
  llm_model: string | null;
  include_optional: boolean;
  selected_title: string | null;
  current_step_index: number;
  status: string;
}

interface StepResult {
  step_id: number;
  conversation: ChatMessage[];
  user_pasted_result: string | null;
  final_output: string | null;
  completed_at: string | null;
}

export default function SeoWriteRunPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunData | null>(null);
  const [stepResults, setStepResults] = useState<Record<number, StepResult>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [selectedTitleDraft, setSelectedTitleDraft] = useState("");

  // 데이터 로드
  async function loadRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/seo-write/runs/${params.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "워크플로 로드 실패");
      setRun(data.run as RunData);
      const map: Record<number, StepResult> = {};
      for (const s of data.step_results as StepResult[]) {
        map[s.step_id] = s;
      }
      setStepResults(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const steps = useMemo(() => {
    if (!run) return [] as WorkflowStep[];
    return getStepsForPlatform(run.platform, run.include_optional);
  }, [run]);

  const currentStep = run && steps[run.current_step_index];
  const currentResult = currentStep ? stepResults[currentStep.id] : undefined;

  // step 7 진입 시 selected_title 자동 prefill
  useEffect(() => {
    if (!run || !currentStep) return;
    if (!currentStep.needs_selected_title) return;
    if (run.selected_title) {
      setSelectedTitleDraft(run.selected_title);
      return;
    }
    // step 6 결과에서 첫 타이틀 추출
    const step6 = stepResults[6];
    if (step6?.final_output) {
      const t = extractFirstTitle(step6.final_output);
      if (t) setSelectedTitleDraft(t);
    }
  }, [run, currentStep, stepResults]);

  async function callStep(action: string, extra: Record<string, unknown> = {}) {
    if (!currentStep) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/seo-write/runs/${params.id}/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, step_id: currentStep.id, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "요청 실패");
      // 결과 갱신
      setStepResults((prev) => ({
        ...prev,
        [currentStep.id]: {
          step_id: currentStep.id,
          conversation: data.conversation ?? [],
          user_pasted_result: data.user_pasted_result ?? null,
          final_output: data.final_output ?? null,
          completed_at: data.completed ? new Date().toISOString() : null,
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSelectedTitle() {
    if (!run || !selectedTitleDraft.trim()) return;
    await fetch(`/api/seo-write/runs/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_title: selectedTitleDraft.trim() }),
    });
    setRun({ ...run, selected_title: selectedTitleDraft.trim() });
  }

  async function onAdvance() {
    await callStep("advance");
    setUserMessage("");
    setPasteText("");
    // run 재로드 (current_step_index 변경됨)
    await loadRun();
  }

  async function onSendMessage() {
    if (!userMessage.trim()) return;
    await callStep("send_message", { message: userMessage.trim() });
    setUserMessage("");
  }

  async function onPaste() {
    if (!pasteText.trim()) return;
    await callStep("paste_result", { paste: pasteText.trim() });
  }

  async function onStartApiStep() {
    await callStep("start");
  }

  async function copyPromptToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      alert("프롬프트가 클립보드에 복사되었습니다.");
    } catch (e) {
      alert(`복사 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6">
        <p className="text-sm text-neutral-400">불러오는 중...</p>
      </main>
    );
  }

  if (error && !run) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-2xl mx-auto border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  if (!run || !currentStep) {
    return null;
  }

  // 워크플로 완료
  const isCompleted = run.status === "completed";

  // step 6 결과에서 5개 타이틀 파싱 (step 7 진입 시 라디오 선택용)
  const step6Output = stepResults[6]?.final_output ?? "";
  const parsedTitles = parseTitles(step6Output);

  // 복사 모드용 — prepended 직전 산출물 포함한 전체 프롬프트
  const stepIndex = steps.findIndex((s) => s.id === currentStep.id);
  const prevOutput =
    stepIndex > 0 ? stepResults[steps[stepIndex - 1].id]?.final_output ?? null : null;
  const fullPromptForCopy = buildFullPrompt(currentStep, run, prevOutput);

  const currentStepLabel = currentStep?.short_label ?? (isCompleted ? "완료" : "");

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 md:gap-6">
        {/* 사이드바 (데스크톱) / 컴팩트 헤더 (모바일) */}
        <aside className="bg-white border rounded-lg p-4 space-y-3 h-fit md:sticky md:top-4">
          <div>
            <div className="text-xs text-neutral-500">메인 키워드</div>
            <div className="text-sm font-medium truncate">{run.main_keyword}</div>
          </div>
          <div className="text-xs text-neutral-500">
            {run.platform === "naver_blog" ? "네이버 블로그" : "자체 도메인"} ·{" "}
            {run.mode === "api" ? "API 모드" : "복사 모드"}
            {run.mode === "api" && run.llm_provider && (
              <> · {run.llm_provider}</>
            )}
          </div>

          {/* 모바일 — 가로 스텝 인디케이터 + 현재 단계명 */}
          <div className="md:hidden border-t pt-3 space-y-2">
            <div className="flex items-center gap-1">
              {steps.map((s, idx) => {
                const isCurrent = idx === run.current_step_index && !isCompleted;
                const isDone = !!stepResults[s.id]?.completed_at;
                return (
                  <div
                    key={s.id}
                    className={`flex-1 h-1.5 rounded-full ${
                      isDone
                        ? "bg-green-500"
                        : isCurrent
                          ? "bg-neutral-900"
                          : "bg-neutral-200"
                    }`}
                    title={`${idx + 1}. ${s.short_label}`}
                  />
                );
              })}
            </div>
            <div className="text-xs text-neutral-700">
              <span className="font-semibold text-neutral-900">
                {isCompleted ? steps.length : run.current_step_index + 1}
              </span>{" "}
              / {steps.length} · {currentStepLabel}
            </div>
          </div>

          {/* 데스크톱 — 전체 단계 리스트 */}
          <div className="hidden md:block border-t pt-3">
            <div className="text-xs font-medium text-neutral-700 mb-2">단계</div>
            <ul className="space-y-1">
              {steps.map((s, idx) => {
                const isCurrent = idx === run.current_step_index && !isCompleted;
                const isDone = !!stepResults[s.id]?.completed_at;
                return (
                  <li
                    key={s.id}
                    className={`text-xs px-2 py-1.5 rounded inline-flex items-center gap-1.5 w-full ${
                      isCurrent
                        ? "bg-neutral-900 text-white font-medium"
                        : isDone
                          ? "bg-green-50 text-green-800"
                          : "text-neutral-500"
                    }`}
                  >
                    {isDone ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <span className="w-3 text-center">{idx + 1}.</span>
                    )}
                    {s.short_label}
                  </li>
                );
              })}
            </ul>
          </div>
          <Link
            href="/seo-write"
            className="border rounded py-1.5 hover:bg-neutral-50 text-xs inline-flex items-center justify-center gap-1 w-full"
          >
            <ArrowLeft className="w-3 h-3" />
            시작 화면
          </Link>
        </aside>

        {/* 메인 영역 */}
        <section className="space-y-4">
          {isCompleted ? (
            <CompletedView steps={steps} stepResults={stepResults} />
          ) : (
            <>
              <header className="bg-white border rounded-lg p-4">
                <div className="text-xs text-neutral-500">
                  {run.current_step_index + 1} / {steps.length} 단계
                </div>
                <h2 className="text-lg font-bold mt-1">{currentStep.title}</h2>
                {currentStep.has_user_turn && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-flex items-center gap-1.5">
                    <MessageCircle className="w-3.5 h-3.5" />
                    이 단계에서는 LLM이 질문하면 답변을 입력해야 합니다 (멀티턴)
                  </p>
                )}
              </header>

              {/* step 7 — 타이틀 선택 UI (진행 전 필수) */}
              {currentStep.needs_selected_title && !run.selected_title && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-amber-900">
                    먼저 사용할 타이틀을 선택하세요
                  </h3>
                  {parsedTitles.length > 0 ? (
                    <div className="space-y-1.5">
                      {parsedTitles.map((t, i) => (
                        <label key={i} className="flex items-start gap-2 cursor-pointer text-sm">
                          <input
                            type="radio"
                            name="selected_title"
                            checked={selectedTitleDraft === t}
                            onChange={() => setSelectedTitleDraft(t)}
                            className="mt-1"
                          />
                          <span>{t}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700">
                      이전 단계에서 자동으로 타이틀을 추출하지 못했습니다. 직접 입력해주세요.
                    </p>
                  )}
                  <input
                    value={selectedTitleDraft}
                    onChange={(e) => setSelectedTitleDraft(e.target.value)}
                    placeholder="또는 직접 입력"
                    className="w-full border border-amber-300 rounded px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={saveSelectedTitle}
                    disabled={!selectedTitleDraft.trim()}
                    className="bg-amber-600 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50"
                  >
                    이 타이틀 사용
                  </button>
                </div>
              )}

              {/* 본문 — 모드별 분기 */}
              {(!currentStep.needs_selected_title || run.selected_title) && (
                <>
                  {run.mode === "api" ? (
                    <ApiModeView
                      step={currentStep}
                      conversation={currentResult?.conversation ?? []}
                      userMessage={userMessage}
                      setUserMessage={setUserMessage}
                      busy={busy}
                      onStart={onStartApiStep}
                      onSendMessage={onSendMessage}
                    />
                  ) : (
                    <CopyModeView
                      promptText={fullPromptForCopy}
                      pasteText={pasteText}
                      setPasteText={setPasteText}
                      currentResult={currentResult}
                      busy={busy}
                      onCopy={() => copyPromptToClipboard(fullPromptForCopy)}
                      onPaste={onPaste}
                    />
                  )}
                </>
              )}

              {error && (
                <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* 다음 단계 버튼 */}
              {currentResult?.final_output && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onAdvance}
                    disabled={busy}
                    className="bg-neutral-900 text-white text-sm rounded px-5 py-2 font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {stepIndex >= steps.length - 1 ? (
                      "워크플로 완료"
                    ) : (
                      <>
                        다음 단계로 <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function ApiModeView({
  step,
  conversation,
  userMessage,
  setUserMessage,
  busy,
  onStart,
  onSendMessage,
}: {
  step: WorkflowStep;
  conversation: ChatMessage[];
  userMessage: string;
  setUserMessage: (s: string) => void;
  busy: boolean;
  onStart: () => void;
  onSendMessage: () => void;
}) {
  const empty = conversation.length === 0;

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      {empty ? (
        <div className="text-center py-6">
          <p className="text-sm text-neutral-500 mb-3">
            이 단계의 프롬프트를 LLM에 보내고 응답을 받습니다.
          </p>
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className="bg-neutral-900 text-white text-sm rounded px-5 py-2 font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              "실행 중..."
            ) : (
              <>
                <Play className="w-4 h-4" />
                단계 시작
              </>
            )}
          </button>
        </div>
      ) : (
        <>
          {/* 대화 표시 */}
          <div className="space-y-3 max-h-[600px] overflow-auto">
            {conversation.map((m, i) => (
              <div
                key={i}
                className={`rounded p-3 text-sm ${
                  m.role === "user"
                    ? "bg-neutral-50 border border-neutral-200"
                    : "bg-blue-50 border border-blue-200"
                }`}
              >
                <div className="text-[10px] font-semibold text-neutral-500 mb-1">
                  {m.role === "user" ? "사용자" : "LLM"}
                </div>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            ))}
            {busy && (
              <div className="text-xs text-neutral-400 italic">LLM 응답 생성 중...</div>
            )}
          </div>

          {/* 멀티턴: 추가 메시지 입력 */}
          {step.has_user_turn && (
            <div className="border-t pt-3 space-y-2">
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                placeholder="LLM의 질문에 답하거나 추가 지시를 입력하세요"
                rows={3}
                className="w-full border rounded px-3 py-2 text-sm"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onSendMessage}
                  disabled={busy || !userMessage.trim()}
                  className="border border-neutral-300 text-neutral-700 text-sm rounded px-4 py-1.5 hover:bg-neutral-50 disabled:opacity-50"
                >
                  메시지 전송
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CopyModeView({
  promptText,
  pasteText,
  setPasteText,
  currentResult,
  busy,
  onCopy,
  onPaste,
}: {
  promptText: string;
  pasteText: string;
  setPasteText: (s: string) => void;
  currentResult?: StepResult;
  busy: boolean;
  onCopy: () => void;
  onPaste: () => void;
}) {
  const hasResult = !!currentResult?.user_pasted_result;
  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
            <Clipboard className="w-4 h-4 text-neutral-700" />
            프롬프트 ({promptText.length.toLocaleString()}자)
          </h3>
          <button
            type="button"
            onClick={onCopy}
            className="bg-neutral-900 text-white text-xs rounded px-3 py-1.5 hover:bg-neutral-800"
          >
            클립보드에 복사
          </button>
        </div>
        <pre className="text-xs whitespace-pre-wrap break-words font-mono text-neutral-700 bg-neutral-50 border rounded p-3 max-h-[400px] overflow-auto">
          {promptText}
        </pre>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
        <h3 className="text-sm font-semibold text-amber-900 inline-flex items-center gap-1.5">
          <Inbox className="w-4 h-4" />
          LLM에서 받은 결과를 여기 붙여넣으세요
        </h3>
        <p className="text-xs text-amber-700">
          위 프롬프트를 ChatGPT/Claude/Gemini 등에 붙여넣고 받은 응답을 그대로 복사해서 아래에 붙여넣으세요.
          이 결과가 다음 단계의 입력으로 사용됩니다.
        </p>
        <textarea
          value={hasResult ? currentResult!.user_pasted_result! : pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="LLM에서 받은 응답 전체를 붙여넣으세요"
          rows={10}
          disabled={hasResult}
          className="w-full border border-amber-300 rounded px-3 py-2 text-sm font-mono bg-white disabled:bg-neutral-100"
        />
        {!hasResult && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onPaste}
              disabled={busy || !pasteText.trim()}
              className="bg-amber-600 text-white text-sm rounded px-4 py-1.5 disabled:opacity-50"
            >
              결과 저장
            </button>
          </div>
        )}
        {hasResult && (
          <p className="text-xs text-green-700 inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5" />
            결과가 저장되었습니다. 아래 &quot;다음 단계로&quot; 버튼을 눌러 진행하세요.
          </p>
        )}
      </div>
    </div>
  );
}

function CompletedView({
  steps,
  stepResults,
}: {
  steps: WorkflowStep[];
  stepResults: Record<number, StepResult>;
}) {
  return (
    <div className="space-y-3">
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
        <h2 className="text-lg font-bold text-green-900 inline-flex items-center gap-2">
          <PartyPopper className="w-5 h-5" />
          워크플로 완료
        </h2>
        <p className="text-sm text-green-700 mt-1">
          모든 단계의 산출물을 아래에서 확인하세요.
        </p>
      </div>
      {steps.map((s, idx) => {
        const r = stepResults[s.id];
        if (!r?.final_output) return null;
        return (
          <details key={s.id} className="bg-white border rounded-lg" open={idx === steps.length - 1}>
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium hover:bg-neutral-50">
              {idx + 1}. {s.title}
            </summary>
            <div className="px-4 pb-3 pt-1 border-t">
              <pre className="text-xs whitespace-pre-wrap break-words text-neutral-700 mt-2">
                {r.final_output}
              </pre>
            </div>
          </details>
        );
      })}
    </div>
  );
}

// =============== helpers ===============

/** step 6 결과에서 "Title: ..." 라인 5개 추출 */
function parseTitles(step6Output: string): string[] {
  if (!step6Output) return [];
  const matches = Array.from(step6Output.matchAll(/Title\s*[:：]\s*(.+)/gi));
  return matches.map((m) => m[1].trim()).filter(Boolean).slice(0, 5);
}

/** 복사 모드용 — 변수 치환 + 직전 단계 산출물 prepend 한 전체 프롬프트 */
function buildFullPrompt(step: WorkflowStep, run: RunData, prevOutput: string | null): string {
  let prompt = step.prompt;
  prompt = prompt.replace(/\{\{main_keyword\}\}/g, run.main_keyword);
  if (step.needs_selected_title && run.selected_title) {
    prompt = prompt.replace(/\{\{selected_title\}\}/g, run.selected_title);
  }
  if (step.needs_prev_output && prevOutput) {
    return `[직전 단계 산출물]\n${prevOutput}\n\n---\n\n${prompt}`;
  }
  return prompt;
}
