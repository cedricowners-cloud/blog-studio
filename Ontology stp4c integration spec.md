# 온톨로지 시스템 STP·4C 통합 + 도메인 독립화 명세서

> **목적**: 기존 네이버 블로그 자동 작성 시스템(온톨로지 기반 v1)에 마케팅 전략 프레임워크(STP·4C)를 통합하고, 동시에 시스템을 **도메인 독립적 플랫폼**으로 재설계한다.
>
> **대상**: Claude Code (구현 에이전트)
>
> **선행 문서**: `온톨로지의 개념과 실무 활용` (v1 시스템 문서)

---

## TL;DR (Claude Code 실행 요약)

이 문서는 기존 v1 시스템의 **확장 명세**다. 다음 순서로 작업한다.

1. **2장**의 신규 개념 4가지 이해 (Ontology D, Domain Pack, Ontology B v2, 4C Axioms)
2. **3장**의 신규 아키텍처에 따라 디렉토리 구조 재편
3. **4장**의 Ontology D 스키마 파일 작성 (`positioning_schema.md`)
4. **5장**의 Domain Pack 템플릿 및 첫 번째 패키지(`public_procurement`) 작성
5. **6장**의 Ontology B v2 골격 + 4C 공리 추가
6. **7장**의 신규 모듈 구현 (`domain_loader.js`, `strategy_recommender.js`)
7. **8장**의 DB 스키마 마이그레이션
8. **9장**의 테스트 케이스로 검증
9. **10장**의 Phase별 배포 체크리스트로 단계 진행

각 Phase 완료 시 사용자(설희)에게 확인 요청. 도메인 패키지 추가 시 사용자에게 도메인 정보 입력 요청.

---

## 1. 프로젝트 개요

### 1-1. 배경

v1 시스템(온톨로지 기반 SEO 프롬프트)은 다음 두 가지 한계를 가진다.

**한계 A. 전략적 의사결정 레이어 부재**
- 알고리즘 최적화(Ontology C)는 정교하나, 마케팅 전략(누구에게·어떤 가치를·어떻게)이 시스템 차원에서 강제되지 않음
- 6개 전략 프롬프트가 *알고리즘 타겟*은 다르나 *독자 타겟의 우선순위*는 평면적
- 결과: 같은 블로그 안의 글들이 톤·포지션이 분열될 위험

**한계 B. 도메인 결합도 과다**
- v1은 사실상 *공공조달행정사 전용* 구조 (Ontology A는 정부지원사업, B의 고민·동인도 같은 도메인 가정)
- 다른 전문가 블로그(법률·의료·세무·AI 컨설팅 등) 운영 시 시스템 전체를 재작성해야 함
- 결과: 자산화·플랫폼화 불가능

### 1-2. 목표

| 항목 | v1 (기존) | v2 (목표) |
|---|---|---|
| 전략 의사결정 | 사용자 직관 | STP·4C 시스템 강제 |
| 포지셔닝 일관성 | 암묵적 | Ontology D로 명시·강제 |
| 독자 모델 | 인지단계 1축 (L1~L4) | 3축 매트릭스 (인지·의도·JTBD) |
| 도메인 확장성 | 코드 수정 필요 | 도메인 패키지 교체로 해결 |
| 공리 검증 | 알고리즘 10개 | 알고리즘 10 + 4C 4 + Brand Voice N |
| 신규 도메인 추가 비용 | 시스템 재작성 | 패키지 1개 작성 (4~5시간) |

### 1-3. 범위

**IN**
- Ontology D (Positioning Schema) 신설
- Ontology B v2 확장 (검색의도·JTBD 축 추가)
- 4C 공리 4개 추가 + Brand Voice 공리 시스템
- Domain Pack 아키텍처 (디렉토리·로더·DB)
- Strategy Recommender 모듈 신설
- DB 스키마 확장
- 첫 번째 Domain Pack 작성 (`public_procurement` - 레퍼런스용)

**OUT (v1 유지)**
- 6개 전략 프롬프트 자체 (구조 유지, Ontology D 주입만 추가)
- Renderer / Parser / Validator / Logger 핵심 로직
- 발행 엔진
- 네이버 크롤러, 다계정 관리

---

## 2. 핵심 개념 (4가지 신규)

### 2-1. Ontology D — Brand Positioning Schema

블로그 전체에 적용되는 **우산 포지셔닝**을 정의하는 메타 스키마. 도메인 독립적 *틀*이며, 도메인 패키지에서 *값*을 채워 넣음.

**구성 요소**
- Positioning Statement (5요소: target / competitor / benefit / category / RTB)
- Differentiating Benefit (단어 1개 선점 — Volvo "안전" 원칙)
- Brand Voice 공리 (선택된 benefit에 따라 자동 활성화)

**기능**: 6개 전략 프롬프트가 어떤 알고리즘을 타겟하든, 모든 글은 Ontology D의 우산 아래 일관된 톤·관점을 유지함.

### 2-2. Domain Pack — 도메인 패키지

도메인별 *값*을 모아둔 패키지. 시스템 코드 변경 없이 패키지 교체만으로 다른 전문가 블로그 운영 가능.

**패키지 구성 (4개 파일)**
1. `ontology_a.md` — 도메인 자체의 클래스·속성·관계·제외요건
2. `ontology_b_values.md` — L1~L4 각 단계의 대표고민·구매동인 (도메인별 구체값)
3. `ontology_d_values.md` — 이 블로그의 포지셔닝 5요소 채워진 값
4. `domain_lexicon.md` — 전문 용어집·표현 매핑

