# content_service

Chrome이 필요 없는 Python 로직을 FastAPI로 노출. 블로그 글 생성(ontology v2)·키워드 분석·이미지 수집·카드뉴스 렌더링.

## 실행

```bash
cd content_service
poetry install
poetry run uvicorn main:app --reload --port 8000
```

## 엔드포인트 (예정)

- `GET /health` — 생존 확인
- `POST /api/generate` — ontology v2 블로그 글 생성
- `GET /api/keywords?q=...` — 키워드 분석 (검색광고 API + 블로그 수 + 트렌드)
- `POST /api/images/search` — Unsplash/Pixabay 검색
- `POST /api/images/generate` — Pollinations/DALL-E/Gemini AI 이미지
- `POST /api/cards/build` — 카드뉴스 텍스트 생성 (AI 요약)
- `POST /api/cards/render` — 카드뉴스 PNG 렌더링

## 배포

- 개발: 로컬 `uvicorn`
- 프로덕션: Render 또는 Fly.io (Vercel Functions는 LLM 호출 timeout 이슈)
