"""Health check endpoints."""
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/ready")
async def ready():
    # TODO Step 2+: Supabase 연결 + LLM API 키 존재 여부 확인
    return {"status": "ready"}
