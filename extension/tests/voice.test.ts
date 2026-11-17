// 내 글 모음, 말투 분석 프롬프트, 네이버 글 읽기를 시험한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addPosts,
  ANALYZE_POSTS,
  buildAnalyzePrompt,
  cardIsStale,
  cleanCard,
  EMPTY_VOICE,
  EXCERPT_CHARS,
  MAX_POSTS,
  needsAnalysis,
  normalizeVoice,
  postsToAnalyze,
  rememberIgnored,
  removePost,
  signatureOf,
  titlesOf,
  type VoiceCard,
  type VoicePost,
  type VoiceState,
} from '../lib/voice/library.ts';
import { blogIdFromUrl, decodeEntities, extractPost, listUrl, parsePostList, postUrl } from '../lib/voice/naver.ts';
import { buildPack } from '../scripts/build-prompt-pack.ts';

const pack = await buildPack();

const post = (n: number, over: Partial<VoicePost> = {}): VoicePost => ({
  id: `p${n}`,
  title: `글 ${n}`,
  body: `${n}번째 글의 본문이에요. `.repeat(30),
  source: 'blog',
  log_no: String(1000 + n),
  added_at: '2026-11-17T00:00:00.000Z',
  ...over,
});

const cardFor = (state: VoiceState, over: Partial<VoiceCard> = {}): VoiceCard => ({
  text: '- 문장 끝은 ~해요',
  analyzed_at: '2026-11-17T00:00:00.000Z',
  signature: signatureOf(state.posts),
  post_count: state.posts.length,
  edited: false,
  model: 'fake',
  ...over,
});

test('내 글: 새 글이 앞에 오고, 같은 글과 너무 짧은 글은 넣지 않는다', () => {
  const first = addPosts(EMPTY_VOICE, [post(1), post(2)]);
  assert.equal(first.added, 2);
  assert.deepEqual(first.state.posts.map((p) => p.id), ['p2', 'p1']);

  const again = addPosts(first.state, [
    post(1), // 같은 글 번호
    post(9, { log_no: undefined, source: 'paste', body: post(2).body.replace(/ /g, '\n') }), // 본문이 같음 (빈칸만 다름)
    post(3, { body: '너무 짧은 글' }),
    post(4, { title: '   ' }),
  ]);
  assert.equal(again.added, 1);
  assert.equal(again.duplicate, 2);
  assert.equal(again.tooShort, 1);
  assert.equal(again.state.posts[0]?.title, '(제목 없음)');
});

test('내 글: 정해진 수를 넘으면 오래전에 넣은 글부터 빠진다', () => {
  const many = Array.from({ length: MAX_POSTS + 5 }, (_, i) => post(i + 1));
  const { state, added } = addPosts(EMPTY_VOICE, many);
  assert.equal(added, MAX_POSTS + 5);
  assert.equal(state.posts.length, MAX_POSTS);
  assert.equal(state.posts[0]?.id, `p${MAX_POSTS + 5}`);
  assert.ok(!state.posts.some((p) => p.id === 'p1'));
  assert.equal(postsToAnalyze(state).length, ANALYZE_POSTS);
  assert.equal(removePost(state, state.posts[0]?.id ?? '').posts.length, MAX_POSTS - 1);
});

test('내 글: 글 모음이 바뀌면 말투 카드가 낡은 것으로 본다', () => {
  const a = addPosts(EMPTY_VOICE, [post(1), post(2)]).state;
  assert.equal(signatureOf(a.posts), signatureOf([...a.posts].reverse()));
  assert.notEqual(signatureOf(a.posts), signatureOf(a.posts.slice(1)));

  assert.equal(needsAnalysis(EMPTY_VOICE), false); // 글이 없으면 분석하지 않는다
  assert.equal(needsAnalysis(a), true); // 글은 있고 카드가 없다

  const withCard: VoiceState = { ...a, card: cardFor(a) };
  assert.equal(cardIsStale(withCard), false);
  assert.equal(needsAnalysis(withCard), false);

  const grown = addPosts(withCard, [post(3)]).state;
  assert.equal(cardIsStale(grown), true);
  assert.equal(needsAnalysis(grown), true);

  // 사람이 고친 카드는 글이 늘어도 자동으로 덮어쓰지 않는다
  const edited = addPosts({ ...a, card: cardFor(a, { edited: true }) }, [post(3)]).state;
  assert.equal(cardIsStale(edited), true);
  assert.equal(needsAnalysis(edited), false);
  // 카드가 비어 있으면 다시 분석한다
  assert.equal(needsAnalysis({ ...a, card: cardFor(a, { text: '  ', edited: true }) }), true);
});

