# local_agent

사용자 PC에 상주하는 Python 프로세스. Supabase `jobs` 큐를 구독해서 Chrome 자동화 작업만 수행.

## 담당 작업

- 네이버 로그인 (쿠키 최초 획득)
- 블로그 글 발행 (네이버 SmartEditor 조작)
- 서로이웃 신청
- 좋아요·댓글 (공식 내부 API, 단 쿠키 필요)

## 보안

- 네이버 ID/PW는 **로컬 파일**(`data/accounts.enc`)에 Fernet 암호화만. Supabase에는 절대 송신 X
- Supabase 인증은 사용자 계정의 refresh token (최초 QR 페어링으로 수급)
- `data/` 전체 `.gitignore`

## 실행

```bash
cd local_agent
poetry install
poetry run python main.py
```

시스템 트레이 아이콘 + 백그라운드 worker 실행.
