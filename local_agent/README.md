# local_agent

사용자 PC에 상주하는 Python 프로세스. Supabase `jobs` 큐를 폴링해서 Chrome 자동화 작업만 수행.

## 담당 작업

- 네이버 로그인 (쿠키 최초 획득)
- 블로그 글 발행 (네이버 SmartEditor 조작)
- 서로이웃 신청
- 좋아요·댓글 (공식 내부 API, 단 쿠키 필요)

## 실행

**반드시 저장소 루트(`blog_studio/`)에서 실행한다.** 이 디렉토리 안으로
들어가서 실행하면 `sys.path[0]` 이 `local_agent/` 가 되어 `local_agent` 패키지를
찾지 못하고 `ModuleNotFoundError: No module named 'local_agent'` 로 죽는다.
(`pyproject.toml` 이 `package-mode = false` 라 설치형 패키지가 아니고, 패키지
디렉토리의 **부모**가 import 경로에 있어야 한다.)

```bash
cd blog_studio                                      # ← 루트 유지
python3 -m venv local_agent/.venv
./local_agent/.venv/bin/pip install -r local_agent/requirements.txt

./local_agent/.venv/bin/python -m local_agent.pairing   # 최초 1회 페어링
./local_agent/.venv/bin/python -m local_agent.main      # 상시 실행
./local_agent/.venv/bin/python -m local_agent.main --no-tray   # 포어그라운드 로그
```

`main` 은 시스템 트레이 아이콘 + 백그라운드 worker 를 띄운다. `pystray` 가
없으면 포어그라운드 모드로 자동 폴백한다.

설치는 `requirements.txt` 를 쓴다 — `package-mode = false` 때문에
`pip install -e .` 는 `metadata-generation-failed` 로 실패한다. poetry 를
쓴다면 `poetry install` 도 된다.

## 인증·자격증명 실제 동작

문서와 코드가 어긋나 있던 부분이라 실제 동작을 명시한다.

**네이버 로그인은 ID/PW 를 쓰지 않는다.** `lib/base_to_excel.py:login_naver` 는
`data/cookies/naver_<계정명>.json` 쿠키로 로그인하고, 쿠키가 없거나 만료되면
브라우저 창을 띄워 **사용자가 180초 안에 직접 로그인**하기를 기다린 뒤 쿠키를
저장한다. 즉 계정명은 쿠키 파일을 구분하는 라벨에 불과하다.

- `lib/account_manager.py` 는 평문 JSON(`lib/data/accounts.json`)에 ID/PW 를
  저장하는 코드지만 **로그인 경로에서 호출되지 않는 죽은 코드**다.
- `secrets.py` 의 암호화 계정 저장소(`data/accounts.enc`)도 로그인에
  쓰이지 않는다. 실제로 쓰이는 건 `data/agent_auth.enc` (Supabase 토큰)뿐이다.

**Supabase 인증**은 사용자 계정의 refresh token 을 쓴다. 웹 `/agent` 의
"페어링 값 보기" 로 세션 JSON 을 복사해 `local_agent.pairing` 에 붙여넣으면
passphrase 로 Fernet 암호화해서 `data/agent_auth.enc` 에 저장한다.
(QR 방식이 아니다 — `qrcode` 의존성은 현재 미사용.)

따라서 에이전트는 **사용자 권한**으로 Supabase 에 접근한다. RLS 의
`is_agent()` 전용 정책이 아니라 소유자 정책을 타며, 이 전제가 마이그레이션
016 의 배경이다.

`data/` 전체가 `.gitignore` 대상이다.

## 설정 탐색

Supabase URL / anon key 는 `worker.py:_resolve_supabase_config` 가 아래 순서로
찾는다. 저장소에 이미 같은 값이 다른 이름으로 있어서 보통 따로 넣을 필요가 없다.

1. 환경변수 `SUPABASE_URL` / `SUPABASE_ANON_KEY`
2. 환경변수 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. 파일: `blog_studio/.env` → `web/.env.local` → `content_service/.env`

필요한 두 값만 골라 읽는다 — 파일 전체를 환경에 올리면
`SUPABASE_SERVICE_ROLE_KEY` 같은 무관한 비밀이 프로세스로 끌려 들어온다.

## 발행 시 유의

- **즉시 발행**이다. 임시저장 옵션이 없다.
- 글 1건당 브라우저를 **최소 15분 점유**한다 (`stay_minutes` 기본값, 차단 회피용).
  웹 발행 패널에서 조정 가능.
- 본문은 웹이 `web/lib/naver-markup.ts` 로 네이버 마크업으로 변환해 payload 에
  확정 저장한다. 에이전트는 다시 해석하지 않는다.
