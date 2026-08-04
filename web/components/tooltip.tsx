/**
 * 의존성 없는 CSS 툴팁. hover 즉시 표시 (브라우저 native title 의 1-2초 딜레이 없음).
 *
 * 사용:
 *   <Tooltip text="설명">
 *     <span>⭐</span>
 *   </Tooltip>
 */
import type { ReactNode } from "react";

interface TooltipProps {
  text: string;
  children: ReactNode;
  /** 위치: top (기본) | bottom */
  position?: "top" | "bottom";
}

export function Tooltip({ text, children, position = "top" }: TooltipProps) {
  const posClasses =
    position === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5"
      : "top-full left-1/2 -translate-x-1/2 mt-1.5";
  const arrowClasses =
    position === "top"
      ? "top-full left-1/2 -translate-x-1/2 border-t-neutral-800 border-b-transparent border-x-transparent"
      : "bottom-full left-1/2 -translate-x-1/2 border-b-neutral-800 border-t-transparent border-x-transparent";

  return (
    <span className="relative inline-flex group cursor-help">
      {children}
      <span
        role="tooltip"
        className={`absolute ${posClasses} pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-[11px] text-white shadow-lg`}
      >
        {text}
        <span
          className={`absolute ${arrowClasses} h-0 w-0 border-4`}
          aria-hidden="true"
        />
      </span>
    </span>
  );
}
