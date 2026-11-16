// SEO 8단계 글쓰기. 프롬프트 8개를 차례로 돌리고, 앞 단계의 결과를 다음 단계에 넘긴다.
// 웹의 web/lib/seo-workflow.ts, seo-workflow-engine.ts, app/api/seo-write/runs/[id]/step/route.ts 를 옮긴 것이다.
// 다른 점: 진행 상황을 DB 가 아니라 이 컴퓨터의 확장 저장소에 둔다. 그래서 여기서는 값만 다루고, 저장은 화면 쪽에서 한다.
import { fill, glue, type PackSeoStep, type PromptPack, type SeoPlatform } from '../prompts/pack.ts';
import type { ChatMessage, LLMProvider } from '../llm/client.ts';

/** api: 내 키로 AI와 주고받는다 · copy: 프롬프트를 복사해 다른 AI에 붙여넣고, 결과를 다시 붙여넣는다 */
export type SeoMode = 'api' | 'copy';

export interface SeoStepResult {
  step_id: number;
  conversation: ChatMessage[];
  user_pasted_result: string | null;
  final_output: string | null;
  completed_at: string | null;
}

export interface SeoRun {
  id: string;
  platform: SeoPlatform;
  mode: SeoMode;
  main_keyword: string;
  llm_provider: LLMProvider | null;
  include_optional: boolean;
  /** URL 단계에 쓸 제목. 제목 단계의 결과에서 고른다 */
  selected_title: string | null;
  current_step_index: number;
  status: 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  results: Record<number, SeoStepResult>;
}

export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export function getStepsForPlatform(pack: PromptPack, platform: SeoPlatform, includeOptional: boolean): PackSeoStep[] {
  return pack.seo.steps.filter((s) => s.platforms.includes(platform) && (includeOptional || !s.optional));
}

export function findStep(pack: PromptPack, stepId: number): PackSeoStep | undefined {
  return pack.seo.steps.find((s) => s.id === stepId);
}

export function stepsOf(pack: PromptPack, run: SeoRun): PackSeoStep[] {
  return getStepsForPlatform(pack, run.platform, run.include_optional);
}

export interface RunContext {
  main_keyword: string;
  prev_output?: string | null;
  selected_title?: string | null;
}

/** 단계의 첫 프롬프트를 만든다. 키워드와 제목을 넣고, 필요하면 직전 단계의 결과를 앞에 붙인다. */
export function buildStepInitialMessage(pack: PromptPack, step: PackSeoStep, ctx: RunContext): string {
  let prompt = step.prompt.replace(/\{\{main_keyword\}\}/g, () => ctx.main_keyword);
  if (step.needs_selected_title) {
    const title = ctx.selected_title;
    if (!title) throw new Error('이 단계에는 고른 제목이 필요해요. 제목 단계의 결과에서 제목을 하나 골라 주세요.');
    prompt = prompt.replace(/\{\{selected_title\}\}/g, () => title);
  }
  if (step.needs_prev_output) {
    if (!ctx.prev_output) throw new Error('앞 단계의 결과가 비어 있어서 이 단계를 시작할 수 없어요.');
    return fill(glue(pack, 'seo.prev_wrapper'), { prev: ctx.prev_output, prompt });
  }
  return prompt;
}

