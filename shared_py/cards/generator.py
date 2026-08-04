"""Main entrypoint: blog content -> card news PNGs."""
import re
from datetime import datetime
from pathlib import Path

from .config import CardNewsConfig
from .parser import build_cards
from .renderer import render_cards_to_png

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "data" / "card_news"

_SLUG_RE = re.compile(r"[^\w가-힣]+")


def _slugify(text: str, max_chars: int = 40) -> str:
    slug = _SLUG_RE.sub("_", text).strip("_")
    return slug[:max_chars] if slug else "untitled"


def _parse_card_count(raw: str | int) -> str | int:
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().isdigit():
        return int(raw.strip())
    return "auto"


def build_card_data(
    title: str,
    body: str,
    keywords: list[str] | None,
    config: CardNewsConfig,
    ai_generator=None,
) -> list[dict]:
    """Build card list (text-only, no rendering). Optional AI rewrite for natural phrasing."""
    return build_cards(
        title=title,
        body=body,
        keywords=keywords or [],
        card_count=_parse_card_count(config.card_count),
        ai_generator=ai_generator,
    )


def render_card_news(
    cards: list[dict],
    title: str,
    config: CardNewsConfig,
    output_root: Path = DEFAULT_OUTPUT_ROOT,
) -> dict:
    """Render pre-built cards to PNG files.

    Returns: {"output_dir": Path, "cards": list[dict], "images": list[Path]}
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = _slugify(title)
    output_dir = output_root / f"{timestamp}_{slug}"

    images = render_cards_to_png(cards, config, output_dir)
    return {"output_dir": output_dir, "cards": cards, "images": images}


def generate_card_news(
    title: str,
    body: str,
    keywords: list[str] | None,
    config: CardNewsConfig,
    output_root: Path = DEFAULT_OUTPUT_ROOT,
    ai_generator=None,
) -> dict:
    """Build and render card news in one call (convenience wrapper)."""
    cards = build_card_data(title, body, keywords, config, ai_generator=ai_generator)
    return render_card_news(cards, title, config, output_root=output_root)
