// 확장 패키지(dist)에 프롬프트 글이 들어가지 않았는지 확인한다. 먼저 npm run build 가 필요하다.
// 프롬프트는 묶음 파일로만 주고받는다. 패키지는 설치한 사람 누구나 열어 볼 수 있기 때문이다.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPack } from '../scripts/build-prompt-pack.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'chrome-mv3');
const skip = existsSync(dist) ? false : 'dist 가 없어요. npm run build 를 먼저 해 주세요';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

/** 프롬프트에서 눈에 띄는 줄을 고른다. 짧은 줄은 다른 글과 우연히 겹칠 수 있어서 뺀다. */
function distinctiveLines(text: string, minLength: number): string[] {
  return text
    .split(/\n|\{\{\w+\}\}/)
    .map((line) => line.trim())
    .filter((line) => line.length >= minLength && /[가-힣]/.test(line));
}

test('패키지에 프롬프트 글이 들어 있지 않다', { skip }, async () => {
  const pack = await buildPack();
  const needles = new Set<string>();
  for (const line of distinctiveLines(pack.methods.common, 20)) needles.add(line);
  for (const method of pack.methods.items) for (const line of distinctiveLines(method.prompt, 20)) needles.add(line);
  for (const step of pack.seo.steps) for (const line of distinctiveLines(step.prompt, 20)) needles.add(line);
  for (const value of Object.values(pack.glue)) for (const line of distinctiveLines(value, 12)) needles.add(line);
  assert.ok(needles.size > 200, `견줄 줄이 너무 적어요 (${needles.size}개)`);

  const texts = filesUnder(dist)
    .filter((file) => /\.(js|html|css|json)$/.test(file))
    .map((file) => ({ file, text: readFileSync(file, 'utf-8') }));
  assert.ok(texts.length >= 4, '패키지의 파일을 찾지 못했어요');

  const found: string[] = [];
  for (const { file, text } of texts) {
    for (const needle of needles) {
      if (text.includes(needle)) found.push(`${file.slice(dist.length + 1)}: ${needle}`);
    }
  }
  assert.deepEqual(found, [], '패키지에 프롬프트 글이 들어 있어요');
});

test('패키지의 접근 허용 주소는 네이버 블로그와 AI 3사뿐이다', { skip }, () => {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf-8')) as { host_permissions?: string[]; permissions?: string[] };
  assert.deepEqual([...(manifest.host_permissions ?? [])].sort(), [
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
    'https://blog.naver.com/*',
    'https://generativelanguage.googleapis.com/*',
  ]);
  assert.ok(!(manifest.permissions ?? []).includes('<all_urls>'));
});
