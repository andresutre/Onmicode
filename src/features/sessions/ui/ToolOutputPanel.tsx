import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { plainToolOutput } from "../model/toolOutput";
import { nestedScrollAbsorbsWheel } from "../model/transcriptActivity";

/** How near the end the reader can be and still count as following along. */
const LIVE_EDGE_PX = 4;

/**
 * What a call printed, in a short window of its own. While the call runs the
 * window stays on its newest line, the way a terminal does, until the reader
 * scrolls up to read something; scrolling back to the end picks it up again.
 */
export function ToolOutputPanel({
  text,
  live = false,
  failed = false,
  className = "",
}: {
  text: string;
  live?: boolean;
  failed?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  const shown = useMemo(() => plainToolOutput(text).trim(), [text]);

  // Pinned before paint, so each chunk lands without the window jumping.
  useLayoutEffect(() => {
    const el = ref.current;
    if (live && following.current && el) el.scrollTop = el.scrollHeight;
  }, [live, shown]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A live phase around this window follows its own newest step. A wheel
    // this window can take is the reader's, and must not stop that.
    const onWheel = (event: WheelEvent) => {
      if (nestedScrollAbsorbsWheel(el, event.deltaY)) event.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <pre
      ref={ref}
      data-tool-output={live ? "live" : ""}
      onScroll={(event) => {
        const el = event.currentTarget;
        following.current =
          el.scrollHeight - el.scrollTop - el.clientHeight <= LIVE_EDGE_PX;
      }}
      className={`max-h-48 min-w-0 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words py-1 font-mono text-[12px] leading-5 ${
        failed ? "text-red-400/80" : "text-content/55"
      } ${className}`}
    >
      {shown}
    </pre>
  );
}
