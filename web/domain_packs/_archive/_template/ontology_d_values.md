# Ontology D Values — &lt;블로그명&gt; 포지셔닝

> 이 블로그의 **우산 포지셔닝**을 정의한다.
> `prompts/ontology/positioning_schema.md` 의 D-1, D-2 풀에서 *값*을 골라 채움.

---

## Positioning Statement

```
target_audience: <표적 독자 — 구체적으로>
competitive_reference: <경쟁 정보 출처>
differentiating_benefit: <안전 | 신속 | 심층 | 동반 | 독창 중 1개>
category: <블로그 카테고리 자기 정의>
reason_to_believe:
  - <RTB1 — 자격증·경력·실적·데이터>
  - <RTB2>
  - <RTB3>
```

---

## Brand Voice 공리 활성화

`differentiating_benefit` 선택값에 따라 `positioning_schema.md` D-3 매핑에서 자동 결정.
명시적으로 override 하려면 아래에 적음 (보통은 비워둠):

```
active_brand_voice_axioms: <자동 — 비워둠>
```

---

## 4C 공리 변수 슬롯 값

### Customer Value 가치명제 패턴 (공리 #11)

```
value_proposition_pattern: "이 글을 읽으면 {<도메인 핵심값>}을 알 수 있습니다"
```

> 예시:
> - "이 글을 읽으면 {신청 자격 충족 여부}를 알 수 있습니다"
> - "이 글을 읽으면 {절세 효과}를 알 수 있습니다"

### Cost 핵심답 유형 (공리 #12)

```
core_answer_type: <자가진단 체크리스트 | 판단 기준 표 | 증상 매칭표 | 절차 단계 표 | ...>
```

> 글 첫 화면에 위치해야 하는 **핵심 답의 형식**. 글마다 다를 수 있으나 도메인의 *기본형*을 정의.

---

## 작성 가이드

- `target_audience` 는 추상적 묘사 대신 구체적 페르소나 ("30대 1인 사업자, 운영자금 부족, 정책 정보 어려움")
- `competitive_reference` 는 실제 경쟁 정보 출처 (정부 공고 원문 / 다른 행정사 블로그 / 유튜브 채널 등)
- `differentiating_benefit` 는 **단어 1개**. 두 개 선택 시 두 단어 모두 약화됨 (Volvo "안전" 원칙)
- `reason_to_believe` 는 막연한 "10년 경력" 보다 측정 가능한 실적 ("250건 컨설팅", "승인율 87%")