### 2-3. Ontology B v2 — 독자 다층 모델 (3축 매트릭스)

v1의 단일 축(인지단계)을 3축으로 확장. **공통 골격(축)은 도메인 무관**, 각 축의 *구체값*은 도메인 패키지에서 로드.

| 축 | 값 | 도메인 의존도 |
|---|---|---|
| **인지단계** | L1 / L2 / L3 / L4 | 골격 공통, 단계별 고민은 도메인별 |
| **검색의도** | 정보탐색 / 자격진단 / 절차해결 / 문제해결 / 비교선택 | 공통 |
| **JTBD** | 시간절약 / 리스크회피 / 의사결정지원 / 자기효능감 / 위임판단 | 공통 |

### 2-4. 4C 공리 — Lauterborn 4C 시스템 강제

알고리즘 10개 공리에 추가되는 *고객 가치 강제* 공리 4개. 일부 공리는 도메인별 변수 슬롯을 가짐.

| 공리 | 4C 요소 | 도메인 의존 |
|---|---|---|
| #11 Customer Value | Customer Value | 변수 슬롯 (가치명제 패턴) |
| #12 Cost | Cost | 변수 슬롯 (핵심답 유형) |
| #13 Convenience | Convenience | 무관 |
| #14 Communication | Communication | 무관 |

---

## 3. 신규 시스템 아키텍처

### 3-1. 처리 흐름

```
[사용자 입력]
  ├─ 도메인 선택 (domain_code)
  ├─ 주제, 메인키워드, 서브키워드
  ├─ 인지단계 (L1~L4)
  ├─ [신규] 검색의도
  ├─ [신규] JTBD
  └─ (선택) 도메인 정보 JSON
  ↓
[Domain Loader] ★ 신규
  → 선택된 도메인 패키지 로드
  → Ontology A, B-values, D-values, Lexicon 메모리 주입
  ↓
[Strategy Recommender] ★ 신규
  → 입력 좌표(L·의도·JTBD)로 6개 전략 중 최적 추천
  → 사용자가 다른 전략 선택 시 매칭 여부 로깅
  ↓
[Prompt Renderer] (확장)
  공통 온톨로지(B골격, C, D스키마) 
  + 도메인 패키지 (A, B값, D값, 어휘) 
  + 전략 프롬프트 
  + 사용자 입력 
  → 최종 프롬프트
  ↓
[LLM 호출 - Claude/Gemini/GPT]
  ↓
[Response Parser] (v1 유지)
  ↓
[Axiom Validator] (확장)
  → 알고리즘 공리 10개 (공통)
  + 4C 공리 4개 (변수 슬롯에 도메인값 주입)
  + Brand Voice 공리 (Ontology D 선택값에 따라 활성화)
  → ✗ 1개 이상이면 재생성 (최대 2회)
  ↓
[Logger] (확장)
  → domain_id, axiom_category 분리 로깅
  ↓
[Publisher] (v1 유지)
```

### 3-2. 신규 디렉토리 구조

```
/project
├── prompts/
│   ├── ontology/
│   │   ├── common.md                    (B 골격, C 전체) - v1 수정
│   │   └── positioning_schema.md        ★ 신규 (D 빈 양식)
│   └── strategies/                      (6개 - v1 유지)
│       ├── crank_dia.md
│       ├── alcon_mic.md
│       ├── aeo_brief.md
│       ├── homefeed.md
│       ├── insight_edge.md
│       └── crank_info.md
│
├── domain_packs/                        ★ 신규 디렉토리
│   ├── _template/                       (신규 도메인 작성 템플릿)
│   │   ├── ontology_a.md
│   │   ├── ontology_b_values.md
│   │   ├── ontology_d_values.md
│   │   └── domain_lexicon.md
│   │
│   └── public_procurement/              (첫 번째 도메인 - 레퍼런스)
│       ├── ontology_a.md
│       ├── ontology_b_values.md
│       ├── ontology_d_values.md
│       └── domain_lexicon.md
│
├── src/
│   ├── domain_loader.js                 ★ 신규
│   ├── strategy_recommender.js          ★ 신규
│   ├── renderer.js                      (수정 - 패키지 주입)
│   ├── parser.js                        (v1 유지)
│   ├── validator.js                     (수정 - 4C·Brand Voice 공리 추가)
│   ├── logger.js                        (수정 - 도메인·카테고리 분리)
│   └── orchestrator.js                  (수정 - 신규 모듈 통합)
│
├── db/
│   └── migrations/
│       ├── 001_blog_posts.sql           (v1)
│       └── 002_domain_pack_extension.sql ★ 신규
│
└── tests/
    ├── test_cases.json                  (v1 - 도메인별 케이스 추가)
    └── domain_validation.json           ★ 신규
```

---

## 4. Ontology D — Positioning Schema 명세

### 4-1. 파일: `prompts/ontology/positioning_schema.md`

