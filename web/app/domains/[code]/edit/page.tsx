"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, X } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase";
import {
  loadDomainPack,
  updateDomainData,
  EMPTY_POSITIONING,
  EMPTY_READER,
  EMPTY_LEXICON,
  EMPTY_CARD_DESIGN,
  BRAND_VOICE_AXIOM_MAP,
  type DomainPack,
  type PositioningData,
  type ReaderData,
  type LexiconData,
  type CardDesign,
  type CardMood,
  type DifferentiatingBenefit,
} from "@/lib/ontology/domain-loader";
import { CardPreview } from "@/components/card-preview";

type Tab = "positioning" | "reader" | "lexicon" | "class" | "cards";

const MOODS: CardMood[] = ["professional", "friendly", "bold", "soft"];

const BENEFITS: DifferentiatingBenefit[] = ["안전", "신속", "심층", "동반", "독창"];
const AWARENESS_LEVELS = ["L1", "L2", "L3", "L4"] as const;
const INTENTS = ["정보탐색", "자격진단", "절차해결", "문제해결", "비교선택"] as const;
const JTBDS = ["시간절약", "리스크회피", "의사결정지원", "자기효능감", "위임판단"] as const;

export default function DomainEditPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params?.code;

  const [pack, setPack] = useState<DomainPack | null>(null);
  const [domainName, setDomainName] = useState("");
  const [positioning, setPositioning] = useState<PositioningData>(EMPTY_POSITIONING);
  const [reader, setReader] = useState<ReaderData>(EMPTY_READER);
  const [lexicon, setLexicon] = useState<LexiconData>(EMPTY_LEXICON);
  const [classMd, setClassMd] = useState("");
  const [cardDesign, setCardDesign] = useState<CardDesign>(EMPTY_CARD_DESIGN);

  const [tab, setTab] = useState<Tab>("positioning");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        const sb = getBrowserSupabase();
        const p = await loadDomainPack(sb, code);
        if (cancelled) return;
        setPack(p);
        setDomainName(p.domainName);
        setPositioning(p.positioning);
        setReader(p.reader);
        setLexicon(p.lexicon);
        setClassMd(p.classMarkdown);
        setCardDesign(p.cardDesign);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function save() {
    if (!code) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const sb = getBrowserSupabase();
      await updateDomainData(sb, code, {
        domain_name: domainName,
        positioning_data: positioning,
        reader_data: reader,
        lexicon_data: lexicon,
        class_markdown: classMd,
        card_design: cardDesign,
      });
      setSaveMsg("저장됨");
    } catch (e) {
      setSaveMsg(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-5xl mx-auto text-center text-neutral-400 py-20">불러오는 중...</div>
      </main>
    );
  }

  if (error || !pack) {
    return (
      <main className="min-h-screen p-4 sm:p-6">
        <div className="max-w-5xl mx-auto space-y-3">
          <Link href="/domains" className="text-sm text-brand hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />도메인 목록</Link>
          <div className="border border-red-200 bg-red-50 rounded p-4 text-sm text-red-700">
            {error ?? "도메인을 찾을 수 없습니다"}
          </div>
        </div>
      </main>
    );
  }

  const activeBV = BRAND_VOICE_AXIOM_MAP[positioning.differentiating_benefit] ?? [];

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/domains" className="text-sm text-brand hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />도메인 목록</Link>
          <div className="flex items-center gap-3">
            {saveMsg && (
              <span className={saveMsg.startsWith("저장 실패") ? "text-xs text-red-600" : "text-xs text-green-700"}>
                {saveMsg}
              </span>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="bg-brand text-white text-sm rounded px-4 py-1.5 disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>

        {/* 헤더 */}
        <header className="bg-white border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-neutral-500">{pack.domainCode}</span>
            <input
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              className="text-xl font-bold bg-transparent border-b border-transparent hover:border-neutral-300 focus:border-brand outline-none flex-1"
            />
          </div>
        </header>

        {/* 탭 */}
        <div className="flex border-b">
          {[
            { id: "positioning" as const, label: "1. 포지셔닝" },
            { id: "reader" as const, label: "2. 독자 페르소나" },
            { id: "lexicon" as const, label: "3. 어휘집" },
            { id: "class" as const, label: "4. 도메인 클래스" },
            { id: "cards" as const, label: "5. 카드뉴스 디자인" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === t.id
                  ? "border-brand text-brand font-semibold"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 탭 내용 */}
        {tab === "positioning" && (
          <PositioningTab data={positioning} onChange={setPositioning} activeBV={activeBV} />
        )}
        {tab === "reader" && <ReaderTab data={reader} onChange={setReader} />}
        {tab === "lexicon" && <LexiconTab data={lexicon} onChange={setLexicon} />}
        {tab === "class" && <ClassTab markdown={classMd} onChange={setClassMd} />}
        {tab === "cards" && <CardsDesignTab data={cardDesign} onChange={setCardDesign} />}
      </div>
    </main>
  );
}

// ======================================================================
// 5. 카드뉴스 디자인 탭
// ======================================================================
function CardsDesignTab({ data, onChange }: { data: CardDesign; onChange: (d: CardDesign) => void }) {
  const updateColor = (key: keyof CardDesign["colors"], value: string) =>
    onChange({ ...data, colors: { ...data.colors, [key]: value } });

  // 미리보기용 샘플 카드
  const sampleCover = { type: "cover", eyebrow: "BLOG", main_title: "샘플 제목 (메인)", sub_title: "부제목 — 미리보기" };
  const sampleContent = {
    type: "content",
    section_label: "POINT 01",
    heading: "섹션 헤딩",
    lead: "이 색상으로 본문이 표시됩니다",
    body_text: "여러 카드뉴스 슬라이드 색상이 도메인별로 일관되게 적용되어, 발행 콘텐츠 톤이 통일됩니다.",
  };
  const sampleList = {
    type: "list",
    section_label: "SUMMARY",
    heading: "핵심 키워드 정리",
    items: ["키워드 1", "키워드 2", "키워드 3"],
  };
  const sampleClosing = { type: "closing", message: "마무리 메시지", cta: "블로그에서 더 보기" };

  return (
    <div className="space-y-4">
      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">기본 정보</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="브랜드명 (cover/closing 카드 표시용)">
            <input
              value={data.brand_name}
              onChange={(e) => onChange({ ...data, brand_name: e.target.value })}
              placeholder="오너스경영연구소"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </Field>
          <Field label="폰트 (CSS font-family)">
            <input
              value={data.font_family}
              onChange={(e) => onChange({ ...data, font_family: e.target.value })}
              placeholder="Pretendard"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <Field label="무드 (참고용 라벨)">
          <div className="flex gap-2 mt-1">
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ ...data, mood: m })}
                className={`px-3 py-1.5 text-sm rounded border ${
                  data.mood === m
                    ? "bg-brand text-white border-brand"
                    : "bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">색상 팔레트</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <ColorField label="primary — Cover 그라데이션 시작 / Content 헤딩" value={data.colors.primary} onChange={(v) => updateColor("primary", v)} />
          <ColorField label="primary_gradient_to — Cover 그라데이션 끝" value={data.colors.primary_gradient_to} onChange={(v) => updateColor("primary_gradient_to", v)} />
          <ColorField label="accent — List 카드 번호 마커" value={data.colors.accent} onChange={(v) => updateColor("accent", v)} />
          <ColorField label="background — Content 카드 배경" value={data.colors.background} onChange={(v) => updateColor("background", v)} />
          <ColorField label="list_background — List 카드 배경" value={data.colors.list_background} onChange={(v) => updateColor("list_background", v)} />
          <ColorField label="closing_gradient_from — Closing 그라데이션 시작" value={data.colors.closing_gradient_from} onChange={(v) => updateColor("closing_gradient_from", v)} />
          <ColorField label="closing_gradient_to — Closing 그라데이션 끝" value={data.colors.closing_gradient_to} onChange={(v) => updateColor("closing_gradient_to", v)} />
          <ColorField label="text_dark — 본문 헤딩" value={data.colors.text_dark} onChange={(v) => updateColor("text_dark", v)} />
          <ColorField label="text_muted — 본문 보조" value={data.colors.text_muted} onChange={(v) => updateColor("text_muted", v)} />
          <ColorField label="page_badge — 페이지 번호" value={data.colors.page_badge} onChange={(v) => updateColor("page_badge", v)} />
        </div>
      </section>

      <section className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-3">미리보기 (4가지 카드 타입)</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 justify-items-center">
          <CardPreview card={sampleCover} index={0} total={4} design={data} />
          <CardPreview card={sampleContent} index={1} total={4} design={data} />
          <CardPreview card={sampleList} index={2} total={4} design={data} />
          <CardPreview card={sampleClosing} index={3} total={4} design={data} />
        </div>
        <p className="text-xs text-neutral-500 mt-3">
          색상 변경 시 즉시 반영. 저장 후 /cards 페이지에서 실제 글로 카드 생성 시 자동 적용됨.
        </p>
      </section>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600 line-clamp-1" title={label}>{label}</span>
      <div className="mt-1 flex gap-2 items-center">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 h-9 border rounded cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 border rounded px-2 py-1.5 text-sm font-mono"
        />
      </div>
    </label>
  );
}

// ======================================================================
// 1. 포지셔닝 탭 (5요소 + 4C 슬롯)
// ======================================================================
function PositioningTab({
  data,
  onChange,
  activeBV,
}: {
  data: PositioningData;
  onChange: (d: PositioningData) => void;
  activeBV: string[];
}) {
  const update = (patch: Partial<PositioningData>) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-4">
      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">Positioning Statement (5요소)</h2>

        <Field label="target_audience — 글을 읽는 사람">
          <input
            value={data.target_audience}
            onChange={(e) => update({ target_audience: e.target.value })}
            placeholder="예: 정책자금·공공조달이 막막한 SME 대표 (10~50인)"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="competitive_reference — 경쟁 정보 출처">
          <input
            value={data.competitive_reference}
            onChange={(e) => update({ competitive_reference: e.target.value })}
            placeholder="예: 정부 공고 원문 / 일반 블로그 / 행정사 PR성 블로그"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="differentiating_benefit — 단어 1개 (Volvo '안전' 원칙)">
          <div className="flex gap-2 mt-1">
            {BENEFITS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => update({ differentiating_benefit: b })}
                className={`px-3 py-1.5 text-sm rounded border ${
                  data.differentiating_benefit === b
                    ? "bg-brand text-white border-brand"
                    : "bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </Field>

        <Field label="category — 블로그 카테고리 자기 정의">
          <input
            value={data.category}
            onChange={(e) => update({ category: e.target.value })}
            placeholder="예: 공공조달행정사 정보 컨설팅"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="reason_to_believe — 자격·경력·실적 (한 줄에 1개)">
          <ArrayEditor
            items={data.reason_to_believe}
            onChange={(arr) => update({ reason_to_believe: arr })}
            placeholder="예: 공공조달 컨설팅 5년+ / 누적 클라이언트 87명 / 자격: 행정사"
          />
        </Field>
      </section>

      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">4C 공리 변수 슬롯</h2>

        <Field label="value_proposition_pattern (공리 #11) — 글 첫 100자 안 등장 강제">
          <input
            value={data.value_proposition_pattern}
            onChange={(e) => update({ value_proposition_pattern: e.target.value })}
            placeholder='예: "이 글을 읽으면 {신청 자격 충족 여부}을 알 수 있습니다"'
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>

        <Field label="core_answer_type (공리 #12) — 글 첫 화면 안 핵심답 형식">
          <input
            value={data.core_answer_type}
            onChange={(e) => update({ core_answer_type: e.target.value })}
            placeholder="예: 자가진단 체크리스트 / 판단 기준 표 / 증상 매칭표"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </Field>
      </section>

      <section className="bg-brand-50 border border-brand/20 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-brand mb-2">
          자동 활성화된 Brand Voice 공리 ({data.differentiating_benefit})
        </h3>
        <ul className="text-xs text-neutral-700 space-y-1">
          {activeBV.map((bv, i) => (
            <li key={i}>• {bv}</li>
          ))}
        </ul>
        <p className="text-[11px] text-neutral-500 mt-2">
          differentiating_benefit 변경 시 자동 갱신됨. 모든 글 작성 시 이 공리들이 추가 검증됨.
        </p>
      </section>
    </div>
  );
}

// ======================================================================
// 2. 독자 페르소나 탭 (L1~L4 + 검색의도 + JTBD)
// ======================================================================
function ReaderTab({ data, onChange }: { data: ReaderData; onChange: (d: ReaderData) => void }) {
  const updateLevel = (lvl: "L1" | "L2" | "L3" | "L4", field: "pains" | "triggers", arr: string[]) => {
    onChange({ ...data, [lvl]: { ...data[lvl], [field]: arr } });
  };
  const updateIntent = (intent: string, arr: string[]) => {
    onChange({ ...data, intent_patterns: { ...data.intent_patterns, [intent]: arr } });
  };
  const updateJtbd = (jtbd: string, value: string) => {
    onChange({ ...data, jtbd_value_map: { ...data.jtbd_value_map, [jtbd]: value } });
  };

  return (
    <div className="space-y-4">
      {/* L1~L4 */}
      <section className="bg-white border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold">인지단계별 대표고민·구매동인</h2>
        {AWARENESS_LEVELS.map((lvl) => (
          <div key={lvl} className="border rounded-lg p-3 space-y-2">
            <h3 className="text-sm font-semibold text-brand">{lvl}</h3>
            <Field label="대표고민 (한 줄에 1개)">
              <ArrayEditor
                items={data[lvl].pains}
                onChange={(arr) => updateLevel(lvl, "pains", arr)}
                placeholder="이 단계 독자가 실제로 하는 말/고민"
              />
            </Field>
            <Field label="구매동인">
              <ArrayEditor
                items={data[lvl].triggers}
                onChange={(arr) => updateLevel(lvl, "triggers", arr)}
                placeholder="이 단계 진입을 결정하는 트리거"
              />
            </Field>
          </div>
        ))}
      </section>

      {/* 검색의도 */}
      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">검색의도별 키워드 패턴</h2>
        {INTENTS.map((intent) => (
          <Field key={intent} label={intent}>
            <ArrayEditor
              items={data.intent_patterns[intent] ?? []}
              onChange={(arr) => updateIntent(intent, arr)}
              placeholder={`예: 키워드1, 키워드2`}
            />
          </Field>
        ))}
      </section>

      {/* JTBD */}
      <section className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">JTBD별 가치명제</h2>
        {JTBDS.map((jtbd) => (
          <Field key={jtbd} label={jtbd}>
            <input
              value={data.jtbd_value_map[jtbd] ?? ""}
              onChange={(e) => updateJtbd(jtbd, e.target.value)}
              placeholder={`이 도메인에서 "${jtbd}" 의 구체값`}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </Field>
        ))}
      </section>
    </div>
  );
}

// ======================================================================
// 3. 어휘집 탭
// ======================================================================
function LexiconTab({ data, onChange }: { data: LexiconData; onChange: (d: LexiconData) => void }) {
  return (
    <div className="space-y-4">
      <RowListEditor
        title="전문 용어"
        items={data.terms}
        columns={[
          { key: "term", label: "용어", placeholder: "정책자금" },
          { key: "definition", label: "정의", placeholder: "정부·공공기관이 정책 목적으로 운용하는 자금" },
          { key: "plain", label: "일반인 표현", placeholder: "정부에서 빌려주거나 주는 사업자금" },
        ]}
        empty={{ term: "", definition: "", plain: "" }}
        onChange={(arr) => onChange({ ...data, terms: arr as LexiconData["terms"] })}
      />

      <RowListEditor
        title="자주 혼동되는 용어"
        items={data.confusables}
        columns={[
          { key: "a", label: "A", placeholder: "융자" },
          { key: "b", label: "B", placeholder: "보조금" },
          { key: "distinction", label: "차이", placeholder: "융자는 갚아야 하고..." },
        ]}
        empty={{ a: "", b: "", distinction: "" }}
        onChange={(arr) => onChange({ ...data, confusables: arr as LexiconData["confusables"] })}
      />

      <RowListEditor
        title="사용 금지 표현"
        items={data.forbidden}
        columns={[
          { key: "expression", label: "표현", placeholder: "100% 보장" },
          { key: "reason", label: "이유", placeholder: "단정 표현 법적 리스크" },
        ]}
        empty={{ expression: "", reason: "" }}
        onChange={(arr) => onChange({ ...data, forbidden: arr as LexiconData["forbidden"] })}
      />

      <RowListEditor
        title="권장 표현"
        items={data.recommended}
        columns={[
          { key: "situation", label: "상황", placeholder: "자격 충족 가능성 표현" },
          { key: "expression", label: "표현", placeholder: "충족 가능성이 높습니다" },
        ]}
        empty={{ situation: "", expression: "" }}
        onChange={(arr) => onChange({ ...data, recommended: arr as LexiconData["recommended"] })}
      />
    </div>
  );
}

// ======================================================================
// 4. 도메인 클래스 탭 (마크다운)
// ======================================================================
function ClassTab({ markdown, onChange }: { markdown: string; onChange: (m: string) => void }) {
  return (
    <section className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">도메인 클래스 정의 (마크다운)</h2>
        <span className="text-xs text-neutral-500">{markdown.length}자</span>
      </div>
      <p className="text-xs text-neutral-500">
        도메인의 핵심 클래스·속성·관계·제외요건을 마크다운으로 정의. LLM 글 생성 시 이 내용이 시스템 프롬프트에 포함됨.
      </p>
      <textarea
        value={markdown}
        onChange={(e) => onChange(e.target.value)}
        rows={28}
        className="w-full border rounded px-3 py-2 font-mono text-xs"
        placeholder={`## Class: <핵심개념1>\n\n├─ 속성(Property)\n│  └─ ...\n\n## Class: <핵심개념2>\n...\n\n## Relation: <도메인명> 관계 그래프\n- ...`}
      />
    </section>
  );
}

// ======================================================================
// Helper components
// ======================================================================
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ArrayEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (arr: string[]) => void;
  placeholder?: string;
}) {
  // 입력 중에는 raw text 그대로 유지(엔터·공백 자유) → blur 시점에만 split·trim·filter
  const [text, setText] = useState<string>(() => items.join("\n"));
  const lastCommittedKey = useRef<string>(items.join("\n"));

  // 외부에서 items 가 바뀌면 (다른 탭/도메인 로드 등) 텍스트 동기화
  useEffect(() => {
    const next = items.join("\n");
    if (next !== lastCommittedKey.current) {
      setText(next);
      lastCommittedKey.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function commit(raw: string) {
    const arr = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    const key = arr.join("\n");
    if (key !== lastCommittedKey.current) {
      onChange(arr);
      lastCommittedKey.current = key;
    }
  }

  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      rows={Math.max(3, Math.min(10, text.split("\n").length + 1))}
      placeholder={placeholder}
      className="w-full border rounded px-3 py-2 text-sm"
    />
  );
}

interface RowListEditorProps<T extends Record<string, string>> {
  title: string;
  items: T[];
  columns: Array<{ key: keyof T & string; label: string; placeholder?: string }>;
  empty: T;
  onChange: (arr: T[]) => void;
}

function RowListEditor<T extends Record<string, string>>({
  title,
  items,
  columns,
  empty,
  onChange,
}: RowListEditorProps<T>) {
  function update(idx: number, key: keyof T & string, value: string) {
    const next = [...items];
    next[idx] = { ...next[idx], [key]: value };
    onChange(next);
  }
  function add() {
    onChange([...items, { ...empty }]);
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <section className="bg-white border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {title} <span className="text-neutral-400 text-xs">({items.length})</span>
        </h2>
        <button onClick={add} type="button" className="text-xs border rounded px-2 py-1 hover:bg-neutral-50">
          + 추가
        </button>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[500px]">
        <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1.5">{c.label}</th>
            ))}
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i} className="border-t align-top">
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-1.5">
                  <input
                    value={row[c.key] ?? ""}
                    onChange={(e) => update(i, c.key, e.target.value)}
                    placeholder={c.placeholder}
                    className="w-full border rounded px-2 py-1 text-xs"
                  />
                </td>
              ))}
              <td className="px-2 py-1.5 text-center">
                <button onClick={() => remove(i)} type="button" className="text-red-500 hover:text-red-700 inline-flex items-center justify-center" aria-label="삭제">
                  <X className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="text-center text-neutral-400 py-3 text-xs">
                항목이 없습니다. + 추가
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </section>
  );
}
