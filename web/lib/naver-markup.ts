/**
 * 생성된 본문 → 네이버 SmartEditor 마크업 변환/검증.
 *
 * 로컬 에이전트의 `local_agent/lib/naver_editor.py` 가 해석하는 마크업과
 * 온톨로지 파이프라인이 만들어내는 본문이 일치하지 않는다. 어긋나는 토큰은
 * 에디터에서 **글자 그대로 타이핑**되므로 발행 전에 바로잡고, 무엇이
 * 바뀌는지 호출자에게 알려준다.
 *
 * 실제 DB 7개 글에서 확인된 불일치:
 *  - `[IMG: 썸네일 - ...]` 41건 — 이미지 "설명" 플레이스홀더.
 *    에디터는 `[img]/로컬/경로.jpg[/img]` 형태의 실제 파일 경로만 받는다.
 *  - 닫히지 않은 `[h2]` 5건 — 여는 태그 30개 vs 닫는 태그 25개.
 *  - 글마다 포맷이 다름 — 어떤 글은 `[h2]`, 어떤 글은 마크다운(`## `, `**`).
 *  - 마크다운 표(`| a | b |`) — 에디터에 표 마크업이 없어 그대로 남는다.
 */

/** naver_editor.py 독스트링의 마크업 문법과 1:1 대응. */
const PAIRED_TAGS = [
  "h2",
  "h3",
  "bold",
  "italic",
  "underline",
  "quote",
  "quote2",
  "quote3",
  "center",
  "right",
  "img",
] as const;

const VOID_TAGS = ["hr", "hr2", "hr3"] as const;

/** `[IMG: 설명]` — 대문자 IMG + 콜론이 플레이스홀더의 식별 표지. */
const IMAGE_PLACEHOLDER_RE = /\[IMG:\s*([^\]]*)\]/g;

export interface NaverMarkupResult {
  /** 에이전트에 보낼 본문. */
  markup: string;
  /** 사용자에게 보여줄 경고 — 발행하면 달라지는 점. */
  warnings: string[];
  /** 제거된 이미지 플레이스홀더 설명 목록. */
  removedImagePlaceholders: string[];
  /** 마크다운 → 마크업으로 바꾼 줄 수. 0이면 이미 마크업 포맷이었다. */
  convertedMarkdownLines: number;
  /** 변환 후 전체 글자수. */
  charCount: number;
}

/**
 * 마크다운 블록 요소를 에디터 마크업으로 변환.
 *
 * 반환값이 null 이면 이 줄은 마크다운 블록이 아니다.
 */
