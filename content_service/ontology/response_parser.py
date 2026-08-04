"""LLM 응답에서 output_schema 6개 섹션(§1~§6)을 안전하게 추출."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ParsedResponse:
    """output_schema.json 미러 + 시스템 메타."""
    mapping: dict[str, Any]
    titles: list[dict[str, Any]]
    body: str
    axiom_check: dict[str, Any]
    suggestions: dict[str, Any]
    meta: dict[str, Any]
    raw: str
    parse_ok: bool
    parse_errors: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "mapping": self.mapping,
            "titles": self.titles,
            "body": self.body,
            "axiom_check": self.axiom_check,
            "suggestions": self.suggestions,
            "meta": self.meta,
            "parse_ok": self.parse_ok,
            "parse_errors": self.parse_errors,
        }


def _extract_json_block(text: str) -> str | None:
    """LLM이 코드펜스·부가 텍스트를 섞어도 최외곽 JSON 오브젝트만 뽑아냄."""
    # 1) 일단 그대로 JSON 시도
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return stripped

    # 2) ```json ... ``` 펜스 제거
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        return fence.group(1)

    # 3) 첫 { 부터 마지막 } 까지 greedy 매칭
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    return m.group(0) if m else None


def parse(raw: str) -> ParsedResponse:
    errors: list[str] = []
    block = _extract_json_block(raw)
    if not block:
        logger.warning("응답에서 JSON 블록을 찾지 못함")
        return _empty(raw, ["JSON 블록을 찾지 못함"])

    try:
        data = json.loads(block)
    except json.JSONDecodeError as e:
        logger.warning("JSON 파싱 실패: %s", e)
        return _empty(raw, [f"JSON 파싱 실패: {e}"])

    if not isinstance(data, dict):
        return _empty(raw, ["응답 최상위가 object가 아님"])

    # 스키마 누락 필드 경고는 모으지만 부분 성공은 허용
    def _get(key: str, default: Any, expected_type: type) -> Any:
        if key not in data:
            errors.append(f"누락 필드: {key}")
            return default
        if not isinstance(data[key], expected_type):
            errors.append(f"타입 불일치: {key} (expected {expected_type.__name__})")
            return default
        return data[key]

    parsed = ParsedResponse(
        mapping=_get("mapping", {}, dict),
        titles=_get("titles", [], list),
        body=_get("body", "", str),
        axiom_check=_get("axiom_check", {}, dict),
        suggestions=_get("suggestions", {}, dict),
        meta=_get("meta", {}, dict),
        raw=raw,
        parse_ok=not errors,
        parse_errors=errors,
    )
    return parsed


def _empty(raw: str, errors: list[str]) -> ParsedResponse:
    return ParsedResponse(
        mapping={}, titles=[], body="", axiom_check={}, suggestions={}, meta={},
        raw=raw, parse_ok=False, parse_errors=errors,
    )
