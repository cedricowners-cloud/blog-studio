# prompt_builder.ts 코드 리뷰 (온톨로지 충실성 점검)

> **대상 파일**: `prompt_builder.ts`
> **리뷰 기준**: `blog_ontology_v2/PRD.md` + `prompts/00_common_ontology.md` 의도 부합성
> **요청**: Claude Code에게 이 문서 전달 → P0~P1 항목 우선 수정 요청

---

## ✅ 잘된 점 (PRD 부합)

1. **공통 + 방식 분리 로딩** (`loadMethodPrompt`) — 온톨로지의 "공통은 공통으로, 특화는 확장으로" 원칙 정확히 구현
2. **프롬프트 캐싱** (`promptCache`) — 같은 파일 반복 IO 방지, 운영 환경 적합
3. **brand_voice 옵셔널 처리** — 값 있을 때만 입력 섹션에 추가, 하위 호환 유지
4. **JSON 출력 강제** — 파싱 안정성을 위해 마크다운 → JSON 스키마로 전환한 판단 좋음
5. **공리 전체(공통+방식 특화) 포함 명시** — 17개 통과율 표기 의도 정확

---

## 🟡 보완 권장 (온톨로지 충실성)

### ⚠️ 1. [P0] 변수 치환이 안 되고 있어요 (가장 중요)

**문제**: `00_common_ontology.md`에 `{topic}`, `{main_keyword}`, `{author_identity}` 같은 **자리표시자 변수**가 있는데, 현재 코드는 이걸 치환 안 하고 그냥 입력 섹션을 별도로 붙이는 방식입니다.

```typescript
// 현재 방식
return [methodPrompt, inputSection, OUTPUT_FORMAT_INSTRUCTION].join("\n\n");
```

**결과**: 모델이 받는 프롬프트에 `{topic}` 같은 미치환 자리표시자가 그대로 남아있어, **온톨로지 정의와 실제 입력값의 연결고리가 끊깁니다.** 모델이 "이 변수는 무엇인가?"를 추측해야 합니다.

**개선**:
```typescript
function substituteVariables(template: string, inp: BlogGenerationInput): string {
  const brand = inp.brand_voice ?? {};
  const replacements: Record<string, string> = {
    "{topic}": inp.topic,
    "{main_keyword}": inp.main_keyword,
    "{sub_keywords}": inp.sub_keywords.join(", "),
    "{target_awareness_level}": inp.target_awareness_level ?? "L2",
    "{domain_info}": inp.domain_info ? JSON.stringify(inp.domain_info, null, 2) : "(없음)",
    "{persona}": inp.persona ?? "30대 경영자/대표",
    "{author_identity}": brand.author_identity ?? "",
    "{consultancy_name}": brand.consultancy_name ?? "",
  };
  return Object.entries(replacements).reduce(
    (acc, [k, v]) => acc.split(k).join(v),  // .replaceAll polyfill 안전
    template
  );
}

export async function buildFullPrompt(inp: BlogGenerationInput): Promise<string> {
  const methodPrompt = await loadMethodPrompt(inp.method_id);
  const substituted = substituteVariables(methodPrompt, inp);  // ★ 추가
  const inputSection = buildInputSection(inp);
  return [substituted, inputSection, OUTPUT_FORMAT_INSTRUCTION].join("\n\n");
}
```

이게 PRD §4의 의사코드(`template.format(...)`)에서 의도한 핵심 동작입니다.

---

### ⚠️ 2. [P1] 필수 입력 검증이 없어요

**문제**: `method_id`, `topic`, `main_keyword`, `sub_keywords`는 input_schema에서 **필수**로 정의돼 있는데 코드에서 검증을 안 합니다. 누락 시 LLM에 빈 값이 그대로 전달되어 **온톨로지 매핑 단계가 통째로 깨집니다**.

**개선**: `buildFullPrompt` 진입부에 검증 추가

```typescript
function validateInput(inp: BlogGenerationInput): void {
  const errs: string[] = [];
  if (!inp.method_id || inp.method_id < 1 || inp.method_id > 6)
    errs.push("method_id는 1~6 사이여야 합니다");
  if (!inp.topic?.trim()) errs.push("topic 필수");
  if (!inp.main_keyword?.trim()) errs.push("main_keyword 필수");
  if (!Array.isArray(inp.sub_keywords) || inp.sub_keywords.length === 0)
    errs.push("sub_keywords는 1개 이상 필요");
  if (inp.target_awareness_level && !["L1","L2","L3","L4"].includes(inp.target_awareness_level))
    errs.push("target_awareness_level은 L1~L4");
  if (errs.length) throw new Error(`입력 검증 실패: ${errs.join(", ")}`);
}
```

---

### ⚠️ 3. [P2] 방식 6에서 domain_info가 비었을 때 처리

**문제**: 방식 6(`crank_info`)은 PRD에서 `domain_info`가 **사실상 필수**입니다. 정부지원사업 정보 없이 글을 쓰면 온톨로지 A 매핑이 빈 객체가 되어 "확인필요" 항목만 잔뜩 나옵니다.

