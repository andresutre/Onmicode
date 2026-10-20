import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clampVisualHeight,
  readVisualMessage,
  visualDocument,
  visualThemeMessage,
} from "../model/visualDocument";
import { visualPageUrl } from "../model/visualPages";
import { useVisualTheme } from "../model/visualTheme";

export const VISUAL_PLACEHOLDER_HEIGHT = 160;

// A frame that mounts again, or a remounted transcript, starts at the height
// its page last reported instead of jumping from the placeholder.
const lastHeights = new Map<string, number>();
const MAX_REMEMBERED_HEIGHTS = 200;

function rememberHeight(html: string, height: number) {
  lastHeights.delete(html);
  lastHeights.set(html, height);
  if (lastHeights.size > MAX_REMEMBERED_HEIGHTS) {
    const oldest = lastHeights.keys().next().value;
    if (oldest !== undefined) lastHeights.delete(oldest);
  }
}

/**
 * A visual's page in a sandboxed frame. It never gets allow-same-origin, so
 * the page runs in an opaque origin with no reach into the app, and its
 * served CSP stops it loading or sending anything. The frame fits the page's
 * reported height, so the transcript around it does the scrolling.
 */
export function VisualFrame({
  html,
  title,
  fill = false,
  onEscape,
}: {
  html: string;
  title: string;
  /** Fill the container and let the page scroll inside, as when expanded. */
  fill?: boolean;
  onEscape?: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = useVisualTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [height, setHeight] = useState(
    () => lastHeights.get(html) ?? VISUAL_PLACEHOLDER_HEIGHT,
  );

  // The page keeps the theme it was registered with; later changes are posted
  // to it, so a theme switch never reloads the frame.
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(null);
    visualPageUrl(visualDocument(html, themeRef.current)).then(
      (url) => {
        if (!cancelled) setSrc(url);
      },
      (error: unknown) => {
        if (!cancelled) setFailed(String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [html]);

  const postTheme = () =>
    frameRef.current?.contentWindow?.postMessage(
      visualThemeMessage(themeRef.current),
      "*",
    );
  useEffect(postTheme, [theme]);

  // Listen from the commit that inserts the frame, so a fast page's first
  // height is not missed.
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const message = readVisualMessage(event.data);
      if (!message) return;
      if (message.type === "height") {
        const next = clampVisualHeight(message.height);
        rememberHeight(html, next);
        setHeight(next);
      } else if (message.type === "link") {
        // Only a link the reader just clicked: the frame holds focus then.
        if (
          document.activeElement === frame &&
          navigator.userActivation?.isActive !== false
        )
          void openUrl(message.url).catch((error) => {
            console.error("Failed to open a visual's link:", error);
          });
      } else {
        onEscapeRef.current?.();
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [html]);

  const size = fill ? "100%" : height;
  if (failed) {
    return (
      <div
        role="alert"
        className="flex items-center justify-center rounded-[10px] border border-content/10 px-4 text-center text-xs text-content/50"
        style={{ height: fill ? "100%" : VISUAL_PLACEHOLDER_HEIGHT }}
      >
        Could not show this visual: {failed}
      </div>
    );
  }
  if (!src) return <div aria-hidden="true" style={{ height: size }} />;
  return (
    <iframe
      ref={frameRef}
      src={src}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      data-visual-frame=""
      // Covers a theme change that landed while the page was loading.
      onLoad={postTheme}
      // A frame whose color scheme differs from its document's paints opaque.
      // Kept light, the blank document a frame starts with, again whenever the
      // transcript moves it, stays clear instead of flashing white in dark
      // mode; the page paints the chat's background itself.
      className="block w-full border-0"
      style={{ height: size, colorScheme: "light" }}
    />
  );
}
