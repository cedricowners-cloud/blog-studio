import { defineConfig } from 'wxt';

// 설계 문서: docs/extension/DESIGN-detail.md (8장 권한)
// 모든 사이트 접근 권한은 요청하지 않는다. 네이버 블로그와, 글을 만들 때 부르는 AI 3사의 API 주소만 연다.
export default defineConfig({
  // 기본값(.output)은 숨김 폴더라서 크롬의 폴더 선택 창에 보이지 않는다. 보이는 이름으로 바꾼다.
  outDir: 'dist',
  manifest: {
    name: 'blog_studio 도우미',
    description: '내 AI 키로 블로그 글을 만들고, 네이버 블로그 글쓰기 화면에 채웁니다. 발행은 직접 누릅니다.',
    permissions: ['sidePanel', 'storage', 'scripting', 'activeTab'],
    host_permissions: [
      'https://blog.naver.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
    ],
    action: {
      default_title: 'blog_studio 도우미 열기',
    },
  },
});
