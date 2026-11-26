// 프롬프트 묶음: 글쓰기 방식 6개, SEO 8단계, 그 사이를 잇는 글 조각을 한 파일에 담은 것.
// 확장 패키지에는 프롬프트를 넣지 않는다. 묶음 파일을 한 번 불러와 확장 저장소에 둔다.
// 나중에 로그인이 붙으면 같은 모양으로 서버에서 받는다.

export const PACK_FORMAT = 2;

export type SeoPlatform = 'naver_blog' | 'custom_domain';

export interface PackMethod {
  id: number;
  label: string;
  prompt: string;
}

export interface PackSeoStep {
  id: number;
  title: string;
  short_label: string;
  /** {{main_keyword}}, {{selected_title}} 자리가 들어 있다 */
  prompt: string;
  /** AI가 묻고 사람이 답하는 단계인지 */
  has_user_turn: boolean;
  /** 직전 단계의 결과를 앞에 붙이는지 */
  needs_prev_output: boolean;
  /** 고른 제목이 필요한지 (URL 단계) */
  needs_selected_title: boolean;
  platforms: SeoPlatform[];
  /** 빼도 되는 단계인지 */
  optional: boolean;
}

export interface PromptPack {
  format: number;
  built_at: string;
  source: string;
  methods: { common: string; items: PackMethod[] };
  glue: Record<string, string>;
  seo: {
    steps: PackSeoStep[];
    platform_labels: Record<SeoPlatform, string>;
    /**
     * 한 번에 끝까지 돌릴 때, AI가 되묻는 단계에 대신 보내는 답. 단계 번호 → 답의 틀.
     * 틀에는 {{purpose}}, {{tone}}, {{cta}}, {{voice}}, {{past_titles}} 자리가 들어갈 수 있다.
     */
    auto_replies: Record<string, string>;
  };
}

/** 묶음에 꼭 있어야 하는 글 조각 이름 */
export const GLUE_KEYS = [
  'default.unspecified',
  'default.none',
  'default.persona',
  'default.author_persona',
  'input.head',
  'input.brand_header',
  'input.brand_identity',
  'input.brand_org',
  'input.domain_info',
  'input.constraints',
  'research.head',
  'research.item_title',
  'research.no_title',
  'research.item_blogger',
  'research.item_link',
  'research.item_desc',
  'research.item_body',
  'feedback.head',
  'feedback.too_short',
  'feedback.failed_head',
  'feedback.failed_item',
  'feedback.failed_evidence',
  'feedback.tail',
  'output_format',
  'seo.prev_wrapper',
  // 내 글에서 말투 배우기 (웹에는 없고 확장에만 있다)
  'voice.analyze',
  'voice.post_item',
  'voice.block',
  'voice.past_titles',
] as const;

export type GlueKey = (typeof GLUE_KEYS)[number];

/**
 * 있으면 쓰고 없어도 되는 글 조각. 새 기능이 생길 때 여기에 더한다.
 * 꼭 있어야 하는 목록에 넣으면 예전에 받은 묶음을 못 쓰게 되므로, 그 기능만 꺼지게 한다.
 */
export const OPTIONAL_GLUE_KEYS = [
  // 블로그용 카드의 문구를 AI로 다듬기
  'cards.rewrite',
  // 사진으로 리뷰 쓰기
  'review.photo',
  'review.photo_label',
  'review.purchase_own',
  'review.purchase_sponsored',
  'review.purchase_none',
  'review.no_notes',
  // 자료 찾기에서 고른 뉴스를 글쓰기에 참고로 붙이기
  'research.news_head',
  'research.news_item',
] as const;

export function glue(pack: PromptPack, key: GlueKey): string {
  const value = pack.glue[key];
  if (typeof value !== 'string') throw new Error(`프롬프트 묶음에 "${key}" 조각이 없어요. 묶음을 다시 만들어 불러와 주세요.`);
  return value;
}

/**
 * {{이름}} 자리를 값으로 바꾼다. 틀만 한 번 훑으므로, 값 안에 {{ }} 가 있어도 다시 바뀌지 않는다.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export type PackCheck = { ok: true; pack: PromptPack } | { ok: false; errors: string[] };

/** 불러온 파일이 프롬프트 묶음이 맞는지 본다. 틀리면 무엇이 틀렸는지 알려 준다. */
export function validatePack(value: unknown): PackCheck {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['프롬프트 묶음 파일이 아니에요.'] };
  if (value.format !== PACK_FORMAT) {
    return { ok: false, errors: [`묶음의 형식 번호가 달라요 (파일 ${String(value.format)}, 확장 ${PACK_FORMAT}). 묶음을 다시 만들어 주세요.`] };
  }

  const methods = value.methods;
  if (!isRecord(methods) || !isText(methods.common) || !Array.isArray(methods.items)) {
    errors.push('글쓰기 방식 프롬프트가 없어요.');
  } else {
    for (const item of methods.items as unknown[]) {
      if (!isRecord(item) || typeof item.id !== 'number' || !isText(item.label) || !isText(item.prompt)) {
        errors.push('글쓰기 방식 하나의 모양이 달라요.');
        break;
      }
    }
    if (methods.items.length === 0) errors.push('글쓰기 방식이 하나도 없어요.');
  }

  const glueMap = value.glue;
  if (!isRecord(glueMap)) {
    errors.push('글 조각이 없어요.');
  } else {
    const missing = GLUE_KEYS.filter((key) => typeof glueMap[key] !== 'string');
    if (missing.length > 0) errors.push('빠진 글 조각: ' + missing.join(', '));
  }

  const seo = value.seo;
  if (!isRecord(seo) || !Array.isArray(seo.steps) || !isRecord(seo.platform_labels)) {
    errors.push('SEO 단계 프롬프트가 없어요.');
  } else {
    if (!isRecord(seo.auto_replies) || Object.values(seo.auto_replies).some((v) => typeof v !== 'string')) {
      errors.push('한 번에 돌릴 때 쓰는 답이 없어요.');
    }
    for (const step of seo.steps as unknown[]) {
      const good =
        isRecord(step) &&
        typeof step.id === 'number' &&
        isText(step.title) &&
        isText(step.short_label) &&
        isText(step.prompt) &&
        typeof step.has_user_turn === 'boolean' &&
        typeof step.needs_prev_output === 'boolean' &&
        typeof step.needs_selected_title === 'boolean' &&
        typeof step.optional === 'boolean' &&
        Array.isArray(step.platforms);
      if (!good) {
        errors.push('SEO 단계 하나의 모양이 달라요.');
        break;
      }
    }
    if (seo.steps.length === 0) errors.push('SEO 단계가 하나도 없어요.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pack: value as unknown as PromptPack };
}

/** 화면에 보여 줄 한 줄 요약 */
export function describePack(pack: PromptPack): string {
  const day = pack.built_at.slice(0, 10);
  return `글쓰기 방식 ${pack.methods.items.length}개 · SEO ${pack.seo.steps.length}단계 · 만든 날 ${day}`;
}