```markdown
# Ontology D — Brand Positioning Schema

## D-1. Positioning Statement Template

target_audience: <블로그가 표적하는 독자 정의 - 도메인 패키지에서 주입>
competitive_reference: <이 블로그가 경쟁하는 정보 출처>
differentiating_benefit: <차별적 편익 - 단어 1~2개 - 아래 풀에서 선택>
category: <카테고리 자기 정의 또는 재정의>
reason_to_believe: <RTB - 자격·경험·실적·데이터>

## D-2. Differentiating Benefit Pool (도메인 무관 공통 풀)

| 그룹 | 후보 단어 | 적합 도메인 예시 |
|---|---|---|
| 신뢰형 | 안전 / 정확 / 검증 | 법률·의료·세무·정책자금 |
| 효율형 | 신속 / 간결 / 핵심 | IT·자동화·생산성 |
| 깊이형 | 심층 / 통찰 / 분석 | 컨설팅·연구·전략 |
| 관계형 | 동반 / 공감 / 안심 | 의료·심리·교육 |
| 차별형 | 독창 / 반대 / 재정의 | AI·트렌드·신산업 |

**제약**: 1개 단어 선택 (Volvo "안전" 원칙). 2개 선택 시 두 단어 모두 약화됨.

## D-3. Brand Voice 공리 자동 활성화 매핑

선택된 differentiating_benefit에 따라 활성화되는 공리 세트:

### "안전" 선택 시
- BV1. 모든 글에 *리스크·실패사례* 최소 1건 명시
- BV2. *제외요건·예외조항* 명시 강제
- BV3. 단정적 표현 자제, *조건부 표현* 우선

### "신속" 선택 시
- BV1. *핵심 답*이 글 첫 화면(상단 박스) 안에 위치
- BV2. 글 길이 1,500~2,000자 상한 (초과 금지)
- BV3. 모든 섹션에 *3초 요약* 박스 포함

### "심층" 선택 시
- BV1. *일반론 반박 구조* 강제 ("흔히 ~라고 하지만...")
- BV2. *데이터·사례 인용* 최소 3건
- BV3. 차별화 포인트를 글 도입부에 명시

### "동반" 선택 시
- BV1. 1인칭 ("저희가", "함께") 최소 3회
- BV2. *공감 표현* ("막막하시죠?", "걱정 마세요") 최소 1회
- BV3. 마무리에 *지속 관계 신호* (다음 글·상담 등)

### "독창" 선택 시
- BV1. 글 도입부에 *기존 통념* 명시
- BV2. *반박·재정의* 구조 강제
- BV3. *새로운 프레임* 제시 + 실천 방법 연결

## D-4. 출력 시 Validator 입력 형식

도메인 패키지의 ontology_d_values.md가 다음 JSON으로 파싱되어 Validator에 전달:

```json
{
  "target_audience": "string",
  "competitive_reference": "string",
  "differentiating_benefit": "안전|신속|심층|동반|독창",
  "category": "string",
  "reason_to_believe": ["string", "string"],
  "active_brand_voice_axioms": ["BV1", "BV2", "BV3"]
}
```
```

---

## 5. Domain Pack 명세

### 5-1. 패키지 템플릿 — `domain_packs/_template/`

#### 5-1-1. `ontology_a.md` (도메인 클래스 정의)

```markdown
# Ontology A — <도메인명> 도메인 구조

## Class: <핵심개념1>
├─ 속성(Property)
│  ├─ <속성1>, <속성2>, ...
│  └─ <분류값>: {값1, 값2, 값3}
│
├─ <SubClass1>
│  └─ ...
│
└─ <SubClass2> ★중요표시
   └─ ...

## Class: <핵심개념2>
...

## Relation: <도메인명> 관계 그래프
- <개념A> --<관계>--> <개념B> (조건)
- ...
```

**작성 가이드**
- 핵심 클래스 5~10개
- 각 클래스의 속성 5개 이상
- 제외요건·예외 케이스는 별도 SubClass로
- 클래스 간 관계 최소 5개 명시

#### 5-1-2. `ontology_b_values.md` (독자 단계별 값)

```markdown
# Ontology B Values — <도메인명> 독자 인스턴스

## L1 (존재 자체를 모름)
대표고민:
- <고민1>
- <고민2>
- <고민3>
구매동인:
- <동인1>

## L2 (있는 건 아는데 본인 대상인지 모름)
대표고민: ...
구매동인: ...

## L3 (대상인 건 아는데 절차를 모름)
...

## L4 (해봤는데 실패·반려 경험)
...

## 검색의도별 키워드 패턴

| 검색의도 | 키워드 패턴 예시 |
|---|---|
| 정보탐색 | <패턴1>, <패턴2> |
| 자격진단 | <패턴1>, <패턴2> |
| 절차해결 | <패턴1>, <패턴2> |
| 문제해결 | <패턴1>, <패턴2> |
| 비교선택 | <패턴1>, <패턴2> |

## JTBD별 가치명제 매핑

| JTBD | 글이 제공해야 하는 핵심 가치 |
|---|---|
| 시간절약 | <이 도메인에서 시간절약이 의미하는 구체값> |
| 리스크회피 | <리스크회피의 구체값> |
| 의사결정지원 | <구체값> |
| 자기효능감 | <구체값> |
| 위임판단 | <구체값> |
```

#### 5-1-3. `ontology_d_values.md` (포지셔닝 값)

```markdown
# Ontology D Values — <블로그명> 포지셔닝

## Positioning Statement
target_audience: <표적 독자 - 구체적으로>
competitive_reference: <경쟁 정보 출처>
differentiating_benefit: <안전|신속|심층|동반|독창 중 1개>
category: <블로그 카테고리 자기 정의>
reason_to_believe:
  - <RTB1>
  - <RTB2>
  - <RTB3>

## Brand Voice 공리 활성화
active_brand_voice_axioms: [BV1, BV2, BV3]
(선택된 differentiating_benefit에 따라 D-3 매핑에서 자동 결정)

## 4C 공리 변수 슬롯 값

### Customer Value 가치명제 패턴 (공리 #11)
value_proposition_pattern: "이 글을 읽으면 {<도메인 핵심값>}을 알 수 있습니다"

### Cost 핵심답 유형 (공리 #12)
core_answer_type: <자가진단 체크리스트|판단 기준 표|증상 매칭표|...>
```

