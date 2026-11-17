// 프롬프트 묶음을 만들어 서버(Supabase)에 올린다. 확장은 로그인하면 이 묶음을 받아 간다.
//   npm run prompts:push
//
// 서버 주소와 관리용 키는 web/.env.local 에서 읽는다 (웹이 쓰는 것과 같은 값).
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 관리용 키는 화면에 찍지 않고, 서버로 보내는 요청의 헤더에만 넣는다.
// 올린 묶음은 prompt_access 표에 있는 사람만 받을 수 있다 (supabase/migrations/017_prompt_packs.sql).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPack, REPO_ROOT } from './build-prompt-pack.ts';

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1] as string] = (match[2] ?? '').replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main(): Promise<void> {
  const fileEnv = await readEnvFile(join(REPO_ROOT, 'web', '.env.local'));
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !serviceKey) {
    throw new Error('서버 주소나 관리용 키를 찾지 못했어요. web/.env.local 에 NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 있는지 확인해 주세요.');
  }

  const pack = await buildPack();
  const row = { id: 'default', format: pack.format, pack, updated_at: new Date().toISOString() };
  const res = await fetch(`${url}/rest/v1/prompt_packs?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    const detail = (await res.text()).split(serviceKey).join('(가림)').slice(0, 300);
    if (res.status === 404) throw new Error('서버에 prompt_packs 표가 없어요. supabase/migrations/017_prompt_packs.sql 을 먼저 적용해 주세요. ' + detail);
    throw new Error(`올리지 못했어요 (${res.status}). ${detail}`);
  }
  console.log(`프롬프트 묶음을 서버에 올렸어요 (${new URL(url).host}).`);
  console.log(`글쓰기 방식 ${pack.methods.items.length}개 · SEO ${pack.seo.steps.length}단계 · 형식 ${pack.format} · ${Math.round(JSON.stringify(pack).length / 1024)}KB`);
  console.log('확장에서는 설정 탭의 [프롬프트 새로 받기]를 누르거나, 창을 다시 열면 받아 와요.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
