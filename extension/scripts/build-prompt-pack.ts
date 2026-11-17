// 프롬프트 묶음 파일을 만든다.
//   node scripts/build-prompt-pack.ts            → prompt-pack/blog-studio-prompts.json
//   node scripts/build-prompt-pack.ts 다른경로.json
//
// 원본은 웹 폴더다. 여기서는 읽기만 한다.
//   - web/prompts/*.md              글쓰기 방식 6개와 공통 프롬프트
//   - web/lib/seo-workflow.ts       SEO 8단계 프롬프트
//   - web/lib/ontology/prompt-builder.ts 안의 출력 형식 안내
//   - scripts/glue.ts               그 밖의 글 조각 (웹 코드에서 옮겨 적은 것)
//   - scripts/extension-prompts.ts  확장에만 있는 글 (한 번에 돌릴 때의 답, 내 말투)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GLUE_KEYS, PACK_FORMAT, validatePack, type PackSeoStep, type PromptPack, type SeoPlatform } from '../lib/prompts/pack.ts';
import { AUTO_REPLIES, EXTENSION_GLUE } from './extension-prompts.ts';
import { COMMON_FILE, GLUE, METHODS } from './glue.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');

/**
 * 소스 파일에서 `const 이름 = \`...\`;` 의 글자를 그대로 꺼낸다.
 * 안에 식(${...})이 들어 있으면 그대로 옮길 수 없으므로 멈춘다.
 */
export function extractTemplateConst(source: string, name: string): string {
  const opener = `const ${name} = \``;
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`소스에서 ${name} 을 찾지 못했어요.`);
  let out = '';
  let i = start + opener.length;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
      continue;
    }
    if (ch === '`') return out;
    if (ch === '$' && source[i + 1] === '{') throw new Error(`${name} 안에 식이 들어 있어서 그대로 옮길 수 없어요.`);
    out += ch;
    i += 1;
  }
  throw new Error(`${name} 의 끝을 찾지 못했어요.`);
}

interface WebSeoModule {
  SEO_WORKFLOW: PackSeoStep[];
  PLATFORM_LABELS: Record<SeoPlatform, string>;
}

export async function buildPack(repoRoot: string = REPO_ROOT): Promise<PromptPack> {
  const promptsDir = join(repoRoot, 'web', 'prompts');
  const read = (file: string) => readFile(join(promptsDir, file), 'utf-8');

  const common = await read(COMMON_FILE);
  const items = await Promise.all(
    METHODS.map(async (m) => ({ id: m.id, label: m.label, prompt: await read(m.file) })),
  );

  const builderSource = await readFile(join(repoRoot, 'web', 'lib', 'ontology', 'prompt-builder.ts'), 'utf-8');
  const outputFormat = extractTemplateConst(builderSource, 'OUTPUT_FORMAT_INSTRUCTION');

  const seoModule = (await import(pathToFileURL(join(repoRoot, 'web', 'lib', 'seo-workflow.ts')).href)) as WebSeoModule;
  const steps: PackSeoStep[] = seoModule.SEO_WORKFLOW.map((s) => ({
    id: s.id,
    title: s.title,
    short_label: s.short_label,
    prompt: s.prompt,
    has_user_turn: s.has_user_turn,
    needs_prev_output: s.needs_prev_output,
    needs_selected_title: s.needs_selected_title,
    platforms: [...s.platforms],
    optional: s.optional,
  }));

  const pack: PromptPack = {
    format: PACK_FORMAT,
    built_at: new Date().toISOString(),
    source: 'blog_studio/web (prompts, lib/seo-workflow.ts, lib/ontology)',
    methods: { common, items },
    glue: { ...GLUE, ...EXTENSION_GLUE, output_format: outputFormat },
    seo: { steps, platform_labels: { ...seoModule.PLATFORM_LABELS }, auto_replies: { ...AUTO_REPLIES } },
  };

  const check = validatePack(JSON.parse(JSON.stringify(pack)));
  if (!check.ok) throw new Error('만든 묶음이 형식에 맞지 않아요: ' + check.errors.join(' / '));
  const extra = Object.keys(pack.glue).filter((key) => !(GLUE_KEYS as readonly string[]).includes(key));
  if (extra.length > 0) throw new Error('확장이 모르는 글 조각이 있어요: ' + extra.join(', '));
  // 대신 보내는 답은 AI가 되묻는 단계에만 둔다. 없는 단계 번호를 적었으면 알려 준다.
  for (const id of Object.keys(pack.seo.auto_replies)) {
    const step = steps.find((s) => String(s.id) === id);
    if (!step) throw new Error(`대신 보내는 답의 단계 번호 ${id} 가 SEO 단계에 없어요.`);
    if (!step.has_user_turn) throw new Error(`${id}단계는 AI가 되묻지 않는 단계라서 대신 보내는 답이 필요 없어요.`);
  }
  return pack;
}

async function main(): Promise<void> {
  const target = resolve(process.argv[2] ?? join(here, '..', 'prompt-pack', 'blog-studio-prompts.json'));
  const pack = await buildPack();
  await mkdir(dirname(target), { recursive: true });
  const text = JSON.stringify(pack, null, 2);
  await writeFile(target, text, 'utf-8');
  console.log(`프롬프트 묶음을 만들었어요: ${target}`);
  console.log(`글쓰기 방식 ${pack.methods.items.length}개 · SEO ${pack.seo.steps.length}단계 · ${Math.round(text.length / 1024)}KB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
