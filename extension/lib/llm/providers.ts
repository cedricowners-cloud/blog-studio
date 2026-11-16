// AI 회사마다 화면에 보여 줄 이름, 키 발급 주소, 안내 글.
// 발급 주소는 바뀔 수 있다. 바뀌면 여기 한 곳만 고친다. (2026-11-16 에 확인함)
import type { LLMProvider } from './client.ts';

export interface ProviderGuide {
  name: string;
  /** 키를 만드는 페이지 */
  keyUrl: string;
  /** 키를 만드는 순서 */
  steps: string[];
  /** 알아 둘 점 */
  notes: string[];
}

export const PROVIDER_GUIDES: Record<LLMProvider, ProviderGuide> = {
  gemini: {
    name: 'Gemini (구글)',
    keyUrl: 'https://aistudio.google.com/apikey',
    steps: ['구글 계정으로 로그인해요.', '[API 키 만들기]를 눌러요.', '만들어진 키를 복사해서 아래 칸에 붙여넣어요.'],
    notes: ['무료로 쓸 수 있는 한도가 있어요. 처음이라면 여기부터 해 보세요.'],
  },
  openai: {
    name: 'GPT (OpenAI)',
    keyUrl: 'https://platform.openai.com/api-keys',
    steps: ['OpenAI 계정으로 로그인해요.', '[Create new secret key]를 눌러요.', '키는 한 번만 보여 줘요. 바로 복사해서 아래 칸에 붙여넣어요.'],
    notes: ['키만으로는 안 되고, 결제 수단을 등록하거나 금액을 충전해야 해요.', 'ChatGPT 유료 구독과는 따로 계산돼요.'],
  },
  anthropic: {
    name: 'Claude (Anthropic)',
    keyUrl: 'https://platform.claude.com/settings/keys',
    steps: ['Claude 콘솔에 로그인해요.', '[Create Key]를 눌러요.', '키는 한 번만 보여 줘요. 바로 복사해서 아래 칸에 붙여넣어요.'],
    notes: ['키만으로는 안 되고, 금액을 충전해야 해요.', 'Claude 유료 구독과는 따로 계산돼요.'],
  },
};

export const COMMON_KEY_NOTES = [
  '키는 이 컴퓨터의 확장 안에만 저장돼요. 글을 만들 때 그 AI 회사로만 보내요.',
  '쓴 만큼 요금이 나와요. 각 사이트에서 한 달 사용 한도를 걸어 두면 안심돼요.',
];
