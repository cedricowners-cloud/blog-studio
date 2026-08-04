# blog_studio 아키텍처

## 컴포넌트

```
┌─────────────────────┐         ┌─────────────────────────┐
│  Web (Next.js)      │ HTTP    │  content_service        │
│  Vercel 배포        │ ◀────▶  │  (FastAPI, Render/Fly)  │
│  글 생성 UI·편집·통계 │         │  Chrome 불필요 Python   │
└──────┬──────────────┘         └─────────┬───────────────┘
       │ supabase-js                       │ supabase-py (service_role)
       ▼                                   ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase                                                 │
│  - Auth (이메일/매직링크)                                 │
│  - Postgres (blog_posts, axiom_stats, jobs, job_logs,     │
│    agent_heartbeat, keyword_lookups, publish_history)     │
│  - Realtime (jobs, job_logs)                              │
│  - Storage (카드뉴스 PNG — 추후)                          │
└──────▲────────────────────────────────────────────────────┘
       │ 폴링 + refresh_token auth
       │
┌──────┴───────────────────┐
│  Local Agent             │
│  사용자 PC 상주           │
│  seleniumbase UC 드라이버 │
│  - 네이버 로그인          │
│  - 블로그 발행            │
│  - 서로이웃·좋아요·댓글   │
└──────────────────────────┘
```

## 데이터 흐름

**글 생성**:
1. Web `/generate` → content_service `POST /api/generate`
2. content_service가 prompt_builder → LLM → response_parser → axiom_validator → retry_loop
3. 완료되면 Supabase `blog_posts` + `axiom_stats` insert, 결과 반환
4. Web이 결과 렌더, 편집 가능

**발행 (Chrome 필요)**:
1. Web이 Supabase `jobs` insert: `{type: 'publish', payload: {...}, account_name, status: 'pending'}`
2. Local Agent 폴링 루프가 pending job 픽업 → `status: 'running'` 으로 claim
3. DriverPool에서 해당 account 의 UC 드라이버 acquire
4. naver_editor로 실제 발행 → `job_logs` 로 진행 로그 스트리밍
5. 완료/실패 시 `jobs.status` 업데이트, Web은 Realtime 구독으로 알림 표시

## 보안 모델

- **네이버 ID/PW**: 로컬 에이전트 `data/accounts.enc` 에만. Fernet(PBKDF2-HMAC-SHA256) 암호화. Passphrase는 저장 안 됨(매 실행 입력).
- **쿠키**: 로컬 `data/cookies/naver_<account>.json`. Git ignored.
- **Supabase 세션(로컬 에이전트)**: refresh_token 을 `data/agent_auth.enc` 에 암호화 저장
- **API 키(LLM·네이버)**: 서버 `.env` 에만. Web은 절대 직접 접근 못 함 → 반드시 content_service 경유
- **RLS**: 모든 Supabase 테이블은 `auth.uid()` 제약 (Phase 3+ multi-user 확장 고려)

## 확장 포인트

- **Ontology v2 Phase 3** (도메인 DB 자동화): `domain_programs` 테이블에 정부지원사업 자동 수집 → `domain_info` 로 자동 주입
- **발행 예약**: `jobs.scheduled_at` 컬럼 추가 → worker 가 현재 시각 이후만 pick
- **다중 에이전트**: 기기별 `agent_id` 와 claim 로직 이미 있음. 계정 label → 기기 매핑만 정하면 복수 PC 분산 발행 가능
- **실시간 알림**: Web에서 `job_logs` Realtime 구독으로 진행 상황 라이브 스트림
