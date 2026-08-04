"""카드뉴스 라우터 — 본문 → AI 요약된 카드 데이터 (PNG 렌더링은 추후)."""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# shared_py import 경로
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared_py.cards.parser import build_cards  # type: ignore
from ontology.llm_client import LLMClient, Provider

logger = logging.getLogger(__name__)

router = APIRouter()


class CardBuildRequest(BaseModel):
    title: str
    body: str
    keywords: list[str] = Field(default_factory=list)
    card_count: int | str = "auto"
    use_ai: bool = True
    provider: Provider = "gemini"
    model: str | None = None


class CardBuildResponse(BaseModel):
    cards: list[dict[str, Any]]
    used_ai: bool


@router.post("/build", response_model=CardBuildResponse)
async def build(req: CardBuildRequest):
    """본문에서 카드 텍스트만 생성 (PNG 렌더는 render 엔드포인트 분리)."""
    ai_generator = None
    if req.use_ai:
        client = LLMClient(provider=req.provider, model=req.model, temperature=0.5)

        # shared_py.cards.parser 는 ai_generator.generate_content(prompt, temperature=..) 형식을 기대
        class _Adapter:
            def generate_content(self, prompt: str, temperature: float = 0.5) -> str:
                client.temperature = temperature
                return client.generate(prompt).text

        ai_generator = _Adapter()

    try:
        cards = build_cards(
            title=req.title,
            body=req.body,
            keywords=req.keywords,
            card_count=req.card_count,
            ai_generator=ai_generator,
        )
    except Exception as e:
        logger.exception("build_cards 실패")
        raise HTTPException(status_code=500, detail=f"카드 생성 실패: {e}")

    return CardBuildResponse(cards=cards, used_ai=bool(ai_generator))


# NOTE: /render 는 playwright + chromium 필요. Phase 에서 분리 구현.
#   - 서버리스(Vercel) 환경에서 playwright chromium 설치가 무거워 별도 배포(Render) 권장.
#   - 당분간은 웹에서 카드 텍스트 편집만 지원하고, PNG는 로컬 에이전트 또는 별도 워커가 담당.
