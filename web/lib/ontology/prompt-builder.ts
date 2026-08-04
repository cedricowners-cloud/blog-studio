/**
 * Ontology v2 프롬프트 빌더 (Python prompt_builder.py 1:1 포팅).
 *
 * prompts/00_common_ontology.md + prompts/0N_method.md 를 로드하고
 * 사용자 입력 + 출력 포맷 지시를 이어붙여 LLM 최종 프롬프트를 만든다.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface BrandVoice {
  author_identity?: string | null;
  consultancy_name?: string | null;
}

export interface GenerationOptions {
  max_retries?: number;
  axiom_pass_threshold?: number;
  min_body_char_count?: number;
}

export interface ResearchContextItem {
  title: string;
  description?: string;
  body?: string | null;
  link?: string;
  bloggername?: string;
}

export type SearchIntent = "정보탐색" | "자격진단" | "절차해결" | "문제해결" | "비교선택";
export type JtbdType = "시간절약" | "리스크회피" | "의사결정지원" | "자기효능감" | "위임판단";

export interface BlogGenerationInput {
  method_id: number; // 1..6
  topic: string;
  main_keyword: string;
  sub_keywords: string[];
  target_awareness_level?: "L1" | "L2" | "L3" | "L4";
  /** Ontology B v2 — 검색의도 (3축 중 2번째) */
  search_intent?: SearchIntent;
  /** Ontology B v2 — JTBD (3축 중 3번째) */
  jtbd_type?: JtbdType;
  domain_info?: Record<string, unknown> | null;
  /**
   * 독자 페르소나 — 글을 *읽는* 사람의 직업/상황/페인포인트/욕망.
   * 예: "30대 1인 사업자, 운영자금 부족, 정책 정보 어려움, 시간 없음"
   */
  persona?: string;
  /**
   * 작성자 페르소나 — 글을 *쓰는* 사람의 경력/말투/톤/전문성.
   * 예: "공공조달행정사 5년, 친근하지만 전문적, 사례 위주, 가끔 직설적 표현"
   */
  author_persona?: string;
  brand_voice?: BrandVoice | null;
  generation_options?: GenerationOptions;
  /**
   * 같은 키워드의 상위 노출 블로그 N개. LLM이 차별화 글을 쓰는 참고 자료.
   * /api/research 응답을 그대로 넘기면 됨.
   */
  research_context?: ResearchContextItem[];
  /**
   * 도메인 패키지 (선택). prompt-builder 가 직접 받음 (DB 로드는 호출자 책임).
   * 없으면 도메인 무관 모드로 동작 (v1 호환).
   */
  domain_pack?: import("./domain-loader").DomainPack | null;
}

export const DEFAULT_OPTIONS: Required<GenerationOptions> = {
  max_retries: 2,
  axiom_pass_threshold: 1.0,
  min_body_char_count: 1500,
};

const METHOD_FILENAMES: Record<number, string> = {
  1: "01_crank_diaplus_v2.md",
  2: "02_alcon_v2.md",
  3: "03_aeo_v2.md",
  4: "04_homefeed_v2.md",
  5: "05_insight_edge_v2.md",
  6: "06_info_govt_v2.md",
};

const METHOD_LABELS: Record<number, string> = {
  1: "C랭크 다이아플러스",
  2: "알콘",
  3: "AEO",
  4: "홈피드",
  5: "인사이트 엣지",
  6: "C랭크 정보성 (정부지원)",
};

function getPromptDir(): string {
  // process.env.PROMPTS_DIR 명시 시 그것 우선.
  // 기본: web/prompts (Next.js 빌드 번들에 포함되어 Vercel 배포에서도 동작).
  // process.cwd()는 dev/build 모두 web/ 디렉토리.
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  return path.resolve(process.cwd(), "prompts");
}

// 운영 환경에서만 캐시 사용 — 개발 중에는 prompts/ 수정 즉시 반영
const CACHE_ENABLED = process.env.NODE_ENV === "production";
const promptCache = new Map<string, string>();

