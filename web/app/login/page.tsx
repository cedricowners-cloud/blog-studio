"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // /auth/callback 이 실패 사유를 error 파라미터로 넘겨준다.
  const [error, setError] = useState<string | null>(params.get("error"));
  const [info, setInfo] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const sb = getBrowserSupabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(redirect);
    router.refresh();
  }

  async function sendMagicLink() {
    setLoading(true);
    setError(null);
    setInfo(null);
    const sb = getBrowserSupabase();
    // PKCE 플로우라 ?code= 를 /auth/callback 에서 세션으로 교환해야 한다.
    // 루트로 바로 돌려보내면 미들웨어가 /login 으로 리다이렉트하면서 code를 버린다.
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(redirect)}`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setInfo(`${email} 로 로그인 링크를 보냈습니다. 메일함을 확인해주세요.`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        onSubmit={signIn}
        className="w-full max-w-sm space-y-4 border rounded-lg p-6 bg-white"
      >
        <h1 className="text-2xl font-bold">로그인</h1>
        <div>
          <label className="text-sm font-medium">이메일</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="text-sm font-medium">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-green-700">{info}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand text-white rounded py-2 font-medium disabled:opacity-60"
        >
          {loading ? "처리 중..." : "이메일 로그인"}
        </button>
        <button
          type="button"
          onClick={sendMagicLink}
          disabled={loading || !email}
          className="w-full border rounded py-2 text-sm"
        >
          매직 링크 받기 (비밀번호 없이)
        </button>
      </form>
    </main>
  );
}

// useSearchParams()는 prerender를 중단시키므로 Suspense 경계가 필요하다.
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center p-8">
          <p className="text-sm text-gray-500">불러오는 중...</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
