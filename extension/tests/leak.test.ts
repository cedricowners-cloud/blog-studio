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
  for (const value of Object.values(pack.seo.auto_replies)) for (const line of distinctiveLines(value, 12)) needles.add(line);
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

test('패키지의 접근 허용 주소는 네이버 블로그, AI 3사, 내 서버, 내 웹뿐이다', { skip }, () => {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf-8')) as { host_permissions?: string[]; permissions?: string[] };
  const hosts = [...(manifest.host_permissions ?? [])];
  // .env 에 적은 서버(Supabase) 주소와 blog_studio 웹 주소만 더 들어갈 수 있다. 각각 주소 하나뿐이다.
  const envFile = join(here, '..', '.env');
  const envText = existsSync(envFile) ? readFileSync(envFile, 'utf-8') : '';
  const fromEnv = (name: string) => {
    const value = new RegExp(`^${name}=(.+)$`, 'm').exec(envText)?.[1]?.trim().replace(/\/+$/, '');
    return value ? `${value}/*` : null;
  };
  const server = [fromEnv('WXT_SUPABASE_URL'), fromEnv('WXT_WEB_URL')].filter((host): host is string => host !== null);
  for (const host of server) assert.match(host, /^https:\/\/[a-z0-9.-]+\/\*$/, '주소 하나만 가리켜야 해요 (별표로 여러 사이트를 열면 안 돼요)');
  assert.deepEqual(hosts.filter((host) => !server.includes(host)).sort(), [
    'https://api.anthropic.com/*',
    'https://api.openai.com/*',
    'https://blog.naver.com/*',
    'https://generativelanguage.googleapis.com/*',
  ]);
  assert.ok(!(manifest.permissions ?? []).includes('<all_urls>'));
});

test('패키지에 관리용 키가 들어 있지 않다', { skip }, () => {
  // 공개용 키만 들어가야 한다. 관리용 키(service_role)는 권한 규칙을 건너뛰므로 절대 넣지 않는다.
  for (const file of filesUnder(dist).filter((name) => /\.(js|html|json)$/.test(name))) {
    const text = readFileSync(file, 'utf-8');
    assert.ok(!text.includes('service_role'), `${file} 에 service_role 이 들어 있어요`);
    for (const token of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g) ?? []) {
      const payload = Buffer.from((token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
      assert.ok(!payload.includes('service_role'), `${file} 에 관리용 키가 들어 있어요`);
    }
  }
});
