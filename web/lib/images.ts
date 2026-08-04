/**
 * 이미지 검색·생성 헬퍼.
 * - 검색: Unsplash 우선, Pixabay 보조 (병합)
 * - 생성: Pollinations(무료) / DALL-E / Gemini Imagen
 *
 * Vercel/serverless 환경에 맞춰 디스크 저장 없이 URL 반환만 지원.
 */

export interface ImageSearchResult {
  url: string;
  thumb: string;
  alt: string;
  credit: string;
  source: "Unsplash" | "Pixabay";
  link: string;
}

interface UnsplashItem {
  urls: { regular: string; thumb: string };
  alt_description: string | null;
  user: { name: string };
  links: { html: string };
}

interface PixabayItem {
  largeImageURL: string;
  previewURL: string;
  tags: string;
  user: string;
  pageURL: string;
}

export async function searchUnsplash(keyword: string, count = 3): Promise<ImageSearchResult[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=${count}&orientation=landscape`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: UnsplashItem[] };
  return (data.results ?? []).map((it) => ({
    url: it.urls.regular,
    thumb: it.urls.thumb,
    alt: it.alt_description ?? keyword,
    credit: it.user.name,
    source: "Unsplash" as const,
    link: it.links.html,
  }));
}

export async function searchPixabay(keyword: string, count = 3): Promise<ImageSearchResult[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({
    key,
    q: keyword,
    per_page: String(count),
    image_type: "photo",
    orientation: "horizontal",
    lang: "ko",
  });
  const res = await fetch(`https://pixabay.com/api/?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { hits?: PixabayItem[] };
  return (data.hits ?? []).map((it) => ({
    url: it.largeImageURL,
    thumb: it.previewURL,
    alt: it.tags || keyword,
    credit: it.user,
    source: "Pixabay" as const,
    link: it.pageURL,
  }));
}

export async function searchImages(keyword: string, count = 3): Promise<ImageSearchResult[]> {
  const unsplash = await searchUnsplash(keyword, count);
  if (unsplash.length >= count) return unsplash.slice(0, count);

  const remaining = count - unsplash.length;
  const pixabay = await searchPixabay(keyword, remaining);
  return [...unsplash, ...pixabay].slice(0, count);
}

export type ImageProvider = "pollinations" | "dalle" | "gemini";

export interface GeneratedImage {
  url: string;
  provider: ImageProvider;
}

/**
 * Pollinations.ai — API 키 불필요. URL 자체가 이미지를 생성하므로 그대로 반환.
 */
export function generateImagePollinations(prompt: string, width = 1024, height = 768): GeneratedImage {
  const trimmed = prompt.length > 300 ? prompt.slice(0, 300) : prompt;
  const seed = Math.floor(Math.random() * 1_000_000) + 1;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(trimmed)}?width=${width}&height=${height}&seed=${seed}`;
  return { url, provider: "pollinations" };
}

/**
 * OpenAI DALL-E 3 — 결과 URL 직접 반환 (다운로드/업로드 안 함).
 */
export async function generateImageDalle(prompt: string, size: "1024x1024" | "1024x1792" | "1792x1024" = "1792x1024"): Promise<GeneratedImage | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      size,
      quality: "standard",
      n: 1,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DALL-E API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { data: Array<{ url: string }> };
  const url = data.data?.[0]?.url;
  return url ? { url, provider: "dalle" } : null;
}

/**
 * Google Gemini Imagen — base64 응답을 data URL로 반환.
 * 모델은 imagen-3.0-generate-001 사용.
 */
export async function generateImageGemini(prompt: string, model = "imagen-3.0-generate-001"): Promise<GeneratedImage | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini Imagen API 에러 ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> };
  const pred = data.predictions?.[0];
  if (!pred?.bytesBase64Encoded) return null;

  const mime = pred.mimeType || "image/png";
  return { url: `data:${mime};base64,${pred.bytesBase64Encoded}`, provider: "gemini" };
}

export async function generateImage(prompt: string, provider: ImageProvider): Promise<GeneratedImage | null> {
  switch (provider) {
    case "pollinations":
      return generateImagePollinations(prompt);
    case "dalle":
      return generateImageDalle(prompt);
    case "gemini":
      return generateImageGemini(prompt);
    default:
      throw new Error(`알 수 없는 provider: ${provider}`);
  }
}
