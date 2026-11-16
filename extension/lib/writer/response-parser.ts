// AI의 답에서 6개 칸(mapping, titles, body, axiom_check, suggestions, meta)을 꺼낸다.
// 웹의 web/lib/ontology/response-parser.ts 를 옮긴 것이다. 같은지는 tests/parity.test.ts 가 확인한다.

export interface ParsedResponse {
  mapping: Record<string, unknown>;
  titles: Array<Record<string, unknown>>;
  body: string;
  axiom_check: Record<string, unknown>;
  suggestions: Record<string, unknown>;
  meta: Record<string, unknown>;
  raw: string;
  parse_ok: boolean;
  parse_errors: string[];
}

function extractJsonBlock(text: string): string | null {
  const stripped = text.trim();
  if (stripped.startsWith('{') && stripped.endsWith('}')) return stripped;

  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence && fence[1] !== undefined) return fence[1];

  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

function emptyResult(raw: string, errors: string[]): ParsedResponse {
  return { mapping: {}, titles: [], body: '', axiom_check: {}, suggestions: {}, meta: {}, raw, parse_ok: false, parse_errors: errors };
}

export function parse(raw: string): ParsedResponse {
  const errors: string[] = [];
  const block = extractJsonBlock(raw);
  if (!block) return emptyResult(raw, ['JSON 블록을 찾지 못함']);

  let data: unknown;
  try {
    data = JSON.parse(block);
  } catch (e) {
    return emptyResult(raw, [`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`]);
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return emptyResult(raw, ['응답 최상위가 object가 아님']);
  }

  const obj = data as Record<string, unknown>;

  function get<T>(key: string, defaultValue: T, predicate: (v: unknown) => v is T): T {
    if (!(key in obj)) {
      errors.push(`누락 필드: ${key}`);
      return defaultValue;
    }
    const v = obj[key];
    if (!predicate(v)) {
      errors.push(`타입 불일치: ${key}`);
      return defaultValue;
    }
    return v;
  }

  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
  const isString = (v: unknown): v is string => typeof v === 'string';

  const mapping = get('mapping', {}, isObject);
  const titles = get('titles', [], isArray) as Array<Record<string, unknown>>;
  const body = get('body', '', isString);
  const axiom_check = get('axiom_check', {}, isObject);
  const suggestions = get('suggestions', {}, isObject);
  const meta = get('meta', {}, isObject);

  return { mapping, titles, body, axiom_check, suggestions, meta, raw, parse_ok: errors.length === 0, parse_errors: errors };
}
