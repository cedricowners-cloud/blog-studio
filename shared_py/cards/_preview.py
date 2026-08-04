"""Design preview: render sample card set across all 4 moods for visual review."""
from dataclasses import replace
from pathlib import Path

from card_news.config import CardNewsColors, CardNewsConfig
from card_news.renderer import render_cards_to_png

PREVIEW_DIR = Path(__file__).resolve().parent.parent / "data" / "card_news" / "_preview"

SAMPLE_CARDS = [
    {
        "type": "cover",
        "eyebrow": "CEO GUIDE",
        "main_title": "CEO가 알아야 할\n기초 노동법",
        "sub_title": "꼭 챙겨야 할 핵심 포인트 5가지",
        "tagline": "실수로 놓치면 수백만원 과태료",
    },
    {
        "type": "content",
        "section_label": "01. 근로계약서",
        "heading": "근로계약서는\n입사 첫날 작성해야 합니다",
        "lead": "작성 지연 시 500만원 이하 과태료",
        "body_text": "서면 교부 원칙이며, 임금·근로시간·휴일·연차 등 필수 기재사항이 빠지면 근로계약서로 인정되지 않습니다.",
    },
    {
        "type": "list",
        "section_label": "02. 체크리스트",
        "heading": "반드시 포함해야 할\n필수 기재사항",
        "items": [
            "임금 구성항목 · 계산방법 · 지급방법",
            "소정근로시간 및 휴게시간",
            "휴일 및 연차 유급휴가",
            "취업 장소 및 담당 업무",
            "근로계약 기간 (계약직인 경우)",
        ],
    },
    {
        "type": "closing",
        "message": "한 번의 실수로\n사업장이 흔들릴 수 있습니다",
        "cta": "자세한 내용은 블로그에서 확인하세요",
    },
]

BASE_CONFIG = CardNewsConfig(
    brand_name="비즈디렉터 이팀장",
    colors=CardNewsColors(
        primary="#FF5DA2",
        secondary="#2B2B2B",
        accent="#FFD93D",
        background="#FFFFFF",
    ),
    font_family="Pretendard",
)


def main() -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for mood in ("professional", "friendly", "bold", "soft"):
        config = replace(BASE_CONFIG, mood=mood)
        out = PREVIEW_DIR / mood
        paths = render_cards_to_png(SAMPLE_CARDS, config, out)
        print(f"[{mood}] {len(paths)} cards -> {out}")


if __name__ == "__main__":
    main()
