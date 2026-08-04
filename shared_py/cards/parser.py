"""Rule-based parser: Naver blog markup -> card JSON structure.

Optional AI-based rewriting keeps content cards natural (no mid-sentence ellipsis).
"""
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_H2_SPLIT = re.compile(r"\[h2\](.*?)\[/h2\]", re.DOTALL)
_IMG_PLACEHOLDER = re.compile(r"\[img_placeholder[^\]]*\]")
_QUOTE_BLOCK = re.compile(r"\[quote\].*?\[/quote\]", re.DOTALL)
_ITALIC_BLOCK = re.compile(r"\[italic\](.*?)\[/italic\]", re.DOTALL)
_MARKUP_TAG = re.compile(
    r"\[/?(?:bold|italic|quote|hr|right|center|left|color[^\]]*|bg[^\]]*|size[^\]]*|font[^\]]*)\]"
)
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE)
_SENTENCE_SPLIT = re.compile(r"(?<=[\.\!\?])\s+")


def _strip_markup(text: str) -> str:
    text = _IMG_PLACEHOLDER.sub("", text)
    text = _MARKUP_TAG.sub("", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _clean_section_body(text: str) -> str:
    text = _IMG_PLACEHOLDER.sub("", text)
    text = _QUOTE_BLOCK.sub("", text)
    text = _ITALIC_BLOCK.sub("", text)
    text = _TABLE_ROW.sub("", text)
    text = re.sub(r"\[hr\]", "", text)
    return _strip_markup(text)


def _split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_SPLIT.split(text)
    return [p.strip() for p in parts if p.strip()]


def _truncate(text: str, max_chars: int) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip(" ,.·") + "…"


def _clean_heading(heading: str) -> str:
    """Strip markup; let CSS (word-break: keep-all) handle line wrapping."""
    return _strip_markup(heading)


def parse_sections(body: str) -> list[dict[str, Any]]:
    """Extract [h2] sections with cleaned heading + sentence list."""
    parts = _H2_SPLIT.split(body)
    sections: list[dict[str, Any]] = []
    for i in range(1, len(parts), 2):
        heading = _strip_markup(parts[i])
        content = parts[i + 1] if i + 1 < len(parts) else ""
        cleaned = _clean_section_body(content)
        sentences = _split_sentences(cleaned)
        sections.append({"heading": heading, "sentences": sentences})
    return sections


def _rewrite_content_cards_with_ai(
    cards: list[dict[str, Any]],
    sections: list[dict[str, Any]],
    title: str,
    ai_generator,
) -> None:
    """Ask AI to rewrite lead/body_text of content cards in-place.

    Batched single-call approach: all content cards in one prompt → JSON response.
    On any failure, cards are left as-is (rule-based truncation remains).
    """
    content_items: list[tuple[int, dict, dict]] = []
    for card_idx, card in enumerate(cards):
        if card.get("type") != "content":
            continue
        sec_idx = len(content_items)
        if sec_idx >= len(sections):
            break
        content_items.append((card_idx, card, sections[sec_idx]))

    if not content_items:
        return

    payload = []
    for local_i, (_, card, section) in enumerate(content_items, start=1):
        full_text = " ".join(section["sentences"])[:600]
        payload.append({
            "index": local_i,
            "heading": card["heading"],
            "source": full_text,
        })

    total = len(payload)
    expected_indexes = ", ".join(str(i) for i in range(1, total + 1))
    example_items = ",\n    ".join(
        f'{{"index": {i}, "lead": "...", "body_text": "..."}}' for i in range(1, total + 1)
    )

    prompt = f"""
블로그 제목: {title}

⚠️ 반드시 아래 섹션 **{total}개 전부**에 대해 카드뉴스 문구를 생성하세요.
⚠️ 응답 cards 배열의 길이는 정확히 {total}개여야 하고, index는 {expected_indexes} 순서로 빠짐없이 포함되어야 합니다.
⚠️ 한 개라도 누락되면 실패로 간주합니다.

각 섹션(heading + source)을 기반으로 카드뉴스용 짧은 문구 2개를 만들어주세요.
- `lead`: 섹션의 핵심 1문장 (35~50자, 완전한 문장, 줄임표 금지)
- `body_text`: lead를 뒷받침하는 설명 1~2문장 (80~120자, 완전한 문장, 줄임표 금지)
- 원문에 없는 사실·수치 창작 금지. 원문을 요약·다듬는 수준.
- 문장을 중간에 자르거나 "…" 같은 기호를 쓰지 마세요.
- 존댓말 톤 유지.

섹션 데이터 ({total}개, JSON):
{json.dumps(payload, ensure_ascii=False, indent=2)}

아래 JSON 포맷으로만 응답하세요. 다른 설명·마크다운·코드펜스 금지:
{{
  "cards": [
    {example_items}
  ]
}}
""".strip()

    def _call_and_parse() -> dict[int, dict] | None:
        try:
            raw = ai_generator.generate_content(prompt, temperature=0.5)
        except Exception as e:
            logger.warning(f"카드뉴스 AI 요약 호출 실패: {e}")
            return None
        if not raw:
            logger.warning("카드뉴스 AI 요약 응답 비어있음")
            return None
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            logger.warning("카드뉴스 AI 응답에서 JSON 블록을 찾지 못함")
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError as e:
            logger.warning(f"카드뉴스 AI JSON 파싱 실패: {e}")
            return None
        return {item.get("index"): item for item in data.get("cards", []) if isinstance(item, dict)}

    rewrites = _call_and_parse()

    # 누락된 index가 있으면 1회 재시도 (AI가 일부만 응답하는 케이스 대응)
    if rewrites is not None:
        missing = [i for i in range(1, len(content_items) + 1) if i not in rewrites]
        if missing:
            logger.info(f"카드뉴스 AI 응답 누락 {len(missing)}개 (index={missing}) — 1회 재시도")
            retry = _call_and_parse()
            if retry:
                for idx, item in retry.items():
                    rewrites.setdefault(idx, item)

    if not rewrites:
        logger.warning("카드뉴스 AI 요약 실패 — 규칙 기반 폴백")
        return

    for local_i, (_, card, _section) in enumerate(content_items, start=1):
        rewrite = rewrites.get(local_i)
        if not rewrite:
            continue
        new_lead = (rewrite.get("lead") or "").strip()
        new_body = (rewrite.get("body_text") or "").strip()
        if new_lead:
            card["lead"] = new_lead
        if new_body:
            card["body_text"] = new_body


def build_cards(
    title: str,
    body: str,
    keywords: list[str] | None = None,
    max_content_cards: int = 5,
    card_count: str | int = "auto",
    ai_generator=None,
) -> list[dict[str, Any]]:
    """Convert blog (title + body + keywords) into card definitions.

    If ai_generator is provided, content cards' lead/body_text are rewritten
    by the AI for natural phrasing (no mid-sentence ellipsis). On AI failure,
    rule-based truncation (lead≤50 / body_text≤110 chars) is used.
    """
    sections = parse_sections(body)

    if isinstance(card_count, int) and card_count > 0:
        max_content = max(1, card_count - 3)
    else:
        max_content = min(len(sections), max_content_cards) if sections else 0

    cards: list[dict[str, Any]] = []

    cover: dict[str, Any] = {
        "type": "cover",
        "eyebrow": "BLOG",
        "main_title": _clean_heading(title),
    }
    if sections:
        cover["sub_title"] = _truncate(sections[0]["heading"], 30)
    cards.append(cover)

    used_sections = sections[:max_content]
    for i, section in enumerate(used_sections, start=1):
        heading = section["heading"]
        sentences = section["sentences"]
        lead = sentences[0] if sentences else ""
        body_text = sentences[1] if len(sentences) > 1 else ""
        cards.append({
            "type": "content",
            "section_label": f"POINT {i:02d}",
            "heading": _clean_heading(heading),
            "lead": _truncate(lead, 50),
            "body_text": _truncate(body_text, 110),
        })

    if keywords:
        cards.append({
            "type": "list",
            "section_label": "SUMMARY",
            "heading": _clean_heading("핵심 키워드 정리"),
            "items": [_truncate(k, 24) for k in keywords[:5]],
        })

    cards.append({
        "type": "closing",
        "message": _clean_heading("자세한 내용은 블로그에서 확인하세요"),
        "cta": "블로그 링크를 확인해주세요",
    })

    if ai_generator is not None and used_sections:
        _rewrite_content_cards_with_ai(cards, used_sections, title, ai_generator)

    return cards