#### 5-1-4. `domain_lexicon.md` (어휘집)

```markdown
# Domain Lexicon — <도메인명>

## 전문 용어 정의
| 용어 | 정의 | 일반인 표현 |
|---|---|---|
| <전문어1> | <정의> | <쉬운 표현> |
| ... | ... | ... |

## 자주 혼동되는 용어
- <A> vs <B>: <차이 설명>
- ...

## 사용 금지 표현
- <금지표현1>: <이유>
- ...

## 권장 표현
- <상황1>: <권장 표현>
- ...
```

### 5-2. 첫 번째 도메인 패키지 — `domain_packs/public_procurement/`

**작성 지침**: v1 시스템의 `crank_info.md`와 기존 Ontology A 정의를 참고하여 위 템플릿에 채워 넣음. 사용자(설희)에게 ontology_d_values.md의 differentiating_benefit 선택 확인 요청.

**기본 추천값** (사용자 확인 필요):
- differentiating_benefit: `안전` (정책자금 도메인 특성상 리스크 회피가 핵심)
- target_audience: 정책자금·공공조달이 막막한 SME 대표
- core_answer_type: 자가진단 체크리스트

---

## 6. Ontology B v2 + 4C 공리 명세

### 6-1. 파일 수정: `prompts/ontology/common.md`

기존 v1 common.md의 Ontology B 섹션을 다음으로 교체:

```markdown
# Ontology B v2 — 독자 다층 모델

## B-1. 공통 골격 (도메인 무관)

### 축1. 인지단계 (Awareness Level)
L1: 도메인 존재 자체를 모름
L2: 있는 건 아는데 본인 대상인지 모름
L3: 대상인 건 아는데 어떻게 해야 할지 모름
L4: 시도해봤는데 실패·반려 경험

### 축2. 검색의도 (Search Intent)
정보탐색형: "<도메인>이 뭔지"
자격진단형: "내가 대상인지"
절차해결형: "어떻게 진행하지"
문제해결형: "<문제> 발생했는데 어떻게"
비교선택형: "어떤 게 나한테 맞을까"

### 축3. Jobs-to-be-Done (추구편익)
시간절약: 빠르게 답을 얻고 싶다
리스크회피: 실수·실패를 피하고 싶다
의사결정지원: 선택을 명확히 하고 싶다
자기효능감: 직접 해낼 수 있다는 자신감
위임판단: 전문가에게 맡길지 결정

## B-2. 인스턴스 값 주입 지점

각 단계의 *대표고민* / *구매동인* / *키워드 패턴* / *가치명제*는 
선택된 도메인 패키지의 ontology_b_values.md에서 로드됨.

## B-3. 좌표 → 콘텐츠 전략 매핑 (Strategy Recommender 입력)

(L, intent, jtbd) 3축 좌표가 6개 전략 중 최적 추천을 결정함.
매핑 테이블은 src/strategy_recommender.js에서 정의.
```

### 6-2. 파일 수정: `prompts/ontology/common.md`의 Ontology C 섹션

기존 공리 10개 뒤에 다음 추가:

```markdown
## Ontology C v2 — 4C 공리 (신규 추가)

### 공리 #11 — Customer Value
글 첫 100자 안에 도메인 패키지의 `value_proposition_pattern` 형식 문장 등장 필수.

검증 방법: 정규식 매칭 + LLM 자가 평가
✓ 조건: pattern 슬롯이 채워진 명시 문장 존재
✗ 조건: 추상적 도입부, 가치명제 부재

### 공리 #12 — Cost
도메인 패키지의 `core_answer_type`이 글 첫 화면(상단 박스 또는 첫 200자 내) 안에 위치.

검증 방법: 구조 파싱 + 위치 검증
✓ 조건: 박스/표/체크리스트 형식 + 첫 화면 안 위치
✗ 조건: 핵심답이 본문 중간 이후 등장

### 공리 #13 — Convenience
스캐닝 가능 구조 + 내부 링크 ≥2개

검증 방법: 마크다운 구조 분석
✓ 조건: H2/H3 ≥3개 + 강조(**) ≥3회 + 박스/표 ≥1개 + 내부링크 ≥2개
✗ 조건: 위 중 하나라도 미달

### 공리 #14 — Communication
글 마지막에 행동 유도 1개 + 양방향 신호 1개

검증 방법: 글 마지막 300자 내 패턴 매칭
✓ 조건: CTA 1개 (상담/자가진단/다음 글) + 양방향 요청 1개 (댓글/질문/공유)
✗ 조건: 일방적 정보 종결

## Ontology C v2 — Brand Voice 공리 (도메인 D 의존)

선택된 differentiating_benefit에 따라 활성화 (positioning_schema.md D-3 참조).
활성화된 공리 세트는 Validator가 동적으로 검증.
```

---

## 7. 신규 모듈 구현 명세

### 7-1. `src/domain_loader.js`

**책임**: 선택된 도메인 패키지를 로드하여 메모리 객체로 변환.

