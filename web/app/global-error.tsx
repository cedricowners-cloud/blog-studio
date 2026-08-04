"use client";

/**
 * 최후의 에러 바운더리 — RootLayout 자체가 깨졌을 때만 발동.
 * 자체 <html>·<body> 를 포함해야 함 (Next.js 요구사항).
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          padding: 24,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, system-ui, 'Helvetica Neue', sans-serif",
          backgroundColor: "#fafafa",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            backgroundColor: "white",
            border: "1px solid #e5e5e5",
            borderRadius: 8,
            padding: 24,
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#dc2626",
              marginTop: 0,
              marginBottom: 12,
            }}
          >
            치명적 오류
          </h2>
          <p style={{ fontSize: 14, color: "#404040", marginBottom: 16 }}>
            {error.message || "앱을 불러올 수 없습니다."}
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 11,
                color: "#a3a3a3",
                fontFamily: "monospace",
                marginBottom: 16,
              }}
            >
              에러 ID: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              backgroundColor: "#171717",
              color: "white",
              fontSize: 14,
              border: 0,
              borderRadius: 6,
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
