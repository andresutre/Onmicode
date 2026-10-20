import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { parsePromptLink, type PromptLink, type PromptLinkResult } from "../model/promptLinks";

/** The backend's nudge to a window chosen to review new links. */
export const PROMPT_LINK_OPEN_EVENT = "monocode:prompt-link-open";

export type QueuedPromptLink = {
  id: string;
  link: PromptLinkResult<PromptLink>;
};

/**
 * Links opened from the OS, one at a time. The backend keeps them until a
 * window takes them; mount, focus and its nudge all take, and the backend
 * hands each link to one window only.
 */
export function usePromptLinkQueue() {
  const [queue, setQueue] = useState<QueuedPromptLink[]>([]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const take = async () => {
      // Taking drains the backend, so a disposed effect must not take.
      if (disposed) return;
      try {
        const urls = await invoke<string[]>("prompt_link_take");
        if (disposed || !urls.length) return;
        setQueue((current) => [
          ...current,
          ...urls.map((url) => ({
            id: crypto.randomUUID(),
            link: parsePromptLink(url),
          })),
        ]);
      } catch (error) {
        console.error("Could not take opened prompt links:", error);
      }
    };
    void listen(PROMPT_LINK_OPEN_EVENT, () => void take())
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined)
      .then(take);
    const onFocus = () => void take();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const next = useCallback(() => setQueue((current) => current.slice(1)), []);
  return { current: queue[0] ?? null, next };
}
