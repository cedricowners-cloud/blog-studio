# blog_studio

네이버 블로그 콘텐츠 생성·발행 자동화 시스템. 기존 `blog_auto` 데스크톱 앱을 **웹 + 로컬 에이전트** 아키텍처로 재구성.

## 구성

```
blog_studio/
├── web/              # Next.js 14, Vercel 배포. 글 생성·편집·카드뉴스·통계 UI
├── content_service/  # FastAPI. Chrome 불필요한 Python 로직 (블로그 생성·키워드·이미지)
├── local_agent/      # 로컬 PC 상주 Python. Chrome 자동화 (로그인·발행·이웃)
├── shared_py/        # content_service + local_agent 공통 Python 모듈
├── prompts/          # 온톨로지 v2 LLM 시스템 프롬프트 (blog_auto/blog_ontology_v2/prompts 에서 복사)
├── schemas/          # 입출력 스키마 + DB 스키마 원본 (blog_auto/blog_ontology_v2/schemas 에서 복사)
├── supabase/         # DB 마이그레이션 + Supabase CLI 설정
└── docs/
```

## 아키텍처

```
Web (Vercel)  ──▶  Supabase  ◀──  Local Agent (사용자 PC 상주)
                  (jobs 큐·결과·글DB)         seleniumbase UC
```

- 웹은 브라우저에서 `http://localhost` 직접 호출 안 함 → **Supabase jobs 테이블**을 공유 큐로 사용
- 로컬 에이전트는 Supabase Realtime 구독 + 폴링 폴백으로 작업 수신
- PNA·CORS·mixed content 문제 전부 회피

## 전체 계획

`/Users/seolhee/.claude/plans/magical-splashing-dewdrop.md` 참조.

## 기존 프로젝트

마이그레이션 완료 전까지 `/Users/seolhee/Documents/00_project/blog_auto/`를 그대로 사용.

## prompts / schemas 동기화

`prompts/`, `schemas/` 디렉토리는 `blog_auto/blog_ontology_v2/`에서 복사된 사본입니다.
원본을 수정한 경우 다음 명령으로 다시 동기화:

```bash
cd blog_studio
rm -rf prompts schemas
cp -R ../blog_auto/blog_ontology_v2/prompts ./prompts
cp -R ../blog_auto/blog_ontology_v2/schemas ./schemas
```

(과거에는 심볼릭 링크였으나, GitHub push / Vercel 배포 시 외부 환경에서 깨지는 문제로 실제 파일 복사로 전환됨.)
