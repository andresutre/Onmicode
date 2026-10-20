import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { GlassBackdrop } from "../../../app/shell/GlassBackdrop";
import { LAYER } from "../../../shared/lib/layers";
import { AlertCircle, Check } from "../../../shared/ui/icons";
import type { RecentProject } from "../../projects/model/recents";
import { usePromptLinkQueue } from "../hooks/usePromptLinkQueue";
import {
  currentPromptLinkNotice,
  dismissPromptLinkNotice,
  subscribePromptLinkNotice,
} from "../model/promptLinkNotice";
import type { PromptLinkLaunch } from "../model/promptLinkSession";
import { PromptLinkDialog } from "./PromptLinkDialog";

type Props = {
  recents: RecentProject[];
  currentCwd: string;
  onOpen: (launch: PromptLinkLaunch) => void;
};

/** Reviews links opened from the OS and reports prompt link copies. */
export function PromptLinks({ recents, currentCwd, onOpen }: Props) {
  const { current, next } = usePromptLinkQueue();
  return (
    <>
      {current ? (
        <PromptLinkDialog
          key={current.id}
          link={current.link}
          recents={recents}
          currentCwd={currentCwd}
          onOpen={(launch) => {
            next();
            onOpen(launch);
          }}
          onClose={next}
        />
      ) : null}
      <PromptLinkNotice />
    </>
  );
}

function PromptLinkNotice() {
  const notice = useSyncExternalStore(
    subscribePromptLinkNotice,
    currentPromptLinkNotice,
    () => null,
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => dismissPromptLinkNotice(notice.id),
      notice.kind === "error" ? 5_000 : 2_500,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  const Icon = notice.kind === "error" ? AlertCircle : Check;
  return createPortal(
    <div
      role="status"
      style={{ zIndex: LAYER.toast }}
      className="fixed bottom-6 left-1/2 isolate flex max-w-[min(420px,calc(100vw-24px))] -translate-x-1/2 items-center gap-2 overflow-hidden rounded-xl border border-content/10 px-3 py-2 text-[12px] text-content shadow-xl"
    >
      <GlassBackdrop />
      <Icon
        className={`relative z-[1] size-3.5 shrink-0 ${
          notice.kind === "error" ? "text-red-400" : "text-accent"
        }`}
        strokeWidth={1.75}
      />
      <span className="relative z-[1]">{notice.text}</span>
    </div>,
    document.body,
  );
}
