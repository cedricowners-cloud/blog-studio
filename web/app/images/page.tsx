"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { contentService } from "@/lib/content-service";

const HANDOFF_IMAGES_KEY = "blog_studio:handoff_images";

type Mode = "search" | "generate";

export default function ImagesPage() {
  const [mode, setMode] = useState<Mode>("search");
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<"pollinations" | "dalle" | "gemini">(
    "pollinations",
  );

  // /generate 에서 "→ 이미지 검색"으로 들어왔으면 키워드 자동 채움
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(HANDOFF_IMAGES_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { keyword?: string };
      if (data.keyword) setInput(data.keyword);
      sessionStorage.removeItem(HANDOFF_IMAGES_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const searchM = useMutation({
    mutationFn: (kw: string) => contentService.imageSearch(kw, 6),
  });
  const generateM = useMutation({
    mutationFn: (prompt: string) => contentService.imageGenerate(prompt, provider),
  });

  const loading = searchM.isPending || generateM.isPending;
  const error = searchM.error || generateM.error;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    if (mode === "search") searchM.mutate(input.trim());
    else generateM.mutate(input.trim());
  }

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-bold">이미지</h1>
          <p className="text-sm text-neutral-500 mt-1">
            무료 스톡(Unsplash/Pixabay) 검색 또는 AI 생성
            (Pollinations/DALL-E/Gemini).
          </p>
        </header>

        <div className="flex gap-2">
          <button
            onClick={() => setMode("search")}
            className={`px-4 py-2 rounded text-sm ${mode === "search" ? "bg-neutral-900 text-white" : "border"}`}
          >
            무료 스톡 검색
          </button>
          <button
            onClick={() => setMode("generate")}
            className={`px-4 py-2 rounded text-sm ${mode === "generate" ? "bg-neutral-900 text-white" : "border"}`}
          >
            AI 생성
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex gap-2 items-center">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === "search" ? "키워드 (예: 사무실)" : "영어 프롬프트"}
            className="flex-1 border rounded px-3 py-2"
          />
          {mode === "generate" && (
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className="border rounded px-2 py-2 text-sm"
            >
              <option value="pollinations">Pollinations (무료)</option>
              <option value="dalle">DALL-E 3 (유료)</option>
              <option value="gemini">Gemini Imagen (유료)</option>
            </select>
          )}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-brand text-white rounded px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "처리 중..." : mode === "search" ? "검색" : "생성"}
          </button>
        </form>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
            {(error as Error).message}
          </div>
        )}

        {searchM.data && (
          <section>
            <h2 className="font-semibold mb-2">검색 결과</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {searchM.data.images.map((img, i) => {
                const url = (img.thumb ?? img.url ?? "") as string;
                return (
                  <a
                    key={i}
                    href={(img.url ?? url) as string}
                    target="_blank"
                    rel="noreferrer"
                    className="block border rounded overflow-hidden bg-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-40 object-cover" />
                    <div className="p-2 text-xs text-neutral-500 truncate">
                      {(img.source ?? img.provider ?? "unknown") as string}
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {generateM.data && (
          <section className="space-y-2">
            <h2 className="font-semibold">생성 결과 ({generateM.data.provider})</h2>
            {generateM.data.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={generateM.data.url}
                alt=""
                className="w-full max-w-2xl border rounded"
              />
            )}
            {generateM.data.path && (
              <p className="text-xs text-neutral-500 font-mono">
                서버 저장 경로: {generateM.data.path}
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
