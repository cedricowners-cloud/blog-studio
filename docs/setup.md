# blog_studio 초기 설정

## 1. Supabase 프로젝트 준비

1. [supabase.com](https://supabase.com) 에서 프로젝트 생성
2. SQL Editor → `supabase/migrations/001_ontology_v2.sql` 붙여넣고 실행
3. 같은 방법으로 `002_agent_queue.sql` 실행
4. Project Settings → API에서 `URL`, `anon public key`, `service_role key` 복사

## 2. content_service (FastAPI) 실행

```bash
cd content_service
poetry install
cp ../.env.example ../.env
# .env 편집: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, NAVER_SEARCH_* 채우기
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 도 .env 에
poetry run uvicorn main:app --reload --port 8000
```

검증:
- `curl http://localhost:8000/health` → `{"status":"ok"}`
- `curl "http://localhost:8000/api/keywords?q=종합소득세"` → 키워드 리스트
- Swagger: http://localhost:8000/docs

## 3. 웹(Next.js) 실행

```bash
cd web
pnpm install
cp .env.local.example .env.local
# .env.local 편집: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / CONTENT_SERVICE_URL
pnpm dev  # → http://localhost:3000
```

이메일 로그인 사용하려면 Supabase Auth에서 이메일 provider 활성화.

## 4. 로컬 에이전트 실행 (Chrome 자동화 담당)

```bash
cd local_agent
poetry install
# .env 편집: SUPABASE_URL / SUPABASE_ANON_KEY
# 첫 실행: passphrase 설정
poetry run python -m local_agent.main
# 안내에 따라 끝나면 페어링:
poetry run python -m local_agent.pairing
# 웹 /settings 에서 페어링 토큰 받아 붙여넣기
# 그 후 다시:
poetry run python -m local_agent.main
```

## 5. 마이그레이션 상태 확인 (선택)

```bash
# Supabase CLI 가 있다면:
supabase db push
# 혹은 SQL Editor에서 수동 붙여넣기
```

## 엔드투엔드 시나리오

1. 웹 `/generate` → 방식 6 + 도메인 정보 입력 → 공리 검증 통과하는 글 생성
2. 웹 `/cards` → 카드뉴스 텍스트 편집
3. 웹 `/keywords` → 관련 키워드 조회 → CSV 다운로드
4. 웹 `/stats` → 최근 생성·공리 통과율 확인
5. (추후 발행 UI) → Supabase `jobs` insert → 로컬 에이전트가 수신 → Chrome으로 실제 네이버 발행

## 트러블슈팅

- **Vercel 배포에서 LLM 타임아웃**: content_service는 Vercel Functions 대신 Render/Fly.io 같은 long-running 환경에 배포. `maxDuration` 높이기 가능하나 300초까지만.
- **로컬 에이전트가 Supabase 접근 못함**: `.env`의 `SUPABASE_ANON_KEY` 확인. 페어링 후 `agent_auth.enc` 복호화 실패면 passphrase 불일치.
- **키워드 API 503**: 네이버 검색광고 API 키(`NAVER_SEARCH_ACCESS_LICENSE_KEY` / `SECRET_KEY` / `CUSTOMER_ID`) 세 개 다 설정됐는지 확인.
- **Chrome 147 크래시**: base_to_excel.py에 이미 seleniumbase UC 기반으로 마이그레이션 완료 (blog_auto에서 검증). macOS에서 `--disable-dev-shm-usage` 자동 제외됨.