async function loadPromptFile(filename: string): Promise<string> {
  if (CACHE_ENABLED && promptCache.has(filename)) return promptCache.get(filename)!;
  const full = path.join(getPromptDir(), filename);
  try {
    const text = await readFile(full, "utf-8");
    if (CACHE_ENABLED) promptCache.set(filename, text);
    return text;
  } catch (e) {
    throw new Error(`프롬프트 파일을 읽을 수 없습니다: ${full} (${e instanceof Error ? e.message : String(e)})`);
  }
}

/**
 * 공통 온톨로지·방식 프롬프트 본문에 박혀있는 자리표시자({topic}, {main_keyword} 등)를
 * 실제 입력값으로 치환. 치환 안 하면 LLM이 미해결 변수를 그대로 받아 매핑이 깨짐.
 */
function substituteVariables(template: string, inp: BlogGenerationInput): string {
  const brand = inp.brand_voice ?? {};
  const replacements: Record<string, string> = {
    "{topic}": inp.topic,
    "{main_keyword}": inp.main_keyword,
    "{sub_keywords}": inp.sub_keywords.join(", "),
    "{target_awareness_level}": inp.target_awareness_level ?? "L2",
    "{search_intent}": inp.search_intent ?? "(미지정)",
    "{jtbd_type}": inp.jtbd_type ?? "(미지정)",
    "{domain_info}": inp.domain_info ? JSON.stringify(inp.domain_info, null, 2) : "(없음)",
    "{persona}": inp.persona ?? "30대 경영자/대표",
    "{author_persona}": inp.author_persona ?? "(미지정 — 친근하면서도 전문적인 일반 컨설턴트 톤으로)",
    "{author_identity}": brand.author_identity ?? "",
    "{consultancy_name}": brand.consultancy_name ?? "",
  };
  return Object.entries(replacements).reduce(
    (acc, [k, v]) => acc.split(k).join(v),
    template,
  );
}

/**
 * 입력 검증 — input_schema 필수 항목·범위·enum.
 * route 핸들러와 중복이지만, prompt-builder 모듈을 다른 곳에서 직접 호출해도 안전하게.
 */
function validateInput(inp: BlogGenerationInput): void {
  const errs: string[] = [];
  if (typeof inp.method_id !== "number" || inp.method_id < 1 || inp.method_id > 6) {
    errs.push("method_id는 1~6 사이여야 합니다");
  }
  if (!inp.topic?.trim()) errs.push("topic 필수");
  if (!inp.main_keyword?.trim()) errs.push("main_keyword 필수");
  if (!Array.isArray(inp.sub_keywords) || inp.sub_keywords.length === 0) {
    errs.push("sub_keywords는 1개 이상 필요");
  }
  if (
    inp.target_awareness_level &&
    !["L1", "L2", "L3", "L4"].includes(inp.target_awareness_level)
  ) {
    errs.push("target_awareness_level은 L1~L4 중 하나");
  }
  if (errs.length) {
    throw new Error(`입력 검증 실패: ${errs.join(", ")}`);
  }
}

async function loadMethodPrompt(methodId: number): Promise<string> {
  const common = await loadPromptFile("00_common_ontology.md");
  const methodFile = METHOD_FILENAMES[methodId];
  if (!methodFile) throw new Error(`알 수 없는 method_id: ${methodId}`);
  const method = await loadPromptFile(methodFile);
  return common + "\n\n" + method;
}

