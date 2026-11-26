// 글쓰기 방식 프롬프트를 조립한다.
// 웹의 web/lib/ontology/prompt-builder.ts 를 옮긴 것이다. 다른 점은 두 가지다.
//   - 프롬프트 글을 서버 파일에서 읽지 않고, 프롬프트 묶음에서 받는다.
//   - 업종 설정 부분은 아직 없다 (로그인을 붙인 뒤에 넣는다).
// 웹과 같은 글이 나오는지는 tests/parity.test.ts 가 확인한다.
import { fill, glue, type PromptPack } from '../prompts/pack.ts';
import { AWARENESS_LEVELS, DEFAULT_OPTIONS, type BlogGenerationInput, type NewsContextItem, type ResearchContextItem } from './types.ts';

export function findMethod(pack: PromptPack, methodId: number) {
  return pack.methods.items.find((m) => m.id === methodId) ?? null;
}

/** 입력에서 빠진 것을 찾는다. 빈 배열이면 통과다. */
export function checkInput(pack: PromptPack, inp: BlogGenerationInput): string[] {
  const errs: string[] = [];
  if (!findMethod(pack, inp.method_id)) errs.push('글쓰기 방식을 골라 주세요.');
  if (!inp.topic?.trim()) errs.push('주제를 적어 주세요.');
  if (!inp.main_keyword?.trim()) errs.push('메인 키워드를 적어 주세요.');
  if (!Array.isArray(inp.sub_keywords) || inp.sub_keywords.length === 0) errs.push('서브 키워드를 하나 이상 적어 주세요.');
  if (inp.target_awareness_level && !AWARENESS_LEVELS.includes(inp.target_awareness_level)) {
    errs.push('독자 단계는 L1~L4 중 하나여야 해요.');
  }
  return errs;
}

/** 프롬프트 글 안의 {topic}, {main_keyword} 같은 자리를 입력값으로 바꾼다. 순서도 웹과 같다. */
function substituteVariables(pack: PromptPack, template: string, inp: BlogGenerationInput): string {
  const brand = inp.brand_voice ?? {};
  const unspecified = glue(pack, 'default.unspecified');
  const replacements: [string, string][] = [
    ['{topic}', inp.topic],
    ['{main_keyword}', inp.main_keyword],
    ['{sub_keywords}', inp.sub_keywords.join(', ')],
    ['{target_awareness_level}', inp.target_awareness_level ?? 'L2'],
    ['{search_intent}', inp.search_intent ?? unspecified],
    ['{jtbd_type}', inp.jtbd_type ?? unspecified],
    ['{domain_info}', inp.domain_info ? JSON.stringify(inp.domain_info, null, 2) : glue(pack, 'default.none')],
    ['{persona}', inp.persona ?? glue(pack, 'default.persona')],
    ['{author_persona}', inp.author_persona ?? glue(pack, 'default.author_persona')],
    ['{author_identity}', brand.author_identity ?? ''],
    ['{consultancy_name}', brand.consultancy_name ?? ''],
  ];
  return replacements.reduce((acc, [key, value]) => acc.split(key).join(value), template);
}

function buildInputSection(pack: PromptPack, inp: BlogGenerationInput): string {
  const opts = { ...DEFAULT_OPTIONS, ...(inp.generation_options ?? {}) };
  const parts: string[] = [
    fill(glue(pack, 'input.head'), {
      topic: inp.topic,
      main_keyword: inp.main_keyword,
      sub_keywords: inp.sub_keywords.join(', '),
      awareness: inp.target_awareness_level ?? 'L2',
      persona: inp.persona ?? glue(pack, 'default.persona'),
      author_persona: inp.author_persona || glue(pack, 'default.unspecified'),
      method_id: inp.method_id,
      method_label: findMethod(pack, inp.method_id)?.label ?? '',
    }),
  ];

  const brand = inp.brand_voice;
  if (brand && (brand.author_identity || brand.consultancy_name)) {
    parts.push(glue(pack, 'input.brand_header'));
    if (brand.author_identity) parts.push(fill(glue(pack, 'input.brand_identity'), { v: brand.author_identity }));
    if (brand.consultancy_name) parts.push(fill(glue(pack, 'input.brand_org'), { v: brand.consultancy_name }));
  }

  if (inp.domain_info) {
    parts.push(fill(glue(pack, 'input.domain_info'), { json: JSON.stringify(inp.domain_info, null, 2) }));
  }

  parts.push(
    fill(glue(pack, 'input.constraints'), {
      min_chars: opts.min_body_char_count,
      pass_pct: (opts.axiom_pass_threshold * 100).toFixed(0),
    }),
  );
  return parts.join('\n');
}

function buildResearchSection(pack: PromptPack, items: ResearchContextItem[]): string {
  if (!items || items.length === 0) return '';
  const parts: string[] = [fill(glue(pack, 'research.head'), { count: items.length })];
  items.forEach((it, i) => {
    parts.push(fill(glue(pack, 'research.item_title'), { n: i + 1, title: it.title || glue(pack, 'research.no_title') }));
    if (it.bloggername) parts.push(fill(glue(pack, 'research.item_blogger'), { v: it.bloggername }));
    if (it.link) parts.push(fill(glue(pack, 'research.item_link'), { v: it.link }));
    if (it.description) parts.push(fill(glue(pack, 'research.item_desc'), { v: it.description }));
    if (it.body) parts.push(fill(glue(pack, 'research.item_body'), { v: it.body }));
    parts.push('');
  });
  return parts.join('\n');
}

/** 받아 둔 묶음에 참고 뉴스용 글 조각이 있는지 (예전 묶음에는 없다) */
export function canUseNews(pack: PromptPack): boolean {
  const pieces = pack.glue as Record<string, unknown>;
  return typeof pieces['research.news_head'] === 'string' && typeof pieces['research.news_item'] === 'string';
}

/**
 * 참고 뉴스. 웹에는 없고 확장에만 있다. 뉴스가 없으면 아무것도 붙이지 않아서, 웹과 같은 입력에는 웹과 같은 프롬프트가 나온다.
 * 기사는 제목과 요약만 준다. 본문은 가져오지 않는다.
 */
function buildNewsSection(pack: PromptPack, items: NewsContextItem[]): string {
  if (!items || items.length === 0 || !canUseNews(pack)) return '';
  const pieces = pack.glue as Record<string, string>;
  const parts: string[] = [fill(pieces['research.news_head'] as string, { count: items.length })];
  items.forEach((it, i) => {
    parts.push(fill(pieces['research.news_item'] as string, { n: i + 1, title: it.title, date: it.date || '-', source: it.source || '-', link: it.link || '-', desc: it.description || '-' }), '');
  });
  return parts.join('\n');
}

/** AI에게 보낼 프롬프트 전체를 만든다. */
export function buildFullPrompt(pack: PromptPack, inp: BlogGenerationInput): string {
  const errs = checkInput(pack, inp);
  if (errs.length > 0) throw new Error(errs.join(' '));
  const method = findMethod(pack, inp.method_id);
  if (!method) throw new Error('글쓰기 방식을 찾지 못했어요.');

  const substituted = substituteVariables(pack, pack.methods.common + '\n\n' + method.prompt, inp);
  const inputSection = buildInputSection(pack, inp);
  const researchSection = buildResearchSection(pack, inp.research_context ?? []);
  const newsSection = buildNewsSection(pack, inp.news_context ?? []);
  return [substituted, inputSection, researchSection, newsSection, glue(pack, 'output_format')].filter(Boolean).join('\n\n');
}
