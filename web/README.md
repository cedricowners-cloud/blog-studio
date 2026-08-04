# web

Next.js 14 (App Router) 프론트엔드. Vercel 배포.

## 기술 스택

- Next.js 14 App Router, TypeScript
- Supabase Auth (이메일 + 매직 링크)
- Tailwind CSS + shadcn/ui
- TanStack Query (서버 상태)
- Zod (폼 검증)

## 주요 페이지

- `/generate` — 블로그 글 생성 (ontology v2 6방식 + L1~L4)
- `/keywords` — 키워드 분석 (월간검색수·클릭·경쟁도·블로그 발행 수/포화도 등)
- `/images` — 이미지 수집·생성
- `/cards` — 카드뉴스 편집 + PNG 생성
- `/publish` — 발행 큐 + 이력
- `/stats` — 통계 대시보드
- `/settings` — 네이버 계정 레이블 + 에이전트 페어링 + API 키

## 실행

```bash
cd web
pnpm install
pnpm dev
```
