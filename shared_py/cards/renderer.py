from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.sync_api import sync_playwright

from .config import CardNewsConfig

TEMPLATE_DIR = Path(__file__).parent / "templates"
CARD_SIZE = 1080

_TEMPLATE_BY_TYPE = {
    "cover": "cover.html",
    "content": "content.html",
    "list": "list.html",
    "closing": "closing.html",
}


def _build_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )


def render_html(card: dict[str, Any], config: CardNewsConfig, card_index: int, card_total: int) -> str:
    card_type = card["type"]
    if card_type not in _TEMPLATE_BY_TYPE:
        raise ValueError(f"Unknown card type: {card_type}")

    env = _build_env()
    template = env.get_template(_TEMPLATE_BY_TYPE[card_type])

    context = {
        **card,
        "card_type": card_type,
        "card_index": card_index,
        "card_total": card_total,
        "brand_name": config.brand_name,
        "colors": config.colors,
        "mood": config.mood,
        "font_family": config.font_family,
    }
    return template.render(**context)


def render_cards_to_png(cards: list[dict[str, Any]], config: CardNewsConfig, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    total = len(cards)
    saved_paths: list[Path] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            viewport={"width": CARD_SIZE, "height": CARD_SIZE},
            device_scale_factor=2,
        )
        page = context.new_page()

        for i, card in enumerate(cards, start=1):
            html = render_html(card, config, card_index=i, card_total=total)
            page.set_content(html, wait_until="networkidle")
            output_path = output_dir / f"{i:02d}.png"
            page.screenshot(path=str(output_path), clip={"x": 0, "y": 0, "width": CARD_SIZE, "height": CARD_SIZE})
            saved_paths.append(output_path)

        browser.close()

    return saved_paths
