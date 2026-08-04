/**
 * SEO 워크플로 런타임 — 변수 치환, 단계 입력 빌드.
 */
import type { WorkflowStep } from "./seo-workflow";

export interface RunContext {
  main_keyword: string;
  /** 직전 단계의 final_output (있으면) */
  prev_output?: string | null;
  /** step 7용: 사용자가 step 6 결과에서 선택한 타이틀 */
  selected_title?: string | null;
}

/**
 * 프롬프트 본문 + 직전 단계 산출물을 합쳐서 단계 시작 메시지를 만듦.
 * - {{var}} 치환
 * - needs_prev_output 인 단계는 직전 산출물을 prepend
 */
export function buildStepInitialMessage(step: WorkflowStep, ctx: RunContext): string {
  let prompt = step.prompt;

  // 변수 치환
  prompt = prompt.replace(/\{\{main_keyword\}\}/g, ctx.main_keyword);
  if (step.needs_selected_title) {
    if (!ctx.selected_title) {
      throw new Error(`step ${step.id} 에는 selected_title 이 필요합니다.`);
    }
    prompt = prompt.replace(/\{\{selected_title\}\}/g, ctx.selected_title);
  }

  if (step.needs_prev_output) {
    if (!ctx.prev_output) {
      throw new Error(`step ${step.id} 는 직전 단계 산출물이 필요한데 비어있습니다.`);
    }
    return `[직전 단계 산출물]\n${ctx.prev_output}\n\n---\n\n${prompt}`;
  }
  return prompt;
}

/**
 * step 6 결과(타이틀 5개)에서 첫 번째 Title 추출 (selected_title 의 기본값).
 * 사용자가 명시적으로 선택하지 않으면 이 값이 default 로 들어감.
 */
export function extractFirstTitle(step6Output: string): string | null {
  const match = step6Output.match(/Title\s*[:：]\s*(.+)/i);
  return match ? match[1].trim() : null;
}
