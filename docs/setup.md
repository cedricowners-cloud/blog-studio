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

네이버 발행은 Chrome 자동화가 필요해서 사용자 PC에서 돌아가는 에이전트가
담당한다. 웹은 Supabase `jobs` 테이블에 작업을 넣고 진행 상황만 읽는다.

```bash
cd local_agent
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt   # poetry 쓰면 `poetry install`

# Supabase 접속 정보는 보통 따로 넣을 필요가 없다 (아래 "설정 탐색 순서" 참고)

# 1) 웹 /agent 에서 "네이버 계정 등록" — 여기 등록한 이름으로만 발행 가능
#    (RLS: jobs INSERT 는 account_name ∈ my_accounts() 를 요구)
# 2) 웹 /agent 의 "페어링 값 보기" 로 세션 JSON 복사
# 3) 페어링
./.venv/bin/python -m local_agent.pairing
# 4) 상시 실행
./.venv/bin/python -m local_agent.main
```

### 설정 탐색 순서 (Supabase URL / anon key)

같은 값이 저장소 안에 이미 여러 이름으로 들어 있어서, 또 적지 않도록
에이전트가 아래 순서로 찾는다 (`local_agent/worker.py:_resolve_supabase_config`).

1. 환경변수 `SUPABASE_URL` / `SUPABASE_ANON_KEY`
2. 환경변수 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. 파일 순서: `blog_studio/.env` → `web/.env.local` → `content_service/.env`
   (각 파일에서 위 네 이름을 모두 확인)

anon key 는 설계상 공개 키라(브라우저 번들에 그대로 실린다) 이렇게 공유해도
노출 위험이 늘지 않는다. 다만 **필요한 두 값만 골라 읽는다** —
파일 전체를 환경에 올리면 `SUPABASE_SERVICE_ROLE_KEY` 같은 무관한 비밀이
에이전트 프로세스로 끌려 들어온다.

**첫 발행 시 수동 로그인이 필요하다.** `login_naver` 는 ID/PW 를 쓰지 않고
`data/cookies/naver_<계정명>.json` 쿠키로 로그인한다. 쿠키가 없으면 브라우저
창을 띄우고 180초 동안 사용자가 직접 로그인하기를 기다린 뒤 쿠키를 저장한다.
이후 발행은 저장된 쿠키로 자동 진행된다.

**발행 1건당 브라우저를 최소 15분 점유한다** (`stay_minutes` 기본값). 네이버
차단 회피를 위한 체류 시간이며 웹 발행 패널에서 조정할 수 있다.

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
5. 웹 `/posts/<id>` → "네이버 블로그에 발행" → `jobs` insert → 로컬 에이전트가
   수신 → Chrome으로 실제 발행 → `job_logs` 로 진행 상황이 웹에 표시됨

### 발행 시 본문이 변환된다

생성된 본문과 에디터가 해석하는 마크업이 완전히 같지 않아
`web/lib/naver-markup.ts` 가 발행 직전에 보정한다. 발행 패널에 무엇이 바뀌는지
경고로 표시된다.

- `[IMG: 설명]` → **제거됨**. 에디터는 `[img]/로컬/경로.jpg[/img]` 형태의 실제
  파일 경로만 받는데, 웹에서 고른 이미지는 URL뿐이라 에이전트 PC로 내려받는
  단계가 아직 없다. 발행 후 네이버 에디터에서 직접 넣어야 한다.
- 마크다운(`## 제목`, `**굵게**`) → `[h2]`, `[bold]` 로 변환. 글마다 포맷이
  달라서(일부는 마크다운, 일부는 마크업) 양쪽을 모두 처리한다.
- 닫히지 않은 `[h2]` → 줄 끝에서 자동으로 닫는다.
- 마크다운 표(`| a | b |`) → 에디터에 표 서식이 없어 `|` 가 그대로 보인다.
  경고만 띄우고 변환하지 않는다.

## 트러블슈팅

- **Vercel 배포에서 LLM 타임아웃**: content_service는 Vercel Functions 대신 Render/Fly.io 같은 long-running 환경에 배포. `maxDuration` 높이기 가능하나 300초까지만.
- **로컬 에이전트가 Supabase 접근 못함**: `.env`의 `SUPABASE_ANON_KEY` 확인. 페어링 후 `agent_auth.enc` 복호화 실패면 passphrase 불일치.
- **키워드 API 503**: 네이버 검색광고 API 키(`NAVER_SEARCH_ACCESS_LICENSE_KEY` / `SECRET_KEY` / `CUSTOMER_ID`) 세 개 다 설정됐는지 확인.
- **Chrome 147 크래시**: base_to_excel.py에 이미 seleniumbase UC 기반으로 마이그레이션 완료 (blog_auto에서 검증). macOS에서 `--disable-dev-shm-usage` 자동 제외됨.
