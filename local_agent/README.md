# local_agent

사용자 PC에 상주하는 Python 프로세스. Supabase `jobs` 큐를 폴링해서 Chrome 자동화 작업만 수행.

## 담당 작업

- 네이버 로그인 (쿠키 최초 획득)
- 블로그 글 발행 (네이버 SmartEditor 조작)
- 서로이웃 신청
- 좋아요·댓글 (공식 내부 API, 단 쿠키 필요)

## 실행

`run.py` 를 쓴다. **어느 디렉토리에서 실행해도 된다.**

```bash
./local_agent/agent pair        # 최초 1회 페어링 (venv·의존성 자동 설치)
./local_agent/agent             # 포어그라운드 실행
./local_agent/agent --no-tray   # 트레이 없이 로그만
```

### 백그라운드 상주 (launchd)

포어그라운드 실행은 터미널을 닫으면 종료된다. 로그인할 때 자동 시작되고
죽으면 재시작되게 하려면:

```bash
./local_agent/agent migrate     # 기존 passphrase 페어링을 키체인으로 이전
./local_agent/agent install     # LaunchAgent 등록
./local_agent/agent status      # 등록·실행 상태 + 최근 오류
./local_agent/agent logs        # 로그 따라가기
./local_agent/agent uninstall   # 해제
```

**키체인이 필수다.** `launchd` 에는 TTY 가 없어 `getpass` 로 passphrase 를
물을 수 없다. 그래서 세션을 OS 키체인에 두고(로그인 세션과 함께 해제됨)
프롬프트를 없앤다. passphrase 를 plist 에 적는 것보다 안전하다.
키체인에 세션이 없으면 `install` 이 등록을 거부한다 — 등록해두면 인증
실패로 60초마다 재시작만 반복하기 때문이다.

plist 는 `~/Library/LaunchAgents/com.blogstudio.localagent.plist` 에 생성되고
로그는 `local_agent/data/agent.log` / `agent.err.log` 에 쌓인다.
`PATH` 를 명시하는 이유는 launchd 환경이 비어 있어 Chrome·드라이버 탐색이
실패하기 때문이다.

LaunchAgent 는 사용자 GUI 세션에서 돌기 때문에 브라우저 창을 띄울 수 있다.
다만 쿠키가 없을 때 뜨는 **180초 수동 로그인 창은 자리에 없으면 그냥
만료된다** — 계정별 최초 로그인은 포어그라운드로 한 번 해두는 쪽이 낫다.

`run.py` 없이 `-m local_agent.main` 을 쓰려면 **저장소 루트에서만** 된다.
`local_agent/` 안에서 실행하면 `sys.path[0]` 이 `local_agent/` 가 되어 패키지를
찾지 못하고 `ModuleNotFoundError: No module named 'local_agent'` 로 죽는다.
`pyproject.toml` 이 `package-mode = false` 라 설치형 패키지가 아니어서 cwd 에
전적으로 의존하기 때문이다. `run.py` 는 cwd 대신 `__file__` 로 부모 경로를
직접 넣어 이 문제를 없앤다.

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
"페어링 값 보기" 로 세션 JSON 을 복사해 `agent pair` 에 붙여넣는다.
(QR 방식이 아니다 — `qrcode` 의존성은 현재 미사용.)

저장 위치는 두 가지이고 **키체인을 먼저 읽는다**(`load_agent_auth_any`).

| | OS 키체인 (권장) | 암호화 파일 |
|---|---|---|
| 위치 | `blog_studio.local_agent` 서비스 | `data/agent_auth.enc` |
| 보호 | 로그인 키체인 | passphrase + Fernet(PBKDF2) |
| 실행 시 입력 | 없음 | 매번 passphrase |
| launchd 상주 | 가능 | **불가** (TTY 없음) |

`keyring` 이 설치돼 있으면 `pair` 가 키체인에 저장한다. 기존 파일 페어링은
`agent migrate` 로 옮긴다(원본은 남겨두므로 되돌릴 수 있다).

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

### 임시저장 / 발행 두 모드

`write_blog_post(..., save_as_draft=True)` — **기본값은 임시저장(비공개)**이다.
공개 발행은 되돌리려면 네이버에서 직접 삭제해야 하므로, 공개는 호출자가
명시해야 한다. 웹 발행 패널에서 선택한다.

| | 임시저장 | 발행 |
|---|---|---|
| 공개 여부 | 비공개 (글쓰기 > 저장 목록) | 공개 |
| 태그 | **적용 안 됨** | 적용됨 |
| 글 주소 | 없음 | `blog_posts.naver_post_url` 에 기록 |
| `published_at` | 기록 안 함 | 기록 |

임시저장에 태그를 넣을 수 없는 건 네이버가 태그를 **발행 설정 레이어에서만**
받기 때문이다.

### 과거 구현의 이력 (혼동 방지)

`blog_auto` 에는 "임시저장 모드" 체크박스가 있었지만 **동작하지 않았다.**
`gui_handlers.py` → `gui_workers.py` 까지 `save_as_draft` 를 전달하면서도
`write_blog_post` 호출에는 넘기지 않았고, 애초에 그 함수에 해당 파라미터가
없었다. 즉 UI 에만 있는 값이었다.

그 단일 경로는 `발행` 레이어를 열어 태그를 입력한 뒤 **레이어를 닫고**
툴바의 `저장` 을 누르는 순서였다. 레이어를 닫는 순간 태그 입력이 버려질
가능성이 커서, 지금의 임시저장 경로에서는 레이어를 아예 열지 않는다.

버튼은 해시 클래스(`.save_btn__bzc5B`)가 빌드마다 바뀌므로, 못 찾으면
`utils.find_clickable_by_text` 로 라벨("저장"/"발행")을 찾아 대체한다.
첫 실행 로그에 버튼 라벨·클래스 목록을 남기므로(`_log_clickables`) 실제 DOM
구조를 그 로그로 확인할 수 있다.

### 그 외

- 글 1건당 브라우저를 **최소 15분 점유**한다 (`stay_minutes` 기본값, 차단 회피용).
  웹 발행 패널에서 조정 가능.
- 본문은 웹이 `web/lib/naver-markup.ts` 로 네이버 마크업으로 변환해 payload 에
  확정 저장한다. 에이전트는 다시 해석하지 않는다.