```javascript
/**
 * Domain Pack Loader
 * 
 * @param {string} domainCode - 도메인 코드 (e.g., 'public_procurement')
 * @returns {Promise<DomainPack>} 로드된 도메인 패키지 객체
 */
async function loadDomainPack(domainCode) {
  // 1. domain_packs/{domainCode}/ 디렉토리 존재 확인
  // 2. 4개 필수 파일 존재 확인:
  //    - ontology_a.md
  //    - ontology_b_values.md
  //    - ontology_d_values.md
  //    - domain_lexicon.md
  // 3. 각 파일 읽어서 파싱
  // 4. ontology_d_values.md의 differentiating_benefit으로
  //    active_brand_voice_axioms 자동 결정
  // 5. 4C 공리 변수 슬롯 값 추출
  // 6. DomainPack 객체 반환
}

/**
 * DomainPack 객체 구조
 */
interface DomainPack {
  domainCode: string;
  ontologyA: string;        // 원문 마크다운
  ontologyBValues: {
    L1: { pains: string[], triggers: string[] },
    L2: { pains: string[], triggers: string[] },
    L3: { pains: string[], triggers: string[] },
    L4: { pains: string[], triggers: string[] },
    intentPatterns: Record<string, string[]>,
    jtbdValueMap: Record<string, string>
  };
  ontologyDValues: {
    targetAudience: string;
    competitiveReference: string;
    differentiatingBenefit: '안전' | '신속' | '심층' | '동반' | '독창';
    category: string;
    reasonToBelieve: string[];
    activeBrandVoiceAxioms: string[];
    valuePropositionPattern: string;  // 공리 #11 슬롯
    coreAnswerType: string;            // 공리 #12 슬롯
  };
  lexicon: {
    terms: Map<string, { definition: string, plainExpression: string }>,
    confusables: Array<{ a: string, b: string, distinction: string }>,
    forbidden: string[],
    recommended: Map<string, string>
  };
}
```

### 7-2. `src/strategy_recommender.js`

**책임**: (L, intent, jtbd) 3축 좌표를 받아 6개 전략 중 최적을 추천.

```javascript
/**
 * Strategy Recommendation Logic
 */
const STRATEGY_MAPPING = {
  crank_dia: {
    levels: ['L1', 'L2'],
    intents: ['정보탐색', '자격진단'],
    jtbds: ['시간절약', '자기효능감']
  },
  alcon_mic: {
    levels: ['L2', 'L3'],
    intents: ['비교선택'],
    jtbds: ['의사결정지원']
  },
  aeo_brief: {
    levels: ['L1', 'L2'],
    intents: ['정보탐색'],
    jtbds: ['시간절약']
  },
  homefeed: {
    levels: ['L1'],
    intents: ['정보탐색'],
    jtbds: ['자기효능감']
  },
  insight_edge: {
    levels: ['L4'],
    intents: ['문제해결'],
    jtbds: ['리스크회피']
  },
  crank_info: {
    levels: ['L2', 'L3'],
    intents: ['자격진단', '절차해결'],
    jtbds: ['리스크회피', '위임판단']
  }
};

/**
 * @param {Object} input - { level, intent, jtbd }
 * @returns {Object} { recommended: string, scores: Record<string, number>, reasoning: string }
 */
function recommendStrategy(input) {
  // 1. 6개 전략 각각에 대해 매칭 점수 계산
  //    - level 매칭: +3점
  //    - intent 매칭: +2점  
  //    - jtbd 매칭: +2점
  // 2. 최고점 전략 추천
  // 3. 동점 시 우선순위: crank_info > insight_edge > alcon_mic > 나머지
  // 4. reasoning 문자열 생성 (왜 이 전략인지)
  // 5. DB 로깅용 데이터 반환
}
```

### 7-3. `src/renderer.js` 수정 사항

기존 함수에 다음 동작 추가:

```javascript
async function renderPrompt(input) {
  // 1. [신규] domainPack = await loadDomainPack(input.domainCode);
  // 2. [신규] strategy = recommendStrategy({ 
  //      level: input.level, 
  //      intent: input.intent, 
  //      jtbd: input.jtbd 
  //    });
  //    사용자가 명시 선택한 경우 그대로, 아니면 추천값 사용
  // 3. 기존 v1 로직: common.md + strategy.md 로드
  // 4. [신규] positioning_schema.md 추가 로드
  // 5. [신규] domainPack의 4개 파일 내용 주입
  //    - ontology_a → 도메인 섹션
  //    - ontology_b_values → B 골격의 슬롯에 채움
  //    - ontology_d_values → D 스키마의 슬롯에 채움 + 활성 BV 공리 명시
  //    - lexicon → 어휘 가이드 섹션
  // 6. 최종 프롬프트 반환
}
```

### 7-4. `src/validator.js` 수정 사항

```javascript
async function validateAxioms(generatedContent, context) {
  // 1. 기존 v1 알고리즘 공리 10개 검증
  // 2. [신규] 4C 공리 4개 검증
  //    - #11: context.domainPack.ontologyDValues.valuePropositionPattern 사용
  //    - #12: context.domainPack.ontologyDValues.coreAnswerType 사용
  //    - #13, #14: 도메인 무관 검증
  // 3. [신규] Brand Voice 공리 검증
  //    - context.domainPack.ontologyDValues.activeBrandVoiceAxioms 순회
  //    - 각 공리별 검증 함수 호출
  // 4. 결과를 카테고리별로 분리:
  //    {
  //      algorithm: { passed: 8, failed: 2, details: [...] },
  //      fourC: { passed: 4, failed: 0, details: [...] },
  //      brandVoice: { passed: 2, failed: 1, details: [...] }
  //    }
  // 5. 전체 ✗ 1개 이상이면 재생성 신호 반환
}
```

