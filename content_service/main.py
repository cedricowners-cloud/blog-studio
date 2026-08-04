"""blog_studio content_service — FastAPI 엔트리포인트."""
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# shared_py를 import 경로에 추가
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

load_dotenv(PROJECT_ROOT / ".env")  # root MCP 키 (있으면 호환성)
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)  # content_service 전용 (우선)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

from routers import generate, health  # noqa: E402
# keywords/cards/images 라우터는 web (Next.js /api/*) 으로 이전됨 — 여기선 비활성화
# (selenium/playwright/pillow 등 무거운 deps 회피)

app = FastAPI(
    title="blog_studio content_service",
    version="0.1.0",
    description="Chrome-free Python logic (블로그 생성·키워드·이미지·카드뉴스)",
)

# CORS — 개발 중 Next.js localhost:3000 + Vercel 배포 도메인 허용
allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(generate.router, prefix="/api/generate", tags=["generate"])
# keywords/cards/images 라우터는 web (Next.js /api/*) 으로 이전됨


@app.get("/")
async def root():
    return {
        "service": "content_service",
        "version": "0.1.0",
        "docs": "/docs",
    }
