# Ontology D Values — 공공조달·정책자금 블로그 포지셔닝

> 이 블로그의 **우산 포지셔닝**.
> ★ Phase 2 사용자(설희) 검수 필수: target_audience / competitive_reference / reason_to_believe / core_answer_type.
> 5요소 풀 정의는 `web/prompts/ontology/positioning_schema.md` D-1, D-2 참조.

---

## Positioning Statement

```
target_audience: 정책자금·공공조달이 막막한 SME 대표 (10~50인, 업력 1~10년)
competitive_reference: 정부 공고 원문 (난해) / 일반 블로그 (얕음) / 행정사 PR성 블로그 (정보 부족)
differentiating_benefit: 안전
category: 공공조달행정사 정보 컨설팅
reason_to_believe:
  - 공공조달·정책자금 컨설팅 5년+ 현장 경험
  - 오너스경영연구소 운영, 누적 클라이언트 N명
  - 반려 케이스 누적 분석 → 재도전 성공률 향상
```

> ⚠️ `reason_to_believe` 의 구체 수치(N명, 성공률 등)는 사용자가 실제 데이터로 교체 필요.

---

## Brand Voice 공리 활성화

`differentiating_benefit = 안전` 이므로 `positioning_schema.md` D-3 매핑에 의해 다음 공리 자동 활성화:

```
active_brand_voice_axioms:
  - BV1: 모든 글에 리스크·실패사례 최소 1건 명시
  - BV2: 제외요건·예외조항 명시 강제
  - BV3: 단정적 표현 자제, 조건부 표현 우선 ("~할 가능성", "~인 경우")
```

> 도메인 로더(`domain-loader.ts`)가 자동 결정. 명시 override 불필요.

---

## 4C 공리 변수 슬롯 값

### Customer Value 가치명제 패턴 (공리 #11)

```
value_proposition_pattern: "이 글을 읽으면 {신청 자격 충족 여부와 반려 위험}을 알 수 있습니다"
```

> 글 첫 100자 안에 위 형식의 명시 문장이 등장해야 공리 #11 통과.
> 변수 `{...}` 부분은 글마다 다를 수 있음. 핵심은 "독자가 읽고 얻는 구체값".

### Cost 핵심답 유형 (공리 #12)

```
core_answer_type: 자가진단 체크리스트
```

> 글 첫 화면(상단 박스) 안에 자가진단 체크리스트가 위치해야 공리 #12 통과.
> 사업별로 다른 형식(판단 기준 표·증상 매칭표 등) 가능하나 도메인의 *기본형*은 자가진단 체크리스트.

---

## 작성 가이드 / 검수 포인트

**사용자 검수 필요 (5가지)**:
1. `target_audience` 의 구체 페르소나 정확성 — 실제 클라이언트와 부합?
2. `competitive_reference` 의 경쟁 정보 출처 — 추가/제거 의견?
3. `reason_to_believe` 의 구체 수치 (N명, 승인률 등) — 실제 데이터로 교체 필요
4. `value_proposition_pattern` 의 슬롯값 — "신청 자격 충족 여부와 반려 위험" 적절?
5. `core_answer_type` — 자가진단 체크리스트가 도메인 기본형으로 적절?

**향후 추가 도메인 작성 시 참고**: 절세·법인설립 등 새 도메인 패키지 작성 시 이 파일 구조 그대로 복사하고 값만 교체.
