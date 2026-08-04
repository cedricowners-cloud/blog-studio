"""이미지 수집/생성 라우터 — Unsplash/Pixabay 검색 + Pollinations/DALL-E/Gemini 생성."""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared_py.content import image_collector as ic  # type: ignore

logger = logging.getLogger(__name__)

router = APIRouter()


class SearchRequest(BaseModel):
    keyword: str = Field(min_length=1)
    count: int = Field(default=3, ge=1, le=10)


class SearchResponse(BaseModel):
    images: list[dict[str, Any]]


@router.post("/search", response_model=SearchResponse)
async def search(req: SearchRequest):
    try:
        images = ic.search_images(req.keyword, req.count) or []
    except Exception as e:
        logger.exception("search_images 실패")
        raise HTTPException(status_code=502, detail=str(e))
    return SearchResponse(images=images)


class GenerateImageRequest(BaseModel):
    prompt: str = Field(min_length=1)
    provider: Literal["pollinations", "dalle", "gemini"] = "pollinations"


class GenerateImageResponse(BaseModel):
    path: str | None
    url: str | None = None
    provider: str


@router.post("/generate", response_model=GenerateImageResponse)
async def generate(req: GenerateImageRequest):
    try:
        result = ic.generate_ai_image(req.prompt, provider=req.provider)
    except Exception as e:
        logger.exception("generate_ai_image 실패")
        raise HTTPException(status_code=502, detail=str(e))

    if not result:
        raise HTTPException(status_code=502, detail="이미지 생성 실패")

    return GenerateImageResponse(
        path=result.get("path"),
        url=result.get("url"),
        provider=req.provider,
    )