/** 제목 단계의 결과에서 제목들을 꺼낸다. 첫 번째가 기본값이다. */
export function extractTitles(output: string): string[] {
  const titles: string[] = [];
  for (const match of output.matchAll(/Title\s*[:：]\s*(.+)/gi)) {
    // AI가 굵게 표시(**)를 붙여 주는 일이 있다. 앞뒤의 별표와 빈칸을 떼어 낸다.
    const title = (match[1] ?? '').replace(/^[\s*]+|[\s*]+$/g, '');
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

export function extractFirstTitle(output: string): string | null {
  const match = output.match(/Title\s*[:：]\s*(.+)/i);
  return match && match[1] !== undefined ? match[1].trim() : null;
}

export function createRun(input: {
  id: string;
  platform: SeoPlatform;
  mode: SeoMode;
  main_keyword: string;
  llm_provider: LLMProvider | null;
  include_optional: boolean;
  now: string;
}): SeoRun {
  const keyword = input.main_keyword.trim();
  if (!keyword) throw new Error('메인 키워드를 적어 주세요.');
  return {
    id: input.id,
    platform: input.platform,
    mode: input.mode,
    main_keyword: keyword,
    llm_provider: input.mode === 'api' ? input.llm_provider : null,
    include_optional: input.include_optional,
    selected_title: null,
    current_step_index: 0,
    status: 'in_progress',
    created_at: input.now,
    updated_at: input.now,
    results: {},
  };
}

function emptyResult(stepId: number): SeoStepResult {
  return { step_id: stepId, conversation: [], user_pasted_result: null, final_output: null, completed_at: null };
}

export function resultOf(run: SeoRun, stepId: number): SeoStepResult {
  return run.results[stepId] ?? emptyResult(stepId);
}

function withResult(run: SeoRun, result: SeoStepResult, now: string): SeoRun {
  return { ...run, updated_at: now, results: { ...run.results, [result.step_id]: result } };
}

function requireStep(pack: PromptPack, stepId: number): PackSeoStep {
  const step = findStep(pack, stepId);
  if (!step) throw new Error('이 단계를 프롬프트 묶음에서 찾지 못했어요.');
  return step;
}

/** 직전 단계의 결과. 순서에서 바로 앞 단계를 본다. */
export function prevOutputFor(pack: PromptPack, run: SeoRun, step: PackSeoStep): string | null {
  if (!step.needs_prev_output) return null;
  const steps = stepsOf(pack, run);
  const idx = steps.findIndex((s) => s.id === step.id);
  const prev = idx > 0 ? steps[idx - 1] : undefined;
  return prev ? (run.results[prev.id]?.final_output ?? null) : null;
}

/** 이 단계의 첫 프롬프트. 복사 방식에서는 이것을 복사해 쓴다. */
export function initialMessageFor(pack: PromptPack, run: SeoRun, stepId: number): string {
  const step = requireStep(pack, stepId);
  return buildStepInitialMessage(pack, step, {
    main_keyword: run.main_keyword,
    prev_output: prevOutputFor(pack, run, step),
    selected_title: run.selected_title,
  });
}

/** 단계를 시작한다: 첫 프롬프트를 보내고 답을 받는다. */
export async function startStep(pack: PromptPack, run: SeoRun, stepId: number, chat: ChatFn, now: string): Promise<SeoRun> {
  if (run.mode !== 'api') throw new Error('복사 방식에서는 프롬프트를 복사해서 진행해요.');
  const step = requireStep(pack, stepId);
  const current = resultOf(run, stepId);
  if (current.conversation.length > 0) throw new Error('이미 시작한 단계예요.');

  const messages: ChatMessage[] = [{ role: 'user', content: initialMessageFor(pack, run, stepId) }];
  const answer = await chat(messages);
  messages.push({ role: 'assistant', content: answer });
  return withResult(run, { ...current, conversation: messages, final_output: step.has_user_turn ? null : answer }, now);
}

/** AI의 질문에 답을 보내고 다음 답을 받는다. */
export async function sendMessage(pack: PromptPack, run: SeoRun, stepId: number, message: string, chat: ChatFn, now: string): Promise<SeoRun> {
  if (run.mode !== 'api') throw new Error('복사 방식에서는 결과를 붙여넣어 진행해요.');
  requireStep(pack, stepId);
  const text = message.trim();
  if (!text) throw new Error('보낼 말을 적어 주세요.');
  const current = resultOf(run, stepId);
  if (current.conversation.length === 0) throw new Error('먼저 이 단계를 시작해 주세요.');

  // AI 호출이 실패하면 보낸 말도 남기지 않는다. 다시 보내면 된다.
  const messages: ChatMessage[] = [...current.conversation, { role: 'user', content: text }];
  const answer = await chat(messages);
  messages.push({ role: 'assistant', content: answer });
  return withResult(run, { ...current, conversation: messages, final_output: answer }, now);
}

/** 복사 방식: 다른 AI에서 받은 결과를 붙여넣는다. */
export function pasteResult(pack: PromptPack, run: SeoRun, stepId: number, paste: string, now: string): SeoRun {
  if (run.mode !== 'copy') throw new Error('붙여넣기는 복사 방식에서만 써요.');
  requireStep(pack, stepId);
  const text = paste.trim();
  if (!text) throw new Error('결과를 붙여넣어 주세요.');
  return withResult(run, { ...resultOf(run, stepId), user_pasted_result: text, final_output: text }, now);
}

/** 이 단계를 끝내고 다음 단계로 넘어간다. */
export function advance(pack: PromptPack, run: SeoRun, stepId: number, now: string): SeoRun {
  const step = requireStep(pack, stepId);
  const current = resultOf(run, stepId);
  let finalOutput = current.final_output;

  // 주고받는 단계는 AI의 마지막 답을 결과로 삼는다.
  if (run.mode === 'api' && step.has_user_turn) {
    const lastAssistant = [...current.conversation].reverse().find((m) => m.role === 'assistant');
    finalOutput = lastAssistant?.content ?? finalOutput;
  }
  if (!finalOutput) throw new Error('이 단계의 결과가 비어 있어서 넘어갈 수 없어요.');

  const steps = stepsOf(pack, run);
  const idx = steps.findIndex((s) => s.id === step.id);
  const isLast = idx + 1 >= steps.length;
  const next = withResult(run, { ...current, final_output: finalOutput, completed_at: now }, now);
  return { ...next, current_step_index: isLast ? idx : idx + 1, status: isLast ? 'completed' : 'in_progress' };
}

/** 제목을 고른다 (URL 단계에 쓴다). */
export function selectTitle(run: SeoRun, title: string, now: string): SeoRun {
  const text = title.trim();
  return { ...run, selected_title: text || null, updated_at: now };
}

/** 단계를 처음부터 다시 한다. 그 단계의 대화와 결과를 지운다. */
export function resetStep(run: SeoRun, stepId: number, now: string): SeoRun {
  const results = { ...run.results };
  delete results[stepId];
  return { ...run, results, updated_at: now, status: 'in_progress' };
}