test('내 글: 분석 프롬프트에는 글 수와 글이 들어가고, 글은 정해진 길이까지만 보낸다', () => {
  const long = post(1, { title: '긴 글', body: '가'.repeat(EXCERPT_CHARS) + '여기는잘려야해요' });
  const prompt = buildAnalyzePrompt(pack, [long, post(2, { title: '{{count}} 가 든 제목' })]);
  assert.ok(prompt.includes('2편'));
  assert.ok(prompt.includes('긴 글') && prompt.includes('{{count}} 가 든 제목'));
  assert.ok(!prompt.includes('여기는잘려야해요'));
  assert.ok(!/\{\{(posts|n|title|body)\}\}/.test(prompt));
});

test('내 글: 말투 카드 다듬기와 제목 목록', () => {
  assert.equal(cleanCard('```markdown\n- 문장 끝은 ~해요\n```'), '- 문장 끝은 ~해요');
  assert.equal(cleanCard('  - 그대로  '), '- 그대로');
  assert.equal(cleanCard('가'.repeat(5000)).length, 1500);
  const state = addPosts(EMPTY_VOICE, [post(1), post(2, { title: '글 1' }), post(3, { title: ' ' })]).state;
  assert.deepEqual(titlesOf(state), ['글 1']);
});

test('내 글: 저장된 값이 이상해도 쓸 수 있는 모양으로 고친다', () => {
  assert.deepEqual(normalizeVoice(null), EMPTY_VOICE);
  assert.deepEqual(normalizeVoice('글자'), EMPTY_VOICE);
  const fixed = normalizeVoice({ posts: [post(1), null, { title: 3 }], card: { text: 5 }, blog_id: '', auto_check: false });
  assert.equal(fixed.posts.length, 1);
  assert.equal(fixed.card, null);
  assert.equal(fixed.blog_id, null);
  assert.equal(fixed.auto_check, false);
  assert.deepEqual(fixed.ignored_log_nos, []);
  // 예전에 저장한 값(짧은 글 번호 칸이 없음)도 읽힌다
  assert.deepEqual(normalizeVoice({ posts: [], ignored_log_nos: ['1', 2, '3'] }).ignored_log_nos, ['1', '3']);
});

test('내 글: 너무 짧아서 넣지 않은 글의 번호를 겹치지 않게 적어 둔다', () => {
  const once = rememberIgnored(EMPTY_VOICE, ['10', '11']);
  const twice = rememberIgnored(once, ['11', '12']);
  assert.deepEqual(twice.ignored_log_nos, ['11', '12', '10']);
  assert.deepEqual(EMPTY_VOICE.ignored_log_nos, []);
});

// ───────────── 네이버 글 읽기 ─────────────

test('네이버: 탭 주소에서 블로그 아이디를 알아낸다', () => {
  assert.deepEqual(blogIdFromUrl('https://blog.naver.com/someone/postwrite'), { blogId: 'someone', isWritePage: true });
  assert.deepEqual(blogIdFromUrl('https://blog.naver.com/PostWriteForm.naver?blogId=someone'), { blogId: 'someone', isWritePage: true });
  assert.deepEqual(blogIdFromUrl('https://blog.naver.com/someone/223344556677'), { blogId: 'someone', isWritePage: false });
  assert.deepEqual(blogIdFromUrl('https://blog.naver.com/PostView.naver?blogId=some_one-1&logNo=1'), { blogId: 'some_one-1', isWritePage: false });
  assert.equal(blogIdFromUrl('https://blog.naver.com/PostList.naver'), null);
  assert.equal(blogIdFromUrl('https://blog.naver.com/'), null);
  assert.equal(blogIdFromUrl('https://example.com/someone'), null);
  assert.equal(blogIdFromUrl('https://m.blog.naver.com/someone'), null);
  assert.equal(blogIdFromUrl('주소가 아님'), null);
  assert.ok(listUrl('someone', 10).startsWith('https://blog.naver.com/PostTitleListAsync.naver?blogId=someone&'));
  assert.ok(listUrl('someone', 10).endsWith('countPerPage=10'));
  assert.equal(postUrl('someone', '123'), 'https://blog.naver.com/PostView.naver?blogId=someone&logNo=123');
});