function buildInputSection(inp: BlogGenerationInput): string {
  const opts = { ...DEFAULT_OPTIONS, ...(inp.generation_options ?? {}) };
  const persona = inp.persona ?? "30대 경영자/대표";
  const authorPersona = inp.author_persona ?? "";
  const awareness = inp.target_awareness_level ?? "L2";

  const lines: string[] = [
    "═══════════════════════════════════════════════",
    "[입력 정보] — 이 정보를 기반으로 글을 작성하세요",
    "═══════════════════════════════════════════════",
    "",
    `- **글 주제(topic)**: ${inp.topic}`,
    `- **메인 키워드(main_keyword)**: ${inp.main_keyword}`,
    `- **서브 키워드(sub_keywords)**: ${inp.sub_keywords.join(", ")}`,
    `- **타겟 인지단계(target_awareness_level)**: ${awareness}`,
    `- **독자 페르소나(persona, 글을 *읽는* 사람)**: ${persona}`,
    `- **작성자 페르소나(author_persona, 글을 *쓰는* 사람의 톤·말투·전문성)**: ${authorPersona || "(미지정)"}`,
    `- **방식(method_id)**: ${inp.method_id} — ${METHOD_LABELS[inp.method_id] ?? ""}`,
  ];

  if (inp.brand_voice && (inp.brand_voice.author_identity || inp.brand_voice.consultancy_name)) {
    lines.push("- **브랜드 보이스**:");
    if (inp.brand_voice.author_identity) lines.push(`    - 작성자 정체성: ${inp.brand_voice.author_identity}`);
    if (inp.brand_voice.consultancy_name) lines.push(`    - 소속: ${inp.brand_voice.consultancy_name}`);
  }

  if (inp.domain_info) {
    lines.push("");
    lines.push("**도메인 정보(domain_info)** — 글에 반영할 사실 데이터:");
    lines.push("```json");
    lines.push(JSON.stringify(inp.domain_info, null, 2));
    lines.push("```");
  }

  lines.push(
    "",
    "**생성 제약**:",
    `- 본문 최소 글자수: ${opts.min_body_char_count}자`,
    `- 공리 통과율 임계값: ${(opts.axiom_pass_threshold * 100).toFixed(0)}%`,
  );
  return lines.join("\n");
}

/**
 * 도메인 패키지 데이터(Ontology A·B values·D values·Lexicon)를 LLM에 주입.
 * 3축 좌표(level/intent/jtbd)에 해당하는 reader_data만 골라서 컨텍스트로 제공.
 */
function buildDomainSection(inp: BlogGenerationInput): string {
  const pack = inp.domain_pack;
  if (!pack) return "";

  const lvl = (inp.target_awareness_level ?? "L2") as "L1" | "L2" | "L3" | "L4";
  const intent = inp.search_intent;
  const jtbd = inp.jtbd_type;
  const personaForLevel = pack.reader[lvl];
  const intentPatterns = intent ? pack.reader.intent_patterns[intent] : undefined;
  const jtbdValue = jtbd ? pack.reader.jtbd_value_map[jtbd] : undefined;

  const lines: string[] = [
    "═══════════════════════════════════════════════",
    `[도메인 패키지 — ${pack.domainName} (${pack.domainCode})]`,
    "═══════════════════════════════════════════════",
    "",
    "## Ontology D — 우산 포지셔닝 (모든 글이 일관되게 따라야 할 톤)",
    `- target_audience: ${pack.positioning.target_audience}`,
    `- competitive_reference: ${pack.positioning.competitive_reference}`,
    `- differentiating_benefit: **${pack.positioning.differentiating_benefit}** (단어 1개 선점)`,
    `- category: ${pack.positioning.category}`,
    `- reason_to_believe (RTB):`,
    ...pack.positioning.reason_to_believe.map((r) => `    - ${r}`),
    "",
    "## 4C 공리 변수 슬롯",
    `- 공리 #11 가치명제 패턴: "${pack.positioning.value_proposition_pattern}"`,
    `  → 글 첫 100자 안에 위 형식의 명시 문장 등장 필수`,
    `- 공리 #12 핵심답 형식: "${pack.positioning.core_answer_type}"`,
    `  → 글 첫 화면(상단 박스 또는 첫 200자)에 위치 필수`,
    "",
    "## 활성화된 Brand Voice 공리 (반드시 준수)",
    ...pack.activeBrandVoiceAxioms.map((bv) => `- ${bv}`),
    "",
    `## 독자 페르소나 — 인지단계 ${lvl} (이 글의 좌표)`,
    `**대표고민** (글 도입부 공감 후킹·본문 사례에 변형해서 녹이세요. 직접 인용 금지):`,
    ...personaForLevel.pains.map((p) => `- ${p}`),
    "",
    "**구매동인** (글이 제공해야 하는 가치):",
    ...personaForLevel.triggers.map((t) => `- ${t}`),
  ];

  if (intent && intentPatterns && intentPatterns.length > 0) {
    lines.push(
      "",
      `## 검색의도 — ${intent} (이 글의 좌표)`,
      "**키워드 패턴** (본문에 자연스럽게 등장시켜 SEO 매칭):",
      ...intentPatterns.map((p) => `- ${p}`),
    );
  }

  if (jtbd && jtbdValue) {
    lines.push(
      "",
      `## JTBD — ${jtbd} (이 글의 좌표)`,
      `**가치명제**: ${jtbdValue}`,
      `→ 글이 위 가치를 명확히 제공하는지 검증.`,
    );
  }

  // 어휘집
  if (pack.lexicon.terms.length > 0 || pack.lexicon.forbidden.length > 0) {
    lines.push("", "## Domain Lexicon (어휘 가이드)");

    if (pack.lexicon.terms.length > 0) {
      lines.push("**전문 용어 (정확히 사용)**:");
      for (const t of pack.lexicon.terms.slice(0, 20)) {
        lines.push(`- ${t.term}: ${t.definition} (일반인 표현: "${t.plain}")`);
      }
    }

    if (pack.lexicon.confusables.length > 0) {
      lines.push("", "**자주 혼동되는 용어 (구분해서 사용)**:");
      for (const c of pack.lexicon.confusables) {
        lines.push(`- ${c.a} vs ${c.b}: ${c.distinction}`);
      }
    }

    if (pack.lexicon.forbidden.length > 0) {
      lines.push("", "**❌ 사용 금지 표현**:");
      for (const f of pack.lexicon.forbidden) {
        lines.push(`- "${f.expression}" — ${f.reason}`);
      }
    }

    if (pack.lexicon.recommended.length > 0) {
      lines.push("", "**✅ 권장 표현**:");
      for (const r of pack.lexicon.recommended) {
        lines.push(`- ${r.situation}: "${r.expression}"`);
      }
    }
  }

  // 도메인 클래스 정의 (Ontology A 마크다운 그대로)
  if (pack.classMarkdown && pack.classMarkdown.trim()) {
    lines.push(
      "",
      "## Ontology A — 도메인 클래스 정의",
      pack.classMarkdown.trim(),
    );
  }

  return lines.join("\n");
}

