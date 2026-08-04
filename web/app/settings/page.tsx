"use client";

import { useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";
import {
  loadUserApiKeys,
  saveUserApiKeys,
  type UserApiKeysPatch,
} from "@/lib/user-api-keys";

interface ModelOption {
  value: string; // "" = 기본값 사용
  label: string;
  desc?: string;
}

interface FieldDef {
  key: keyof UserApiKeysPatch;
  label: string;
  hint?: string;
  type?: "password" | "text";
  options?: ModelOption[]; // 있으면 select 로 렌더
}

// 사용 가능한 모델 — 오타 방지용 화이트리스트.
// 새 모델이 나오면 여기에 추가하면 됨.
const OPENAI_MODELS: ModelOption[] = [
  { value: "", label: "(기본값 사용)" },
  { value: "gpt-4.1", label: "gpt-4.1", desc: "강력·고가" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini", desc: "빠름·저렴" },
  { value: "gpt-4o", label: "gpt-4o", desc: "균형형" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini", desc: "최저가" },
];

const ANTHROPIC_MODELS: ModelOption[] = [
  { value: "", label: "(기본값 사용)" },
  { value: "claude-opus-4-5", label: "claude-opus-4-5", desc: "최강·고가" },
  { value: "claude-sonnet-4-5-20250929", label: "claude-sonnet-4-5", desc: "균형형 (기본)" },
  { value: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5", desc: "빠름·저렴" },
  { value: "claude-3-5-sonnet-20241022", label: "claude-3-5-sonnet (구버전)", desc: "안정형" },
];

const GEMINI_MODELS: ModelOption[] = [
  { value: "", label: "(기본값 사용)" },
  { value: "gemini-2.5-pro", label: "gemini-2.5-pro", desc: "강력 (기본)" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash", desc: "빠름" },
  { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite", desc: "저렴" },
  { value: "gemini-2.0-flash", label: "gemini-2.0-flash", desc: "구버전" },
];

const LLM_FIELDS: FieldDef[] = [
  { key: "openai_api_key", label: "OpenAI API Key", hint: "sk-... (platform.openai.com)", type: "password" },
  { key: "anthropic_api_key", label: "Anthropic API Key", hint: "sk-ant-... (console.anthropic.com)", type: "password" },
  { key: "gemini_api_key", label: "Gemini API Key", hint: "AI... (aistudio.google.com)", type: "password" },
];

const MODEL_FIELDS: FieldDef[] = [
  { key: "openai_default_model", label: "OpenAI 기본 모델", options: OPENAI_MODELS },
  { key: "anthropic_default_model", label: "Anthropic 기본 모델", options: ANTHROPIC_MODELS },
  { key: "gemini_default_model", label: "Gemini 기본 모델", options: GEMINI_MODELS },
];

const NAVER_FIELDS: FieldDef[] = [
  { key: "naver_client_id", label: "Naver Open API Client ID", hint: "developers.naver.com (블로그 검색)" },
  { key: "naver_client_secret", label: "Naver Open API Client Secret", type: "password" },
  { key: "naver_search_access_license_key", label: "Naver 검색광고 Access License", hint: "searchad.naver.com" },
  { key: "naver_search_secret_key", label: "Naver 검색광고 Secret Key", type: "password" },
  { key: "naver_search_customer_id", label: "Naver 검색광고 Customer ID" },
];

const IMAGE_FIELDS: FieldDef[] = [
  { key: "unsplash_access_key", label: "Unsplash Access Key", hint: "unsplash.com/developers", type: "password" },
  { key: "pixabay_api_key", label: "Pixabay API Key", hint: "pixabay.com/api/docs", type: "password" },
];

const ALL_FIELDS = [...LLM_FIELDS, ...MODEL_FIELDS, ...NAVER_FIELDS, ...IMAGE_FIELDS];

type FormState = Record<string, string>;

export default function SettingsPage() {
  const [form, setForm] = useState<FormState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const { data: userRes } = await sb.auth.getUser();
        if (!userRes.user) {
          setAuthError("로그인이 필요합니다.");
          setLoading(false);
          return;
        }
        const row = await loadUserApiKeys(sb, userRes.user.id);
        const next: FormState = {};
        for (const f of ALL_FIELDS) {
          next[f.key as string] = (row?.[f.key as keyof typeof row] as string | null | undefined) ?? "";
        }
        setForm(next);
      } catch (e) {
        setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const sb = getBrowserSupabase();
      const { data: userRes } = await sb.auth.getUser();
      if (!userRes.user) throw new Error("로그인이 필요합니다.");
      const patch: UserApiKeysPatch = {};
      for (const f of ALL_FIELDS) {
        (patch as Record<string, string | null>)[f.key as string] = form[f.key as string] ?? "";
      }
      await saveUserApiKeys(sb, userRes.user.id, patch);
      setMessage({ kind: "ok", text: "저장 완료" });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (authError) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">{authError}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <header>
          <h1 className="text-2xl font-bold">설정 — API 키</h1>
          <p className="text-xs text-neutral-500 mt-1">
            여기 입력한 키는 본인 계정에만 저장됩니다 (RLS). 미입력 시 서버 환경변수로 폴백.
            <br />
            구독료를 내고 있는 ChatGPT/Claude/Gemini 와 별개로, API 호출은{" "}
            <span className="font-medium">유료 종량제</span>입니다. 비용을 피하고 싶다면 글 생성 화면의{" "}
            <span className="font-medium">&ldquo;프롬프트 복사&rdquo;</span> 버튼으로 웹 UI에 붙여넣기를 추천.
          </p>
        </header>

        {loading ? (
          <div className="text-sm text-neutral-400">불러오는 중...</div>
        ) : (
          <form onSubmit={onSave} className="space-y-6">
            <Section title="LLM API 키" description="글 생성에 사용. 셋 중 하나만 있어도 됨.">
              {LLM_FIELDS.map((f) => (
                <Field key={f.key as string} def={f} value={form[f.key as string] ?? ""} onChange={update} />
              ))}
            </Section>

            <Section title="기본 모델 (선택)" description="비우면 시스템 기본값 사용.">
              {MODEL_FIELDS.map((f) => (
                <Field key={f.key as string} def={f} value={form[f.key as string] ?? ""} onChange={update} />
              ))}
            </Section>

            <Section title="Naver API 키" description="키워드 조회·블로그 검색에 사용.">
              {NAVER_FIELDS.map((f) => (
                <Field key={f.key as string} def={f} value={form[f.key as string] ?? ""} onChange={update} />
              ))}
            </Section>

            <Section title="이미지 API 키" description="무료 이미지 검색.">
              {IMAGE_FIELDS.map((f) => (
                <Field key={f.key as string} def={f} value={form[f.key as string] ?? ""} onChange={update} />
              ))}
            </Section>

            {message && (
              <div
                className={`rounded p-3 text-sm ${
                  message.kind === "ok" ? "border border-green-200 bg-green-50 text-green-700" : "border border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {message.text}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-neutral-900 text-white text-sm rounded px-4 py-2 disabled:opacity-40"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <header>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-neutral-500 mt-0.5">{description}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (key: string, v: string) => void;
}) {
  // select 모드 — 모델처럼 화이트리스트가 있는 필드
  if (def.options) {
    const inList = def.options.some((o) => o.value === value);
    const opts = inList
      ? def.options
      : [...def.options, { value, label: `(저장된 값) ${value}`, desc: "목록에 없음" }];
    return (
      <label className="block">
        <span className="text-xs text-neutral-600">{def.label}</span>
        <select
          value={value}
          onChange={(e) => onChange(def.key as string, e.target.value)}
          className="mt-1 w-full border rounded px-3 py-2 text-sm font-mono bg-white"
        >
          {opts.map((o) => (
            <option key={o.value || "__default"} value={o.value}>
              {o.label}
              {o.desc ? ` — ${o.desc}` : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // text/password 모드
  return (
    <label className="block">
      <span className="text-xs text-neutral-600">{def.label}</span>
      <input
        type={def.type === "password" ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(def.key as string, e.target.value)}
        autoComplete="off"
        className="mt-1 w-full border rounded px-3 py-2 text-sm font-mono"
        placeholder={def.hint ?? ""}
      />
      {def.hint && <span className="text-[11px] text-neutral-400">{def.hint}</span>}
    </label>
  );
}