test('네이버: 글 목록을 읽는다 (JSON 에 없는 \\\' 와 인코딩된 제목)', () => {
  const raw =
    '{"resultCode":"S","postList":[' +
    '{"logNo":"224464411656","title":"%5B%EC%95%88%EB%82%B4%5D+%26%2339%3B%EA%B0%80%EC%97%85+%EC%8A%B9%EA%B3%84%26%2339%3B","addDate":"2026. 11. 4."},' +
    '{"logNo":224456322072,"title":"%EB%91%98%EC%A7%B8+%EA%B8%80","addDate":" 2026. 10. 28. "},' +
    '{"logNo":"번호아님","title":"x","addDate":""}' +
    '],"pagingHtml":"<a href=\\"#\\" onclick=\\"go(\\\'1\\\')\\">1</a>","totalCount":"2"}';
  assert.deepEqual(parsePostList(raw), [
    { logNo: '224464411656', title: "[안내] '가업 승계'", date: '2026. 11. 4.' },
    { logNo: '224456322072', title: '둘째 글', date: '2026. 10. 28.' },
  ]);
  assert.equal(parsePostList('<!DOCTYPE html><html><body>유효하지 않은 요청입니다</body></html>'), null);
  assert.equal(parsePostList('{"resultCode":"E"}'), null);
  assert.deepEqual(parsePostList('{"postList":[]}'), []);
});

test('네이버: 스마트에디터로 쓴 글에서 제목과 본문을 꺼낸다', () => {
  const html = `<html><head><meta property="og:title" content="&#39;가업 승계&#39; 준비 순서"/><title>가업 승계 : 네이버 블로그</title></head><body>
    <div class="se-module se-module-text se-title-text"><p class="se-text-paragraph se-text-paragraph-align-left"><span>제목 영역의 글자</span></p></div>
    <div class="se-main-container">
      <div class="se-component se-text"><p class="se-text-paragraph se-text-paragraph-align-left " style="" id="SE-1"><span style="color:#000" class="se-fs-fs19 se-ff-system"><b>첫 문단</b>이에요. A &amp; B</span></p>
      <p class="se-text-paragraph" id="SE-2"><span>​</span></p>
      <p class="se-text-paragraph" id="SE-3"><span>둘째&nbsp;문단   이에요.</span><br></p></div>
      <div class="se-component se-quotation"><p class="se-text-paragraph se-text-paragraph-align-center"><span>인용구 안의 글</span></p></div>
      <div class="se-component se-table"><table><tr><td><p class="se-text-paragraph"><span>표의 칸</span></p></td></tr></table></div>
    </div><div class="comment"><p class="other">댓글은 읽지 않는다</p></div></body></html>`;
  assert.deepEqual(extractPost(html), {
    title: "'가업 승계' 준비 순서",
    body: '첫 문단이에요. A & B\n둘째 문단 이에요.\n인용구 안의 글\n표의 칸',
  });
});

test('네이버: 예전 에디터로 쓴 글도 읽고, 본문이 없으면 없다고 한다', () => {
  const old = `<html><head><title>옛날 글 : 네이버 블로그</title></head><body>
    <div id="postViewArea"><div><p>첫 줄<br>둘째 줄</p><script>var x = 1;</script><div>셋째 &lt;줄&gt;</div></div></div>
    <div class="post_footer">공감 버튼</div></body></html>`;
  assert.deepEqual(extractPost(old), { title: '옛날 글', body: '첫 줄\n둘째 줄\n셋째 <줄>' });
  assert.equal(extractPost('<html><body>로그인이 필요합니다</body></html>'), null);
  assert.equal(extractPost('<div class="se-main-container"><div class="se-component se-image"></div></div>'), null);
  assert.equal(decodeEntities('&#x1F600; &#44032; &unknown; &AMP;'), '😀 가 &unknown; &');
});