### 7-5. `src/orchestrator.js` 수정 사항

```javascript
async function generateBlogPost(userInput) {
  // 1. domainPack 로드
  // 2. 전략 추천 (또는 사용자 선택값 사용)
  // 3. 프롬프트 렌더링
  // 4. LLM 호출
  // 5. 응답 파싱
  // 6. 공리 검증 (3카테고리)
  // 7. ✗ 1개 이상 → 재생성 (최대 2회)
  // 8. Logger에 도메인·카테고리·전략추천매칭 분리 저장
  // 9. Publisher로 전달
}
```

---

## 8. DB 스키마 마이그레이션

### 8-1. 파일: `db/migrations/002_domain_pack_extension.sql`

```sql
-- =====================================================
-- 002. Domain Pack & STP/4C Extension
-- =====================================================

-- 1. 도메인 마스터 테이블
CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_code VARCHAR(50) UNIQUE NOT NULL,
  domain_name VARCHAR(100) NOT NULL,
  positioning_benefit VARCHAR(20) NOT NULL,
    -- '안전' | '신속' | '심층' | '동반' | '독창'
  package_path VARCHAR(200) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_domains_code ON domains(domain_code);
CREATE INDEX idx_domains_active ON domains(is_active);

-- 2. blog_posts 테이블 확장
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS domain_id UUID 
  REFERENCES domains(id);
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS search_intent VARCHAR(20);
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS jtbd_type VARCHAR(20);
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS positioning_attribute VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_posts_domain ON blog_posts(domain_id);
CREATE INDEX IF NOT EXISTS idx_posts_intent ON blog_posts(search_intent);

-- 3. axiom_results 테이블 확장
ALTER TABLE axiom_results ADD COLUMN IF NOT EXISTS domain_id UUID 
  REFERENCES domains(id);
ALTER TABLE axiom_results ADD COLUMN IF NOT EXISTS axiom_category VARCHAR(20);
  -- 'algorithm' | '4c' | 'brand_voice'

CREATE INDEX IF NOT EXISTS idx_axioms_domain ON axiom_results(domain_id);
CREATE INDEX IF NOT EXISTS idx_axioms_category ON axiom_results(axiom_category);

-- 4. 전략 추천 로그 테이블 (신규)
CREATE TABLE IF NOT EXISTS strategy_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
  domain_id UUID REFERENCES domains(id),
  input_l_level VARCHAR(2) NOT NULL,
  input_intent VARCHAR(20) NOT NULL,
  input_jtbd VARCHAR(20) NOT NULL,
  recommended_strategy VARCHAR(20) NOT NULL,
  user_selected_strategy VARCHAR(20) NOT NULL,
  matched BOOLEAN GENERATED ALWAYS AS 
    (recommended_strategy = user_selected_strategy) STORED,
  recommendation_score JSONB,  -- 6개 전략 각각의 점수
  reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recommendations_post ON strategy_recommendations(post_id);
CREATE INDEX idx_recommendations_matched ON strategy_recommendations(matched);

-- 5. 도메인별 공리 통과율 분석 뷰
CREATE OR REPLACE VIEW v_domain_axiom_stats AS
SELECT
  d.domain_code,
  d.domain_name,
  ar.axiom_category,
  ar.axiom_id,
  COUNT(*) AS total_checks,
  SUM(CASE WHEN ar.passed THEN 1 ELSE 0 END) AS passed_count,
  ROUND(
    SUM(CASE WHEN ar.passed THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 
    2
  ) AS pass_rate_pct
FROM axiom_results ar
JOIN domains d ON ar.domain_id = d.id
GROUP BY d.domain_code, d.domain_name, ar.axiom_category, ar.axiom_id
ORDER BY d.domain_code, ar.axiom_category, pass_rate_pct ASC;

-- 6. 전략 추천 정확도 분석 뷰
CREATE OR REPLACE VIEW v_strategy_recommendation_accuracy AS
SELECT
  d.domain_code,
  sr.recommended_strategy,
  COUNT(*) AS total_recommendations,
  SUM(CASE WHEN sr.matched THEN 1 ELSE 0 END) AS matched_count,
  ROUND(
    SUM(CASE WHEN sr.matched THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 
    2
  ) AS accuracy_pct
FROM strategy_recommendations sr
JOIN domains d ON sr.domain_id = d.id
GROUP BY d.domain_code, sr.recommended_strategy
ORDER BY d.domain_code, accuracy_pct DESC;

-- 7. 첫 도메인 시드 데이터
INSERT INTO domains (domain_code, domain_name, positioning_benefit, package_path)
VALUES (
  'public_procurement',
  '공공조달·정책자금',
  '안전',
  'domain_packs/public_procurement'
)
ON CONFLICT (domain_code) DO NOTHING;
```

---

## 9. 테스트 케이스

### 9-1. 파일: `tests/domain_validation.json`

