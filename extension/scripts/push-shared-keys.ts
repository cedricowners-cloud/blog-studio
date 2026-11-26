// 가족이 함께 쓰는 네이버 API 키를 서버(Supabase)에 올린다. 확장은 로그인하면 이 키를 받아 간다.
//   npm run keys:push
//
// 올리는 값은 web/.env.local 의 NAVER_* 다섯 줄이다:
//   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET                      (검색 API)
//   NAVER_SEARCH_ACCESS_LICENSE_KEY, NAVER_SEARCH_SECRET_KEY, NAVER_SEARCH_CUSTOMER_ID   (검색광고 API)
// 서버 주소와 관리용 키도 같은 파일에서 읽는다 (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// 키 값은 화면에 찍지 않는다. 서버로 보내는 요청에만 싣는다.
// 올린 키는 prompt_access 표에 있는 사람만 받을 수 있다 (supabase/migrations/018_shared_keys.sql).
// 알아 둘 점: 검색광고 API 의 키는 그 광고 계정을 다루는 데도 쓸 수 있다. 받을 사람을 가족으로만 둔다.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EMPTY_NAVER_KEYS, hasAdKeys, hasSearchKeys, parseKeyLines } from '../lib/naver/api.ts';
import { REPO_ROOT } from './build-prompt-pack.ts';

async function main(): Promise<void> {
  const envPath = join(REPO_ROOT, 'web', '.env.local');
  const text = await readFile(envPath, 'utf-8').catch(() => '');
  const value = (name: string): string => {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, 'm').exec(text);
    return (match?.[1] ?? '').replace(/^["']|["']$/g, '');
  };
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? value('NEXT_PUBLIC_SUPABASE_URL')).replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? value('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new Error('서버 주소나 관리용 키를 찾지 못했어요. web/.env.local 에 NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 있는지 확인해 주세요.');
  }

  const keys = { ...EMPTY_NAVER_KEYS, ...parseKeyLines(text) };
  if (!hasSearchKeys(keys) && !hasAdKeys(keys)) {
    throw new Error('web/.env.local 에서 네이버 키를 찾지 못했어요. NAVER_CLIENT_ID 같은 줄이 있는지 확인해 주세요.');
  }

  const row = { id: 'naver', keys, updated_at: new Date().toISOString() };
  const res = await fetch(`${url}/rest/v1/shared_keys?on_conflict=id`, {
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
    // 서버의 답에 키가 섞여 있을 수 있다. 가리고 보여 준다.
    let detail = (await res.text()).slice(0, 300);
    for (const secret of [serviceKey, ...Object.values(keys)]) if (secret.length >= 6) detail = detail.split(secret).join('(가림)');
    if (res.status === 404) throw new Error('서버에 shared_keys 표가 없어요. supabase/migrations/018_shared_keys.sql 을 먼저 적용해 주세요. ' + detail);
    throw new Error(`올리지 못했어요 (${res.status}). ${detail}`);
  }
  console.log(`가족이 함께 쓰는 네이버 키를 서버에 올렸어요 (${new URL(url).host}).`);
  console.log(`검색 API 키: ${hasSearchKeys(keys) ? '올림' : '없음'} · 검색광고 API 키: ${hasAdKeys(keys) ? '올림' : '없음'}`);
  console.log('확장에서는 로그인하거나 설정 탭의 [서버의 공용 키 받기]를 누르면 받아 와요.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
