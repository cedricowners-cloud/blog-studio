"""Ontology v2 프롬프트 빌더.

prompts/00_common_ontology.md + prompts/0N_method.md 를 로드하고
사용자 입력(input_schema) + 출력 포맷 지시를 이어붙여 LLM에 넣을 최종 프롬프트를 만든다.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

PROMPT_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"

_METHOD_FILENAMES = {
    1: "01_crank_diaplus_v2.md",
    2: "02_alcon_v2.md",
    3: "03_aeo_v2.md",
    4: "04_homefeed_v2.md",
    5: "05_insight_edge_v2.md",
    6: "06_info_govt_v2.md",
}

_METHOD_LABELS = {
    1: "C랭크 다이아플러스",
    2: "알콘",
    3: "AEO",
    4: "홈피드",
    5: "인사이트 엣지",
    6: "C랭크 정보성 (정부지원)",
}


class GenerationOptions(BaseModel):
    max_retries: int = 2
    axiom_pass_threshold: float = 1.0
    min_body_char_count: int = 1500


class BrandVoice(BaseModel):
    author_identity: str | None = None
    consultancy_name: str | None = None


class BlogGenerationInput(BaseModel):
    """input_schema.json 의 Python 미러."""
    method_id: int = Field(ge=1, le=6)
    topic: str = Field(min_length=3, max_length=200)
    main_keyword: str = Field(min_length=2, max_length=50)
    sub_keywords: list[str] = Field(min_length=1, max_length=10)
    target_awareness_level: str = Field(default="L2", pattern=r"^L[1-4]$")
    domain_info: dict[str, Any] | None = None
    persona: str = "30대 경영자/대표"
    brand_voice: BrandVoice | None = None
    generation_options: GenerationOptions = Field(default_factory=GenerationOptions)


@lru_cache(maxsize=16)
def _load_prompt_file(filename: str) -> str:
    path = PROMPT_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"프롬프트 파일 없음: {path}")
    return path.read_text(encoding="utf-8")


def _load_method_prompt(method_id: int) -> str:
    """00_common_ontology.md + 방식별 프롬프트를 순서대로 반환."""
    common = _load_prompt_file("00_common_ontology.md")
    method_file = _METHOD_FILENAMES.get(method_id)
    if not method_file:
        raise ValueError(f"알 수 없는 method_id: {method_id}")
    method = _load_prompt_file(method_file)
    return common + "\n\n" + method


def _build_input_section(inp: BlogGenerationInput) -> str:
    """사용자 입력을 LLM이 읽기 좋게 Markdown 블록으로 정리."""
    lines = [
        "═══════════════════════════════════════════════",
        "[입력 정보] — 이 정보를 기반으로 글을 작성하세요",
        "═══════════════════════════════════════════════",
        "",
        f"- **글 주제(topic)**: {inp.topic}",
        f"- **메인 키워드(main_keyword)**: {inp.main_keyword}",
        f"- **서브 키워드(sub_keywords)**: {', '.join(inp.sub_keywords)}",
        f"- **타겟 인지단계(target_awareness_level)**: {inp.target_awareness_level}",
        f"- **페르소나(persona)**: {inp.persona}",
        f"- **방식(method_id)**: {inp.method_id} — {_METHOD_LABELS.get(inp.method_id, '')}",
    ]

    if inp.brand_voice and (inp.brand_voice.author_identity or inp.brand_voice.consultancy_name):
        lines.append("- **브랜드 보이스**:")
        if inp.brand_voice.author_identity:
            lines.append(f"    - 작성자 정체성: {inp.brand_voice.author_identity}")
        if inp.brand_voice.consultancy_name:
            lines.append(f"    - 소속: {inp.brand_voice.consultancy_name}")

    if inp.domain_info:
        lines.append("")
        lines.append("**도메인 정보(domain_info)** — 글에 반영할 사실 데이터:")
        lines.append("```json")
        lines.append(json.dumps(inp.domain_info, ensure_ascii=False, indent=2))
        lines.append("```")

    opts = inp.generation_options
    lines.extend([
        "",
        "**생성 제약**:",
        f"- 본문 최소 글자수: {opts.min_body_char_count}자",
        f"- 공리 통과율 임계값: {opts.axiom_pass_threshold * 100:.0f}%",
    ])
    return "\n".join(lines)


_OUTPUT_FORMAT_INSTRUCTION = """═══════════════════════════════════════════════
[출력 포맷] — 반드시 아래 6개 섹션을 순서대로 포함하세요
═══════════════════════════════════════════════

응답은 **JSON 객체 하나**로만 출력합니다. 다른 설명·코드펜스 금지.
정확히 아래 스키마를 따르세요:

```json
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
```

**엄수 사항**:
- `body`는 실제 블로그에 그대로 붙여 쓸 수 있는 완성본. 2,000~3,000자 권장.
- `axiom_check.items`는 방식별 공리 전체(공통 10개 + 방식 특화)를 **하나도 빠짐없이** 포함.
- JSON 외 다른 텍스트 일체 금지 (설명·마크다운 펜스 포함)."""


def build_full_prompt(inp: BlogGenerationInput) -> str:
    """LLM에 넣을 최종 프롬프트 조립."""
    return "\n\n".join([
        _load_method_prompt(inp.method_id),
        _build_input_section(inp),
        _OUTPUT_FORMAT_INSTRUCTION,
    ])
