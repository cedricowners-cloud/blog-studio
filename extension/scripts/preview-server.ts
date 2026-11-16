// 사이드 패널 화면을 크롬에 설치하지 않고 보통 브라우저에서 열어 보는 도구. 개발할 때만 쓴다.
//   npm run build && npm run preview   →  http://localhost:4179
//
// 빌드한 화면(dist)에 가짜 확장 기능(preview-stub.js)을 끼워서 보여 준다.
// 가짜 기능: 저장소는 그 탭의 메모리에만 있고, AI 호출은 진짜 AI 대신 미리 적어 둔 답을 돌려준다.
// 이 파일과 preview-stub.js 는 확장 패키지에 들어가지 않는다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'chrome-mv3');
const packFile = join(here, '..', 'prompt-pack', 'blog-studio-prompts.json');
const port = Number(process.env.PORT ?? 4179);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    try {
      if (url.pathname === '/' || url.pathname === '/sidepanel.html') {
        const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf-8')) as { version: string };
        const html = (await readFile(join(dist, 'sidepanel.html'), 'utf-8')).replace(
          '<head>',
          `<head><script>window.__PREVIEW_VERSION__=${JSON.stringify(manifest.version)}</script><script src="/__preview-stub.js"></script>`,
        );
        res.writeHead(200, { 'content-type': TYPES['.html'] }).end(html);
        return;
      }
      if (url.pathname === '/__preview-stub.js') {
        const stub = await readFile(join(here, 'preview-stub.js'));
        res.writeHead(200, { 'content-type': TYPES['.js'] }).end(stub);
        return;
      }
      if (url.pathname === '/__pack.json') {
        const pack = await readFile(packFile);
        res.writeHead(200, { 'content-type': TYPES['.json'] }).end(pack);
        return;
      }
      const file = normalize(join(dist, url.pathname));
      if (!file.startsWith(dist)) throw new Error('바깥 경로');
      // 파일을 다 읽은 다음에 답을 시작한다. 읽다가 실패하면 404 를 보낼 수 있어야 한다.
      const content = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(content);
    } catch {
      if (!res.headersSent) res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('없어요. npm run build 와 npm run prompts 를 먼저 해 주세요.');
    }
  })();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`미리보기: http://localhost:${port}`);
});