/**
 * 같은 키워드의 상위 노출 블로그를 LLM에게 참고용으로 전달.
 * 표절·요약 금지 + 차별화 인사이트 발굴 지시 포함.
 */
function buildResearchSection(items: ResearchContextItem[]): string {
  if (!items || items.length === 0) return "";

  const lines: string[] = [
    "",
    "═══════════════════════════════════════════════",
    `[참고 자료] — 같은 키워드 상위 노출 블로그 ${items.length}개`,
    "═══════════════════════════════════════════════",
    "",
    "⚠️ 아래는 같은 메인 키워드로 검색했을 때 네이버 상위에 노출된 블로그입니다.",
    "다음 지침을 반드시 따르세요:",
    "1. 이들과 **차별화된 각도**로 작성 (같은 정보의 단순 재배열 금지)",
    "2. 이들이 다루지 않은 **추가 키워드·사실·관점**을 발굴해 본문에 반영",
    "3. 표현·문장 **표절 절대 금지**. 표현이 비슷하면 자체 검열로 다시 작성",
    "4. 단, 사실 데이터(법령·금액·일정 등)는 정확성 우선 — 동일해도 무방",
    "",
  ];

  items.forEach((it, i) => {
    lines.push(`### 참고 ${i + 1}. ${it.title || "(제목 없음)"}`);
    if (it.bloggername) lines.push(`- 블로거: ${it.bloggername}`);
    if (it.link) lines.push(`- 링크: ${it.link}`);
    if (it.description) lines.push(`- 요약: ${it.description}`);
    if (it.body) {
      lines.push(`- 본문 발췌:\n\`\`\`\n${it.body}\n\`\`\``);
    }
    lines.push("");
  });

  return lines.join("\n");
}

