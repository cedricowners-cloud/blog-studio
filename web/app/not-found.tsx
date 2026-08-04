import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-screen p-4 sm:p-6 flex items-center justify-center">
      <div className="max-w-md w-full bg-white border rounded-lg p-6 text-center space-y-4">
        <FileQuestion className="w-10 h-10 text-neutral-400 mx-auto" strokeWidth={1.5} />
        <div>
          <h2 className="text-lg font-bold text-neutral-900">페이지를 찾을 수 없습니다</h2>
          <p className="text-sm text-neutral-500 mt-1">
            요청하신 경로가 존재하지 않거나 이동되었습니다.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 bg-neutral-900 text-white text-sm rounded px-4 py-2 hover:bg-neutral-800"
        >
          <Home className="w-4 h-4" />
          홈으로
        </Link>
      </div>
    </main>
  );
}