**개선**: 경고 또는 차단

```typescript
if (inp.method_id === 6 && (!inp.domain_info || Object.keys(inp.domain_info).length === 0)) {
  console.warn("[경고] 방식 6은 domain_info가 권장됩니다. 빈 상태로 진행하면 글 품질이 크게 떨어질 수 있습니다.");
  // 또는 strict 모드면 throw
}
```

---

### ⚠️ 4. [P1] brand_voice 변수의 빈 문자열 위험

**문제**: brand_voice가 없을 때 변수를 빈 문자열로 치환하면, 프롬프트에 `"공공조달행정사인 으로서..."` 같은 어색한 문장이 남을 수 있습니다.

**개선 방향 2가지**:

**옵션 A**: 변수가 없으면 brand_voice 섹션 자체를 프롬프트에서 제거

```typescript
function stripBrandVoiceSection(template: string): string {
  // [브랜드 보이스] 섹션 전체를 정규식으로 제거
  return template.replace(
    /═+\n\[브랜드 보이스[\s\S]*?(?=═+\n\[)/,
    ""
  );
}
```

**옵션 B**: 공통 온톨로지 자체에 조건부 지시 추가

```
{author_identity}가 비어있으면 [브랜드 보이스] 섹션 전체를 무시하고 일반 글로 작성하라.
```

**권장**: 옵션 B가 더 간단하고 prompt-as-code 원칙에 맞습니다.

---

## 🟢 사소한 개선 (선택)

### 5. [P3] 캐시 무효화 전략

운영 중 프롬프트 파일을 수정해도 캐시 때문에 반영 안 됩니다. 개발 환경에선 캐시 끄는 옵션 추가 권장.

```typescript
const CACHE_ENABLED = process.env.NODE_ENV === "production";
// loadPromptFile에서 CACHE_ENABLED만 캐시 사용
```

### 6. 출력 포맷 지시의 위치

현재 맨 끝에 있는데, **온톨로지 정의 → 입력 정보 → 출력 형식** 흐름이 자연스럽게 잘 됨. 그대로 유지 OK.

### 7. JSON-only 강제와 LLM 안전장치

일부 모델(특히 Gemini)이 코드펜스를 자꾸 붙입니다. 파서 쪽에서 `` ```json ... ``` `` 펜스 제거 로직을 반드시 넣어두세요. 빌더 책임은 아님.

---

## 📋 우선순위별 수정 권장 순서

| 우선순위 | 항목 | 영향도 | 난이도 |
|---------|------|-------|-------|
| 🔴 P0 | 1. 변수 치환 추가 | **매우 큼** (온톨로지 작동 안 함) | 낮음 |
| 🟡 P1 | 2. 입력 검증 | 큼 (런타임 에러 방지) | 낮음 |
| 🟡 P1 | 4. brand_voice 빈 값 처리 | 중 (문장 어색함) | 낮음 |
| 🟢 P2 | 3. 방식 6 domain_info 경고 | 중 | 낮음 |
| 🟢 P3 | 5. 캐시 무효화 옵션 | 낮음 | 낮음 |

---

## 🎯 종합 평가

- **구조 점수: 9/10** — PRD 의도를 정확히 이해하고 깔끔하게 모듈화함
- **온톨로지 충실성: 6/10** — **변수 치환 누락**이 가장 큰 구멍. 이거 하나만 고치면 9/10 됨
- **운영 안정성: 7/10** — 검증 로직만 보강하면 충분

**결론**: 뼈대는 매우 잘 짜였고, **P0 한 가지(변수 치환)만 반드시 고쳐야** 온톨로지 시스템이 의도대로 작동합니다. 다른 건 단계적 개선 가능합니다.

---

## 🛠️ Claude Code에게 요청할 내용 (참고 템플릿)

```
prompt_builder.ts 리뷰 결과를 prompt_builder_review.md로 첨부했어.
다음 항목을 우선순위대로 반영해줘:

1. [P0] 변수 치환 함수 substituteVariables() 추가
   - 공통 온톨로지의 {topic}, {main_keyword}, {sub_keywords},
     {target_awareness_level}, {domain_info}, {persona},
     {author_identity}, {consultancy_name} 모두 치환
   - buildFullPrompt에서 methodPrompt 로드 직후 호출

2. [P1] validateInput() 함수 추가
   - method_id 1~6 범위, topic/main_keyword 필수,
     sub_keywords 1개 이상, target_awareness_level enum 체크
   - buildFullPrompt 진입부에 호출

3. [P1] brand_voice 빈 값 처리 (옵션 B 권장)
   - 공통 온톨로지 [브랜드 보이스] 섹션에
     "{author_identity}가 비어있으면 이 섹션 전체 무시" 지시 추가
   - 00_common_ontology.md 파일 직접 수정

4. [P2] 방식 6 domain_info 경고
   - method_id===6 && domain_info 비었을 때 console.warn

수정 후 변경된 파일과 변경 요약을 보여줘.
```