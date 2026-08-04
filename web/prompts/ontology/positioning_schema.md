# Ontology D — Brand Positioning Schema

> 블로그 전체에 적용되는 **우산 포지셔닝**의 메타 스키마.
> 이 파일은 **빈 양식(틀)** 이며, 도메인 패키지의 `ontology_d_values.md` 가 *값* 을 채워 넣음.
> 모든 글은 어떤 알고리즘 전략(방식 1~6)이든 이 우산 아래 일관된 톤·관점을 유지함.

---

## D-1. Positioning Statement Template

```
target_audience: <블로그가 표적하는 독자 정의 — 도메인 패키지에서 주입>
competitive_reference: <이 블로그가 경쟁하는 정보 출처 — 도메인 패키지에서 주입>
differentiating_benefit: <차별적 편익 — 단어 1개 — 아래 D-2 풀에서 선택>
category: <카테고리 자기 정의 또는 재정의>
reason_to_believe: <RTB — 자격·경험·실적·데이터>
```

---

## D-2. Differentiating Benefit Pool (도메인 무관 공통 풀)

| 그룹 | 후보 단어 | 적합 도메인 예시 |
|---|---|---|
| **신뢰형** | 안전 / 정확 / 검증 | 법률·의료·세무·정책자금 |
| **효율형** | 신속 / 간결 / 핵심 | IT·자동화·생산성 |
| **깊이형** | 심층 / 통찰 / 분석 | 컨설팅·연구·전략 |
| **관계형** | 동반 / 공감 / 안심 | 의료·심리·교육 |
| **차별형** | 독창 / 반대 / 재정의 | AI·트렌드·신산업 |

**제약**: **단어 1개만 선택**. (Volvo "안전" 원칙 — 2개 선택 시 둘 다 약화됨)

---

## D-3. Brand Voice 공리 자동 활성화 매핑

선택된 `differentiating_benefit` 에 따라 자동 활성화되는 공리 세트.
글 생성 시 Validator 가 이 공리들을 추가로 검증함.

### "안전" 선택 시
- **BV1**. 모든 글에 *리스크·실패사례* 최소 1건 명시
- **BV2**. *제외요건·예외조항* 명시 강제
- **BV3**. 단정적 표현 자제, *조건부 표현* 우선 ("~할 가능성", "~인 경우")

### "신속" 선택 시
- **BV1**. *핵심 답*이 글 첫 화면(상단 박스) 안에 위치
- **BV2**. 글 길이 1,500~2,000자 상한 (초과 금지)
- **BV3**. 모든 섹션에 *3초 요약* 박스 포함

### "심층" 선택 시
- **BV1**. *일반론 반박 구조* 강제 ("흔히 ~라고 하지만...")
- **BV2**. *데이터·사례 인용* 최소 3건
- **BV3**. 차별화 포인트를 글 도입부에 명시

### "동반" 선택 시
- **BV1**. 1인칭 ("저희가", "함께") 최소 3회
- **BV2**. *공감 표현* ("막막하시죠?", "걱정 마세요") 최소 1회
- **BV3**. 마무리에 *지속 관계 신호* (다음 글·상담 등)

### "독창" 선택 시
- **BV1**. 글 도입부에 *기존 통념* 명시
- **BV2**. *반박·재정의* 구조 강제
- **BV3**. *새로운 프레임* 제시 + 실천 방법 연결

> 위 매핑되지 않은 단어(예: "정확", "신속" 외 변형) 선택 시 — 가장 가까운 그룹의 공리를 활성화.

---

## D-4. Validator 입력 형식 (런타임)

도메인 패키지 로더(`domain-loader.ts`)가 `ontology_d_values.md` 를 파싱하여 다음 JSON 으로 변환, Validator에 전달:

```json
{
  "target_audience": "string",
  "competitive_reference": "string",
  "differentiating_benefit": "안전|신속|심층|동반|독창",
  "category": "string",
  "reason_to_believe": ["string", "string"],
  "active_brand_voice_axioms": ["BV1", "BV2", "BV3"],
  "value_proposition_pattern": "이 글을 읽으면 {도메인 핵심값}을 알 수 있습니다",
  "core_answer_type": "자가진단 체크리스트|판단 기준 표|증상 매칭표|..."
}
```

`value_proposition_pattern` 은 4C 공리 #11(Customer Value), `core_answer_type` 은 #12(Cost) 의 변수 슬롯.
