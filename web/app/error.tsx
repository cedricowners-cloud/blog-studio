"use client";

/**
 * 라우트 에러 바운더리 — 페이지 렌더 중 throw된 에러 캐치.
 * 같은 폴더 (app/) 의 layout.tsx 안에서 동작.
 */
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 운영 환경에서는 에러 추적 시스템에 보내기
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="min-h-screen p-4 sm:p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-white border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2 text-red-600">
          <AlertTriangle className="w-5 h-5" />
          <h2 className="text-lg font-bold">문제가 발생했습니다</h2>
        </div>
        <p className="text-sm text-neutral-700">
          {error.message || "알 수 없는 오류가 발생했어요."}
        </p>
        {error.digest && (
          <p className="text-[11px] text-neutral-400 font-mono">에러 ID: {error.digest}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="bg-neutral-900 text-white text-sm rounded px-4 py-2 hover:bg-neutral-800 inline-flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4" />
            다시 시도
          </button>
          <a
            href="/"
            className="border border-neutral-300 text-sm rounded px-4 py-2 hover:bg-neutral-50"
          >
            홈으로
          </a>
        </div>
      </div>
    </main>
  );
}