const OUTPUT_FORMAT_INSTRUCTION = `═══════════════════════════════════════════════
[출력 포맷] — 반드시 아래 6개 섹션을 순서대로 포함하세요
═══════════════════════════════════════════════

응답은 **JSON 객체 하나**로만 출력합니다. 다른 설명·코드펜스 금지.
정확히 아래 스키마를 따르세요:

\`\`\`json
{
  "mapping": {
    "domain_structure": { ... },
    "reader_mapping": {
      "awareness_level": "L1|L2|L3|L4",
      "pain_points_top3": ["...", "...", "..."],
      "strategy_position": "..."
    },
    "keyword_map": [
      { "location": "제목/도입/본론/결론", "keyword": "...", "count": 3 }
    ]
  },
  "titles": [
    {
      "rank": 1, "title": "...",
      "main_keyword_position": "앞/중/뒤",
      "click_driver": "...", "ctr_stars": 5
    },
    { "rank": 2, "title": "...", "main_keyword_position": "...", "click_driver": "...", "ctr_stars": 4 },
    { "rank": 3, "title": "...", "main_keyword_position": "...", "click_driver": "...", "ctr_stars": 3 }
  ],
  "body": "§3. 본문 전체 (네이버 블로그 태그 포함). 1,500자 이상. 이미지 자리는 [IMG: alt_text] 형식.",
  "axiom_check": {
    "total": 17,
    "passed": 17,
    "failed": 0,
    "pass_rate": "17/17",
    "items": [
      { "number": 1, "rule": "공리 문구", "passed": true, "evidence": "본문에서의 근거" }
    ],
    "failed_rules": []
  },
  "suggestions": {
    "current_post_improvements": "...",
    "series_strategy": {
      "related_levels": ["L1", "L3"],
      "next_posts": ["...", "..."]
    }
  },
  "meta": {
    "method_id": 6,
    "main_keyword": "...",
    "sub_keywords": ["...", "..."],
    "target_awareness_level": "L2",
    "content_type": "자격진단형|절차형|비교형|...",
    "related_series": ["..."],
    "internal_link_candidates": ["..."],
    "reference_sources": ["..."],
    "estimated_char_count": 2400,
    "axiom_pass_rate": "17/17",
    "last_verified": "YYYY-MM-DD"
  }
}
\`\`\`

**엄수 사항**:
- \`body\`는 실제 블로그에 그대로 붙여 쓸 수 있는 완성본.
  - **1,500~2,500자**. 1,300자 미만이면 무효 응답으로 간주.
  - 단순 나열·결론 반복 금지. 섹션마다 도입(맥락) → 본문(사실+예시) → 소결 구조로 입체적으로 전개.
  - \`[h2]\` 태그로 4~6개 섹션 분할. 각 섹션 내부에도 단락 2~3개.
- 사실 데이터(법령·금액·일정·자격 등)가 \`domain_info\`나 참고 자료에 명시되지 않은 경우:
  - 추측·창작 절대 금지
  - "확인 필요" 또는 "공식 공고 참조"로 명시
- \`axiom_check.items\`는 방식별 공리 전체(공통 10개 + 방식 특화)를 **하나도 빠짐없이** 포함.
- JSON 외 다른 텍스트 일체 금지 (설명·마크다운 펜스 포함).`;

export async function buildFullPrompt(inp: BlogGenerationInput): Promise<string> {
  validateInput(inp);

  // 방식 6 (정부지원사업 정보성)은 domain_info 사실상 필수 — 빈 상태면 글 품질 급락
  if (
    inp.method_id === 6 &&
    (!inp.domain_info || Object.keys(inp.domain_info).length === 0)
  ) {
    console.warn(
      "[prompt-builder] 방식 6은 domain_info 제공이 강력히 권장됩니다. 빈 상태로 진행하면 '확인필요' 항목만 잔뜩 나올 수 있습니다.",
    );
  }

  const methodPrompt = await loadMethodPrompt(inp.method_id);
  const substituted = substituteVariables(methodPrompt, inp);
  const inputSection = buildInputSection(inp);
  const domainSection = buildDomainSection(inp); // Ontology v2 — 도메인 패키지 주입
  const researchSection = buildResearchSection(inp.research_context ?? []);
  return [substituted, inputSection, domainSection, researchSection, OUTPUT_FORMAT_INSTRUCTION]
    .filter(Boolean)
    .join("\n\n");
}