```json
{
  "test_suites": [
    {
      "name": "Domain Loader 동작 검증",
      "cases": [
        {
          "id": "DL-001",
          "description": "정상 패키지 로드",
          "input": { "domainCode": "public_procurement" },
          "expected": {
            "ontologyA_loaded": true,
            "ontologyBValues_keys": ["L1", "L2", "L3", "L4"],
            "differentiating_benefit": "안전",
            "active_brand_voice_axioms_count": 3
          }
        },
        {
          "id": "DL-002",
          "description": "존재하지 않는 도메인 코드",
          "input": { "domainCode": "nonexistent" },
          "expected": { "throws": "DomainNotFoundError" }
        },
        {
          "id": "DL-003",
          "description": "필수 파일 누락 도메인",
          "input": { "domainCode": "broken_pack" },
          "expected": { "throws": "MissingFileError" }
        }
      ]
    },
    {
      "name": "Strategy Recommender 매칭 검증",
      "cases": [
        {
          "id": "SR-001",
          "description": "L2 + 자격진단 + 리스크회피 → crank_info 추천",
          "input": { "level": "L2", "intent": "자격진단", "jtbd": "리스크회피" },
          "expected": { "recommended": "crank_info" }
        },
        {
          "id": "SR-002",
          "description": "L4 + 문제해결 + 리스크회피 → insight_edge 추천",
          "input": { "level": "L4", "intent": "문제해결", "jtbd": "리스크회피" },
          "expected": { "recommended": "insight_edge" }
        },
        {
          "id": "SR-003",
          "description": "L1 + 정보탐색 + 시간절약 → aeo_brief 또는 crank_dia",
          "input": { "level": "L1", "intent": "정보탐색", "jtbd": "시간절약" },
          "expected": { "recommended_in": ["aeo_brief", "crank_dia"] }
        }
      ]
    },
    {
      "name": "4C 공리 검증",
      "cases": [
        {
          "id": "AX-011",
          "description": "공리 #11 - 가치명제 누락 시 ✗",
          "input_content": "안녕하세요. 오늘은 정책자금에 대해 알아보겠습니다...",
          "context": {
            "valuePropositionPattern": "이 글을 읽으면 {자격조건}을 알 수 있습니다"
          },
          "expected": { "passed": false, "axiom_id": 11 }
        },
        {
          "id": "AX-012",
          "description": "공리 #12 - 핵심답이 첫 화면 안에 있을 때 ✓",
          "input_content": "## 자가진단 체크리스트\n- [ ] 항목1\n- [ ] 항목2\n...",
          "context": { "coreAnswerType": "자가진단 체크리스트" },
          "expected": { "passed": true, "axiom_id": 12 }
        }
      ]
    },
    {
      "name": "Brand Voice 공리 활성화 검증",
      "cases": [
        {
          "id": "BV-안전-001",
          "description": "differentiating_benefit='안전' 시 BV1~BV3 활성화",
          "input": { "differentiating_benefit": "안전" },
          "expected": {
            "active_axioms": [
              "BV1: 리스크·실패사례 명시",
              "BV2: 제외요건·예외조항 명시",
              "BV3: 조건부 표현 우선"
            ]
          }
        }
      ]
    },
    {
      "name": "End-to-End 통합 검증",
      "cases": [
        {
          "id": "E2E-001",
          "description": "공공조달 도메인 + L2 + 자격진단 + 리스크회피 전체 플로우",
          "input": {
            "domainCode": "public_procurement",
            "topic": "중진공 청년창업자금",
            "mainKeyword": "청년창업자금 신청자격",
            "level": "L2",
            "intent": "자격진단",
            "jtbd": "리스크회피"
          },
          "expected": {
            "strategy_used": "crank_info",
            "all_algorithm_axioms_passed": true,
            "all_4c_axioms_passed": true,
            "all_brand_voice_axioms_passed": true,
            "logged_with_domain_id": true
          }
        }
      ]
    }
  ]
}
```

---

## 10. Phase별 배포 체크리스트

### Phase 1: 도메인 패키지 인프라 구축 (최우선)

**산출물**
- [ ] `prompts/ontology/positioning_schema.md` 작성
- [ ] `domain_packs/_template/` 4개 파일 작성
- [ ] `src/domain_loader.js` 구현
- [ ] `db/migrations/002_domain_pack_extension.sql` 작성 및 실행
- [ ] DL-001, DL-002, DL-003 테스트 통과

**검증**
- [ ] 빈 템플릿 패키지 로드 시 적절한 에러 반환
- [ ] 도메인 마스터 테이블 시드 데이터 확인

**사용자 확인 요청**
- 디렉토리 구조 승인
- positioning_schema.md의 5가지 differentiating_benefit 풀 적절성 확인

---

### Phase 2: 첫 도메인 패키지 작성 (public_procurement)

**산출물**
- [ ] `domain_packs/public_procurement/ontology_a.md` 작성
  (v1의 정부지원사업 도메인 정의 이전·정리)
- [ ] `domain_packs/public_procurement/ontology_b_values.md` 작성
- [ ] `domain_packs/public_procurement/ontology_d_values.md` 작성
- [ ] `domain_packs/public_procurement/domain_lexicon.md` 작성

**사용자 확인 요청 (필수)**
- differentiating_benefit 선택: `안전` (기본 추천) vs 다른 선택
- target_audience 정의 문구 확인
- reason_to_believe 항목 확인 (자격증·경력·실적)
- core_answer_type 확인: 자가진단 체크리스트가 적절한지

**검증**
- [ ] 패키지 로드 후 모든 슬롯이 채워진 상태 확인
- [ ] active_brand_voice_axioms가 3개 활성화 확인

---

### Phase 3: Ontology B v2 + 4C 공리 통합

**산출물**
- [ ] `prompts/ontology/common.md` 수정 (B v2 + 4C 공리 추가)
- [ ] `src/validator.js` 수정 (3카테고리 분리 검증)
- [ ] `src/renderer.js` 수정 (도메인 패키지 주입)
- [ ] AX-011, AX-012 테스트 통과
- [ ] BV-안전-001 테스트 통과

