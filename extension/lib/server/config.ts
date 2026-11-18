// 서버 주소와 공개용 키. 빌드할 때 extension/.env 에서 읽는다 (.env.example 참고).
// 둘 다 공개돼도 되는 값이다. 그래도 저장소에는 올리지 않고, 웹과 마찬가지로 환경 파일에 둔다.
import type { ServerConfig } from './client.ts';

const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SERVER: ServerConfig = {
  url: (env.WXT_SUPABASE_URL ?? '').replace(/\/+$/, ''),
  key: env.WXT_SUPABASE_ANON_KEY ?? '',
};

export const serverConfigured = (): boolean => !!SERVER.url && !!SERVER.key;

/**
 * blog_studio 웹의 주소. 메일의 로그인 링크를 누르면 서버가 이 주소로 보낸다.
 * 확장은 그 탭의 주소에서 로그인 정보를 받아 간다. 비어 있으면 링크를 눌러서 로그인하는 기능이 꺼진다.
 */
export const WEB_URL: string = (env.WXT_WEB_URL ?? '').replace(/\/+$/, '');