function convertMarkdownBlock(line: string): string | null {
  const heading = /^(#{2,6})\s+(.*)$/.exec(line);
  if (heading) {
    // 에디터는 h2/h3 두 단계만 지원한다. h4+ 는 h3 로 접는다.
    const tag = heading[1].length === 2 ? "h2" : "h3";
    return `[${tag}]${heading[2].trim()}[/${tag}]`;
  }

  // 수평선: --- / *** / ___ (3개 이상)
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return "[hr]";

  return null;
}

/** 마크다운 인라인 서식을 에디터 인라인 태그로 변환. */
function convertMarkdownInline(line: string): string {
  return (
    line
      // **굵게** → [bold] (별 2개를 먼저 처리해야 *기울임*과 안 겹친다)
      .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, "[bold]$1[/bold]")
      // __밑줄__
      .replace(/__(?!\s)([^_]+?)(?<!\s)__/g, "[underline]$1[/underline]")
      // *기울임* — 목록 기호(`* item`)와 구분하려고 양쪽 공백을 금지한다.
      .replace(/(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, "[italic]$1[/italic]")
  );
}

/**
 * 여는 태그만 있고 닫는 태그가 없는 줄을 줄 끝에서 닫아준다.
 *
 * naver_editor 의 h2/quote 처리는 `[h2]...[/h2]` 가 한 줄 안에서 완결된다고
 * 가정하는 정규식이라, 닫는 태그가 없으면 서식이 안 걸리고 태그 문자열이
 * 그대로 본문에 남는다.
 */
function closeDanglingTags(
  line: string,
  warnings: string[],
  lineNo: number,
): string {
  let out = line;
  for (const tag of PAIRED_TAGS) {
    const opens = (out.match(new RegExp(`\\[${tag}\\]`, "g")) || []).length;
    const closes = (out.match(new RegExp(`\\[/${tag}\\]`, "g")) || []).length;
    if (opens > closes) {
      out = out + `[/${tag}]`.repeat(opens - closes);
      warnings.push(
        `${lineNo}번째 줄: 닫히지 않은 [${tag}] 태그를 줄 끝에서 닫았습니다.`,
      );
    } else if (closes > opens) {
      // 여는 태그 없이 닫는 태그만 있으면 서식이 안 걸리고 글자로 남는다.
      out = out.replace(new RegExp(`\\[/${tag}\\]`, "g"), "");
      warnings.push(`${lineNo}번째 줄: 짝 없는 [/${tag}] 태그를 제거했습니다.`);
    }
  }
  return out;
}

/** 에디터가 모르는 `[...]` 토큰을 찾아 경고. 제거하지는 않는다. */
function warnUnknownTags(
  line: string,
  warnings: string[],
  seen: Set<string>,
): void {
  const known = new Set<string>([
    ...PAIRED_TAGS,
    ...PAIRED_TAGS.map((t) => `/${t}`),
    ...VOID_TAGS,
  ]);
  for (const m of line.matchAll(/\[(\/?[^\]\s:]{1,20})\]/g)) {
    const tag = m[1];
    if (known.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    warnings.push(
      `에디터가 모르는 [${tag}] 태그 — 본문에 글자 그대로 들어갑니다.`,
    );
  }
}

/**
 * 본문을 에이전트가 해석 가능한 마크업으로 정규화한다.
 *
 * 이미지 플레이스홀더는 **제거**한다. 에디터는 로컬 파일 경로를 요구하는데
 * 웹에서 고른 이미지는 URL뿐이어서, 에이전트 PC로 내려받는 단계가 아직
 * 없다. 남겨두면 `[IMG: 썸네일 - ...]` 가 글에 그대로 박힌다.
 */
export function toNaverMarkup(body: string): NaverMarkupResult {
  const warnings: string[] = [];
  const removedImagePlaceholders: string[] = [];

  // 1) 이미지 플레이스홀더 수거 후 제거
  let work = body.replace(IMAGE_PLACEHOLDER_RE, (_m, desc: string) => {
    removedImagePlaceholders.push(desc.trim());
    return "";
  });
  if (removedImagePlaceholders.length > 0) {
    warnings.push(
      `이미지 자리 ${removedImagePlaceholders.length}개가 제거됩니다 — ` +
        `발행 후 네이버 에디터에서 직접 넣어야 합니다.`,
    );
  }

  // 2) 줄 단위 변환
  const unknownSeen = new Set<string>();
  let convertedMarkdownLines = 0;
  let sawMarkdownTable = false;

  const lines = work.split("\n").map((raw, i) => {
    const lineNo = i + 1;
    let line = raw;

    // 마크다운 표는 에디터에 대응 문법이 없다. 그대로 두고 한 번만 경고.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!sawMarkdownTable) {
        sawMarkdownTable = true;
        warnings.push(
          "마크다운 표가 있습니다 — 에디터에 표 서식이 없어 '|' 기호가 " +
            "그대로 보입니다. 발행 후 직접 표로 바꾸셔야 합니다.",
        );
      }
      return line;
    }

    const block = convertMarkdownBlock(line);
    if (block !== null) {
      convertedMarkdownLines += 1;
      line = block;
    } else {
      const inlined = convertMarkdownInline(line);
      if (inlined !== line) {
        convertedMarkdownLines += 1;
        line = inlined;
      }
    }

    line = closeDanglingTags(line, warnings, lineNo);
    warnUnknownTags(line, warnings, unknownSeen);
    return line;
  });

  work = lines.join("\n");

  if (convertedMarkdownLines > 0) {
    warnings.unshift(
      `마크다운 ${convertedMarkdownLines}줄을 네이버 서식으로 변환했습니다.`,
    );
  }

  // 3) 플레이스홀더 제거로 생긴 빈 줄 3개 이상을 2개로 압축
  work = work.replace(/\n{3,}/g, "\n\n").trim();

  return {
    markup: work,
    warnings,
    removedImagePlaceholders,
    convertedMarkdownLines,
    charCount: work.length,
  };
}

/** 태그를 모두 벗긴 순수 글자수 — 네이버 글자수 체감치에 가깝다. */
export function plainTextLength(markup: string): number {
  return markup.replace(/\[\/?[A-Za-z0-9]+\]/g, "").replace(/\s+/g, "").length;
}