**검증**
- [ ] 기존 알고리즘 공리 10개가 v1과 동일하게 동작
- [ ] 신규 4C 공리 4개가 변수 슬롯으로 도메인값 받음
- [ ] Brand Voice 공리가 D-3 매핑대로 활성화

**사용자 확인 요청**
- 첫 글 생성 결과 톤 일관성 확인
- 공리 통과율이 80% 이상인지 확인

---

### Phase 4: Strategy Recommender 모듈 신설

**산출물**
- [ ] `src/strategy_recommender.js` 구현
- [ ] STRATEGY_MAPPING 테이블 정의
- [ ] `src/orchestrator.js` 수정 (추천 호출 통합)
- [ ] strategy_recommendations 테이블 활용 로깅
- [ ] SR-001, SR-002, SR-003 테스트 통과

**검증**
- [ ] 사용자 미선택 시 추천값 자동 사용
- [ ] 사용자 다른 선택 시 매칭 여부 로깅
- [ ] v_strategy_recommendation_accuracy 뷰로 정확도 확인 가능

---

### Phase 5: End-to-End 통합 검증

**산출물**
- [ ] E2E-001 테스트 통과
- [ ] 기존 v1 글 생성 회귀 테스트 (도메인 없는 케이스도 동작)
- [ ] 도메인별 공리 통과율 대시보드 (v_domain_axiom_stats 활용)

**사용자 확인 요청**
- 실제 키워드 5개로 글 생성 → 톤·구조 일관성 확인
- 추천 전략과 실제 선호 전략 일치도 확인
- 다음 도메인 패키지 작성 의향 확인

---

### Phase 6 (선택): 두 번째 도메인 패키지

**진입 조건**: Phase 1~5 안정화 후 (최소 1주 운영)

**산출물**
- [ ] 사용자가 지정한 두 번째 전문가 도메인 패키지 작성
- [ ] 시스템 코드 변경 없이 패키지 추가만으로 동작 확인
- [ ] 두 도메인 간 공리 통과율 비교 분석

---

## 11. 작업 시 준수 사항

### 11-1. v1 호환성

- v1의 6개 전략 프롬프트 자체는 수정 금지 (구조 유지)
- v1의 알고리즘 공리 10개는 그대로 유지 (번호 변경 금지)
- 기존 테이블 컬럼 변경 금지 (ALTER ADD만 허용)
- 도메인 미지정 입력도 동작해야 함 (default 도메인 또는 명시적 에러)

### 11-2. 사용자 확인 지점

다음 단계에서는 **반드시 사용자(설희) 확인**을 받은 후 진행:

1. Phase 1 완료 시 — 디렉토리 구조 및 스키마 승인
2. Phase 2의 ontology_d_values.md 작성 시 — 5가지 포지셔닝 값 확정
3. Phase 3 완료 시 — 첫 글 생성 결과 톤 검수
4. Phase 5 완료 시 — End-to-End 결과 검수 및 다음 도메인 결정

### 11-3. 코드 스타일

- v1 코드의 명명 규칙 따르기 (camelCase 함수명)
- 마크다운 파일은 v1 스타일 유지 (한국어 주제어 + 영어 식별자)
- DB 컬럼은 snake_case
- 모든 공리에 ID 부여 (algorithm: A1~A10, fourC: C11~C14, brandVoice: BV1~BVn)

### 11-4. 로깅 원칙

- 모든 글 생성에 `domain_id` 필수 (NULL 금지)
- 공리 검증 결과는 `axiom_category` 분리 저장
- 전략 추천 시 점수 6개 모두 JSONB로 저장 (학습용)

---

## 12. 기대 효과 요약

| 영역 | v1 (현재) | v2 (이 작업 후) |
|---|---|---|
| 전략 일관성 | 사용자 직관 의존 | 시스템 강제 |
| 포지셔닝 | 암묵적 | Ontology D로 명시 |
| 독자 모델링 | 1축 (4단계) | 3축 (4×5×5 = 100조합) |
| 도메인 추가 비용 | 시스템 재작성 | 패키지 1개 (4~5시간) |
| 공리 검증 | 10개 단일 카테고리 | 14+N개, 3카테고리 |
| 데이터 분석 | 글 단위 | 도메인×공리×전략 매트릭스 |
| 플랫폼화 | 불가 | 가능 |

---

## 13. 참고: STP·4C 이론 매핑

이 명세서의 각 요소가 마케팅 이론의 어디에 대응하는지:

| 시스템 요소 | STP·4C 대응 |
|---|---|
| Ontology B v2 (3축) | **Segmentation** (인구통계 대신 인지·의도·편익 기반 세분화) |
| Strategy Recommender | **Targeting** (세그먼트별 자원 배분 자동화) |
| Ontology D (Positioning) | **Positioning** (단어 선점, 우산 일관성) |
| 공리 #11 Customer Value | **4C - Customer Value** |
| 공리 #12 Cost | **4C - Cost** (시간·인지 비용) |
| 공리 #13 Convenience | **4C - Convenience** |
| 공리 #14 Communication | **4C - Communication** (양방향) |
| Brand Voice 공리 | Positioning의 운영 시스템화 |

이 매핑은 시스템이 *왜 이렇게 설계됐는가*의 이론적 근거를 제공한다. 추후 시스템 확장 시 마케팅 이론의 다른 요소(브랜드 자산, 고객 여정 등)도 같은 패턴으로 통합 가능.

---

**문서 끝.**