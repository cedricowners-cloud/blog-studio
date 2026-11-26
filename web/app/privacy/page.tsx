import type { Metadata } from "next";

// 크롬 확장 "blog_studio 도우미"의 개인정보 처리방침.
// 크롬 웹 스토어에 올릴 때 이 페이지의 주소를 적는다. 로그인하지 않아도 열려야 한다 (middleware.ts 의 PUBLIC_PATHS).
// 확장이 하는 일이 바뀌면 이 글도 같이 고친다. 근거는 extension/README.md 의 "지킬 것".

export const metadata: Metadata = {
  title: "개인정보 처리방침 · blog_studio 도우미",
  description: "크롬 확장 blog_studio 도우미가 다루는 정보와 그 정보를 보내는 곳",
};

const UPDATED = "2026년 11월 26일";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold pt-4">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} className="border px-3 py-2 text-left bg-gray-50 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td key={i} className="border px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto p-6 md:p-10 space-y-4 leading-relaxed text-gray-800">
      <h1 className="text-3xl font-bold">개인정보 처리방침</h1>
      <p className="text-sm text-gray-500">크롬 확장 프로그램 &quot;blog_studio 도우미&quot; · 고친 날: {UPDATED}</p>

      <p>
        blog_studio 도우미는 블로그 글의 초안을 만들고, 사용자가 연 네이버 블로그 글쓰기 화면에 그 글을 채워 주는 크롬 확장 프로그램이에요.
        개인이 만들어 가족과 함께 쓰는 프로그램이고, 광고나 사용 기록 수집 도구는 들어 있지 않아요.
      </p>

      <Section title="1. 한눈에 보기">
        <ul className="list-disc pl-6 space-y-1">
          <li>만든 글, 말투 정리, AI 키, 설정은 사용자의 컴퓨터(크롬의 확장 저장소)에만 둬요.</li>
          <li>blog_studio 서버가 받는 것은 로그인에 쓰는 이메일뿐이에요.</li>
          <li>글을 만들 때 적은 내용과 고른 사진은, 사용자가 버튼을 눌렀을 때 사용자가 고른 AI 회사로만 보내요.</li>
          <li>사용자의 정보를 팔거나, 광고에 쓰거나, 이 확장의 기능과 상관없는 곳에 쓰지 않아요.</li>
          <li>네이버의 발행 버튼은 누르지 않아요. 저장과 발행은 사용자가 직접 해요.</li>
        </ul>
      </Section>

      <Section title="2. 다루는 정보와 두는 곳">
        <Table
          head={["정보", "쓰는 곳", "두는 곳"]}
          rows={[
            ["이메일, 로그인 정보", "로그인하고, 프롬프트와 공용 설정을 받을 수 있는 계정인지 확인", "blog_studio 서버(Supabase). 로그인 상태는 사용자의 컴퓨터"],
            ["비밀번호, 메일로 받은 로그인 코드", "로그인 요청", "저장하지 않아요. 요청에만 써요"],
            ["AI 키 (Gemini, OpenAI, Claude)", "사용자가 고른 AI 회사를 부를 때", "사용자의 컴퓨터. blog_studio 서버로 보내지 않아요"],
            ["글을 만들 때 적은 주제, 키워드, 메모, 참고 자료", "AI에게 글의 초안을 부탁할 때", "사용자의 컴퓨터. 글을 만들 때 고른 AI 회사로 보내요"],
            ["사용자가 고른 사진", "사진으로 리뷰 글 만들기, 글쓰기 화면에 사진 넣기", "사용자의 컴퓨터. 리뷰 글을 만들 때만 줄인 사본을 고른 AI 회사로 보내요"],
            ["내 블로그의 공개 글 (내 말투 기능)", "말투를 정리해서 글에 반영", "사용자의 컴퓨터. 말투를 정리할 때만 고른 AI 회사로 보내요"],
            ["찾을 말 (자료 찾기 기능)", "네이버에서 키워드의 검색 수, 블로그 글, 뉴스 찾기", "네이버의 검색 API와 검색광고 API로 보내요"],
            ["만든 글, 진행 상황, 설정", "이어서 쓰기", "사용자의 컴퓨터 (만든 글은 최근 10개)"],
          ]}
        />
      </Section>

      <Section title="3. 정보를 보내는 곳">
        <p>사용자가 기능을 쓸 때, 그 기능에 필요한 곳으로만 보내요.</p>
        <Table
          head={["받는 곳", "보내는 때", "보내는 것"]}
          rows={[
            ["Google (Gemini API), OpenAI, Anthropic 중 사용자가 고른 곳", "[글 만들기], [말투 정리하기], [리뷰 글 만들기]처럼 AI를 쓰는 버튼을 눌렀을 때", "그 기능에 적은 글과 고른 사진, 사용자의 AI 키"],
            ["네이버 (검색 API, 검색광고 API)", "자료 탭에서 [찾기]를 눌렀을 때", "찾을 말과 네이버 API 키"],
            ["blog_studio 서버 (Supabase)", "로그인할 때, 프롬프트와 공용 설정을 받을 때", "이메일과 로그인 정보"],
          ]}
        />
        <p>AI 회사와 네이버로 보낸 내용은 그 회사의 약관과 개인정보 처리방침에 따라 다뤄져요.</p>
      </Section>

      <Section title="4. 네이버 블로그에서 하는 일">
        <ul className="list-disc pl-6 space-y-1">
          <li>사용자가 [채우기]를 눌렀을 때, 열려 있는 네이버 블로그 글쓰기 화면에 제목, 본문, 사진을 넣어요.</li>
          <li>내 말투 기능은 사용자의 블로그에 공개된 글의 목록과 본문을 읽어요. 읽기만 하고, 로그인 정보를 싣지 않아요.</li>
          <li>네이버의 아이디, 비밀번호, 쿠키를 읽거나 저장하지 않아요.</li>
          <li>저장, 발행, 댓글, 공감, 이웃 추가 같은 동작은 하지 않아요.</li>
        </ul>
      </Section>

      <Section title="5. 하지 않는 일">
        <ul className="list-disc pl-6 space-y-1">
          <li>방문한 사이트의 기록을 모으지 않아요. 접근할 수 있는 주소는 네이버 블로그, 위에 적은 API, blog_studio 서버와 웹뿐이에요.</li>
          <li>사용 통계나 광고용 추적 도구를 넣지 않았어요.</li>
          <li>사용자의 정보를 다른 사람에게 팔거나 넘기지 않아요.</li>
          <li>신용 평가나 대출 심사에 쓰지 않아요.</li>
        </ul>
      </Section>

      <Section title="6. 지우는 방법">
        <ul className="list-disc pl-6 space-y-1">
          <li>확장을 크롬에서 삭제하면 사용자의 컴퓨터에 둔 정보(AI 키, 만든 글, 말투, 설정)가 모두 지워져요.</li>
          <li>확장의 설정 탭에서 AI 키와 네이버 키를 따로 지울 수 있고, 로그아웃할 수 있어요.</li>
          <li>서버의 계정(이메일)을 지우고 싶으면 아래 연락처로 알려 주세요.</li>
        </ul>
      </Section>

      <Section title="7. 문의">
        <p>크롬 웹 스토어의 blog_studio 도우미 페이지에 있는 개발자 연락처로 보내 주세요.</p>
      </Section>

      <Section title="8. 바뀌는 경우">
        <p>확장이 다루는 정보가 달라지면 이 글을 먼저 고치고, 위의 &quot;고친 날&quot;을 바꿔요.</p>
      </Section>

      <section lang="en" className="space-y-3 border-t mt-8 pt-6 text-sm text-gray-700">
        <h2 className="text-lg font-bold">Privacy Policy (English summary)</h2>
        <p>
          &quot;blog_studio 도우미&quot; is a Chrome extension that drafts blog posts with an AI provider chosen by the user and fills the draft into the
          Naver Blog editor that the user has opened. It never clicks the publish button. It contains no advertising or analytics code.
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <b>Stored only on the user&apos;s device</b> (chrome.storage.local): AI API keys, generated drafts, the writing-style summary, settings and
            the login session.
          </li>
          <li>
            <b>Sent to the blog_studio server (Supabase)</b>: the user&apos;s email address and login credentials, only to sign in and to check whether
            the account may download the prompt templates and shared settings.
          </li>
          <li>
            <b>Sent to the AI provider the user selected</b> (Google Gemini API, OpenAI or Anthropic), only when the user presses a generate button:
            the text the user typed, the reference snippets and photos the user selected, and the user&apos;s own API key.
          </li>
          <li>
            <b>Sent to Naver</b> (Search API and Search Ad API), only when the user runs a search in the extension: the search words and the Naver API
            keys.
          </li>
          <li>
            <b>On blog.naver.com</b>: the extension inserts the draft into the editor when the user presses the fill button, and reads the public posts
            of the user&apos;s own blog for the writing-style feature. It does not read Naver passwords or cookies.
          </li>
          <li>
            User data is not sold, not transferred to third parties except as described above, not used for purposes unrelated to the
            extension&apos;s single purpose, and not used to determine creditworthiness or for lending.
          </li>
          <li>Removing the extension deletes all locally stored data. To delete the server account, contact the developer through the Chrome Web Store listing.</li>
        </ul>
        <p>Last updated: 26 November 2026.</p>
      </section>
    </main>
  );
}
