// 키워드 목록을 정렬하고 걸러 낸다. 값만 다룬다.
import type { KeywordRow } from './api.ts';

/**
 * related: 네이버가 준 차례 (찾은 말과 관련이 깊은 순서)
 * volume-desc / volume-asc: 한 달 검색 수가 많은 순서 / 적은 순서
 * comp-asc / comp-desc: 광고 경쟁이 낮은 순서 / 높은 순서. 같은 경쟁 안에서는 검색 수가 많은 것이 먼저다
 */
export type KeywordSort = 'related' | 'volume-desc' | 'volume-asc' | 'comp-asc' | 'comp-desc';

const COMPETITION_ORDER: Record<string, number> = { 낮음: 0, 중간: 1, 높음: 2 };

/** 경쟁 정도를 모르는 키워드는 어느 쪽으로 정렬해도 맨 뒤에 둔다 */
const competitionRank = (row: KeywordRow): number | null => COMPETITION_ORDER[row.competition] ?? null;

export function sortKeywords(rows: KeywordRow[], sort: KeywordSort): KeywordRow[] {
  if (sort === 'related') return [...rows];
  // 같은 값끼리는 네이버가 준 차례를 지킨다.
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    if (sort === 'volume-desc' || sort === 'volume-asc') {
      const diff = sort === 'volume-desc' ? b.row.total - a.row.total : a.row.total - b.row.total;
      return diff || a.index - b.index;
    }
    const ra = competitionRank(a.row);
    const rb = competitionRank(b.row);
    if (ra === null || rb === null) return (ra === null ? 1 : 0) - (rb === null ? 1 : 0) || b.row.total - a.row.total || a.index - b.index;
    const diff = sort === 'comp-asc' ? ra - rb : rb - ra;
    return diff || b.row.total - a.row.total || a.index - b.index;
  });
  return indexed.map((item) => item.row);
}

/**
 * 적은 말이 들어간 키워드만 남긴다. 빈칸으로 나눠 여러 말을 적으면 모두 들어간 것만 남긴다.
 * 띄어쓰기와 영어 대소문자는 가리지 않는다.
 */
export function filterKeywords(rows: KeywordRow[], text: string): KeywordRow[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const name = row.keyword.replace(/\s+/g, '').toLowerCase();
    return words.every((word) => name.includes(word));
  });
}
