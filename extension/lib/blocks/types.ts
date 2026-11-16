// 블록 목록: 본문의 하나뿐인 형식 (설계 문서 4.1).
// 웹이 본문을 이 형식으로 한 번 변환하고, 확장은 이것만 받아서 에디터에 넣는다.

/** 색 강조의 뜻. 실제 색은 사람마다 설정에서 정한다 (설계 문서 4.6). */
export type Tone = 'positive' | 'negative';

/** 글자 한 조각과 그 꾸밈 */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 색 강조: 긍정(브랜드 색) 또는 부정(빨강 계열) */
  tone?: Tone;
  /** 형광펜 (배경색) */
  highlight?: boolean;
}

export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; runs: Run[]; align?: 'left' | 'center' | 'right' }
  | { kind: 'quote'; style: number; runs: Run[] }
  | { kind: 'divider'; style: number }
  | { kind: 'table'; rows: string[][]; headerRow: boolean }
  | { kind: 'image'; slot: string; alt: string };

export interface ParsedBody {
  blocks: Block[];
  /** 변환하면서 알아챈 문제. 사용자에게 보여 준다 */
  warnings: string[];
}

/** 색 강조에 쓰는 실제 색. "#rrggbb" 모양 */
export interface Palette {
  /** 긍정 강조 글자색. 내 브랜드 색 */
  positive: string;
  /** 부정 강조 글자색 */
  negative: string;
  /** 형광펜 배경색 */
  highlight: string;
}
