"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Command, Monitor } from "lucide-react";

import { getBrowserSupabase } from "@/lib/supabase";

type OS = "mac" | "windows";

/** 맥/윈도우 설치·실행 가이드 + 페어링 값 발급. */
export default function AgentSetupGuide() {
  const [os, setOs] = useState<OS>("mac");

  // 처음 열 때 쓰는 기기에 맞는 탭을 보여준다.
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Win/i.test(ua)) setOs("windows");
    else if (/Mac/i.test(ua)) setOs("mac");
  }, []);

  return (
    <section className="bg-white border rounded-lg p-4 space-y-4">
      <header>
        <h2 className="text-sm font-semibold">설치 가이드</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          네이버 발행은 Chrome을 직접 조작해야 해서, 내 PC에서 작은 프로그램
          하나를 띄워둬야 합니다. 아래 순서를 그대로 따라오시면 됩니다.
        </p>
      </header>

      {/* OS 토글 */}
      <div className="flex gap-1 border-b">
        {(
          [
            ["mac", "macOS", Command],
            ["windows", "Windows", Monitor],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setOs(key)}
            className={`-mb-px px-3 py-1.5 text-sm border-b-2 inline-flex items-center gap-1.5 ${
              os === key
                ? "border-brand text-brand font-medium"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {os === "mac" ? <MacGuide /> : <WindowsGuide />}

      <PairingValue />

      <CommonNotes />
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-5 h-5 rounded-full bg-neutral-900 text-white text-[11px] flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="text-xs text-neutral-600 space-y-1">{children}</div>
      </div>
    </li>
  );
}

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-neutral-900 text-neutral-100 rounded p-2 pr-14 text-[11px] overflow-x-auto">
        {children}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute top-1.5 right-1.5 text-[10px] bg-neutral-700 text-neutral-100 rounded px-1.5 py-0.5 hover:bg-neutral-600"
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}

function MacGuide() {
  return (
    <ol className="space-y-3">
      <Step n={1} title="터미널 열기">
        <p>
          <kbd className="border rounded px-1">⌘</kbd> +{" "}
          <kbd className="border rounded px-1">Space</kbd> 를 누르고{" "}
          <b>터미널</b> 이라고 입력 후 Enter. 검은 창이 뜨면 명령을 입력할 수
          있습니다.
        </p>
      </Step>

      <Step n={2} title="프로젝트 폴더로 이동">
        <Cmd>cd ~/Documents/00_project/blog_studio</Cmd>
        <p>
          아무 메시지도 안 나오면 성공입니다. 폴더 위치가 다르면 그 경로로
          바꿔주세요.
        </p>
      </Step>

      <Step n={3} title="페어링 (최초 1회)">
        <Cmd>./local_agent/agent pair</Cmd>
        <p>
          처음 실행하면 필요한 프로그램을 자동으로 설치합니다 (1~3분). 그 뒤
          아래 <b>페어링 값</b>을 붙여넣으라고 나오면,{" "}
          <b>아래 &ldquo;페어링 값&rdquo; 칸의 복사 버튼</b>을 눌러 복사한 다음 터미널에 붙여넣고
          Enter를 누르세요.
        </p>
        <p className="text-neutral-500">
          <code>✓ 저장됨</code> 이 보이면 완료입니다.
        </p>
      </Step>

      <Step n={4} title="실행">
        <Cmd>./local_agent/agent</Cmd>
        <p>
          <code>Supabase 인증 확인 — user=...</code> 이 보이면 연결된 것이고,
          위쪽 <b>에이전트 상태</b>에 초록 점이 뜹니다.
        </p>
        <p className="text-amber-800">
          이 터미널 창을 닫으면 에이전트도 꺼집니다. 계속 켜두려면 5번으로.
        </p>
      </Step>

      <Step n={5} title="자동 실행 등록 (선택)">
        <Cmd>./local_agent/agent install</Cmd>
        <p>
          Mac에 로그인할 때마다 자동으로 켜지고, 꺼지면 다시 켜집니다. 터미널을
          닫아도 됩니다.
        </p>
        <p className="text-amber-800">
          <b>&ldquo;키체인에 세션이 없습니다&rdquo;</b> 라고 나오면 아래를 먼저
          실행한 뒤 다시 <code>install</code> 하세요. 예전에 비밀번호 방식으로
          페어링한 경우입니다 (백그라운드에서는 비밀번호를 물어볼 수 없어
          키체인에 옮겨둬야 합니다).
        </p>
        <Cmd>./local_agent/agent migrate</Cmd>
        <p className="text-neutral-500">
          상태 확인 <code>agent status</code> · 로그{" "}
          <code>agent logs</code> · 해제 <code>agent uninstall</code>
        </p>
      </Step>
    </ol>
  );
}

function WindowsGuide() {
  return (
    <>
      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 inline-flex gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Windows 경로는 아직 실제 기기에서 검증하지 못했습니다. 막히는 단계가
          있으면 화면에 나온 메시지를 알려주세요.
        </span>
      </div>

      <ol className="space-y-3 mt-3">
        <Step n={1} title="Python 설치 확인">
          <p>
            <kbd className="border rounded px-1">Win</kbd> +{" "}
            <kbd className="border rounded px-1">R</kbd> → <code>cmd</code> →
            Enter 로 명령 프롬프트를 열고:
          </p>
          <Cmd>python --version</Cmd>
          <p>
            <code>Python 3.11</code> 이상이 나오면 넘어가세요. 없다고 나오면{" "}
            <a
              href="https://www.python.org/downloads/"
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline"
            >
              python.org
            </a>{" "}
            에서 설치하는데, 설치 첫 화면의{" "}
            <b>&ldquo;Add python.exe to PATH&rdquo;</b> 를 반드시 체크하세요.
            체크를 놓치면 명령을 못 찾습니다.
          </p>
        </Step>

        <Step n={2} title="프로젝트 폴더로 이동">
          <Cmd>cd %USERPROFILE%\Documents\00_project\blog_studio</Cmd>
          <p>폴더 위치가 다르면 그 경로로 바꿔주세요.</p>
        </Step>

        <Step n={3} title="페어링 (최초 1회)">
          <Cmd>local_agent\agent.bat pair</Cmd>
          <p>
            처음 실행하면 필요한 프로그램을 자동으로 설치합니다 (1~3분). 그 뒤
            아래 <b>페어링 값</b>을 붙여넣으라고 나오면,{" "}
            <b>아래 &ldquo;페어링 값&rdquo; 칸의 복사 버튼</b>을 눌러 복사하고 명령 프롬프트에서{" "}
            <b>마우스 오른쪽 클릭</b>으로 붙여넣은 다음 Enter.
          </p>
          <p className="text-neutral-500">
            명령 프롬프트는 <kbd className="border rounded px-1">Ctrl</kbd>+
            <kbd className="border rounded px-1">V</kbd> 가 안 되는 경우가
            있어서 오른쪽 클릭이 확실합니다.
          </p>
        </Step>

        <Step n={4} title="실행">
          <Cmd>local_agent\agent.bat</Cmd>
          <p>
            <code>Supabase 인증 확인 — user=...</code> 이 보이면 연결된 것이고,
            위쪽 <b>에이전트 상태</b>에 초록 점이 뜹니다.
          </p>
          <p className="text-amber-800">
            이 창을 닫으면 에이전트도 꺼집니다. 계속 켜두려면 5번으로.
          </p>
        </Step>

        <Step n={5} title="자동 실행 등록 (선택)">
          <p>
            Windows는 자동 등록 명령을 제공하지 않습니다. 시작프로그램 폴더에
            바로가기를 넣는 방식이 가장 간단합니다.
          </p>
          <p>
            <kbd className="border rounded px-1">Win</kbd> +{" "}
            <kbd className="border rounded px-1">R</kbd> →{" "}
            <code>shell:startup</code> → Enter 로 폴더를 열고, 그 안에{" "}
            <code>agent.bat</code> 의 <b>바로가기</b>를 만들어 넣으세요
            (<code>agent.bat</code> 우클릭 → 복사 → 시작프로그램 폴더에서
            우클릭 → <b>바로가기 붙여넣기</b>).
          </p>
          <p className="text-neutral-500">
            로그인할 때마다 창이 하나 열립니다. 창을 숨기고 싶으면 바로가기
            속성에서 실행 방식을 <b>최소화</b>로 바꾸세요.
          </p>
        </Step>
      </ol>
    </>
  );
}

/* ------------------------------------------------------------------ */

function PairingValue() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reveal() {
    setErr(null);
    try {
      const sb = getBrowserSupabase();
      const { data } = await sb.auth.getSession();
      const s = data.session;
      if (!s) throw new Error("세션이 없습니다. 다시 로그인하세요.");
      // 한 줄로 내보낸다. 들여쓴 JSON 은 터미널에 붙여넣을 때 첫 줄만
      // 프로그램이 받고 나머지가 셸 명령으로 실행돼버린다.
      setToken(
        JSON.stringify({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="border-t pt-3 space-y-2">
      <h3 className="text-sm font-medium">페어링 값</h3>
      <p className="text-xs text-neutral-500">
        위 3번 단계에서 붙여넣을 값입니다. 내 PC의 에이전트가 이 계정으로
        접속하는 데 쓰입니다.
      </p>

      {token === null ? (
        <button
          onClick={reveal}
          className="text-sm border rounded px-3 py-1.5 hover:bg-neutral-50"
        >
          페어링 값 보기
        </button>
      ) : (
        <>
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            이 값은 <b>로그인 세션 자체</b>입니다. 내 PC의 에이전트에만
            붙여넣고, 캡처·공유·채팅 전송은 하지 마세요.
          </div>
          <textarea
            readOnly
            value={token}
            rows={3}
            className="w-full border rounded p-2 text-[11px] font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(token);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="text-sm bg-neutral-900 text-white rounded px-3 py-1.5"
            >
              {copied ? "복사됨" : "복사"}
            </button>
            <button
              onClick={() => setToken(null)}
              className="text-sm border rounded px-3 py-1.5 hover:bg-neutral-50"
            >
              숨기기
            </button>
          </div>
        </>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

function CommonNotes() {
  return (
    <div className="border-t pt-3 space-y-2">
      <h3 className="text-sm font-medium">처음 발행할 때 알아두실 것</h3>
      <ul className="text-xs text-neutral-600 space-y-1.5 list-disc list-inside">
        <li>
          <b>네이버 계정 이름을 먼저 등록</b>해야 합니다 (위 &ldquo;네이버 계정
          등록&rdquo; 칸). 등록하지 않으면 발행 작업이 만들어지지 않습니다.
        </li>
        <li>
          <b>최초 1회는 직접 로그인</b>해야 합니다. 발행을 누르면 Chrome 창이
          열리니 <b>180초 안에</b> 네이버에 로그인하세요. 이후에는 저장된
          쿠키로 자동 진행됩니다. 비밀번호는 저장하지 않습니다.
        </li>
        <li>
          글 1건당 <b>15분 이상</b> 걸립니다. 네이버 차단을 피하려고 에디터에
          머무는 시간이며, 바로 끝나지 않는 게 정상입니다. 그동안 Chrome 창을
          닫지 마세요.
        </li>
        <li>
          기본은 <b>임시저장(비공개)</b>입니다. 네이버 글쓰기 &gt; 저장 목록에
          들어가니, 확인하고 직접 발행하실 수 있습니다.
        </li>
        <li>
          본문의 이미지 자리(<code>[IMG: ...]</code>)는 제거됩니다. 발행 후
          네이버 에디터에서 직접 넣어주세요.
        </li>
      </ul>
    </div>
  );
}
