import json
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Literal

MoodType = Literal["professional", "friendly", "bold", "soft"]
TriggerMode = Literal["auto", "manual"]

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "card_news_config.json"


@dataclass
class CardNewsColors:
    primary: str = "#FF5DA2"
    secondary: str = "#2B2B2B"
    accent: str = "#FFD93D"
    background: str = "#FFFFFF"


@dataclass
class CardNewsConfig:
    brand_name: str = "블로그 자동화"
    colors: CardNewsColors = field(default_factory=CardNewsColors)
    mood: MoodType = "professional"
    font_family: str = "Pretendard"
    card_count: str = "auto"
    trigger_mode: TriggerMode = "manual"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "CardNewsConfig":
        colors_data = data.get("colors", {})
        return cls(
            brand_name=data.get("brand_name", cls.brand_name),
            colors=CardNewsColors(**colors_data) if colors_data else CardNewsColors(),
            mood=data.get("mood", cls.mood),
            font_family=data.get("font_family", cls.font_family),
            card_count=data.get("card_count", cls.card_count),
            trigger_mode=data.get("trigger_mode", cls.trigger_mode),
        )


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> CardNewsConfig:
    if not path.exists():
        config = CardNewsConfig()
        save_config(config, path)
        return config
    with path.open("r", encoding="utf-8") as f:
        return CardNewsConfig.from_dict(json.load(f))


def save_config(config: CardNewsConfig, path: Path = DEFAULT_CONFIG_PATH) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(config.to_dict(), f, ensure_ascii=False, indent=2)
