import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
import { X } from "../../../shared/ui/icons";
import { VisualFrame } from "./VisualFrame";

/** A visual opened large, over the app, with its page scrolling inside. */
export function VisualDialog({
  html,
  title,
  onClose,
}: {
  html: string;
  title: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visual: ${title}`}
      className="fixed inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-6 backdrop-blur-sm"
      style={{ zIndex: LAYER.dialog }}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="h-[min(86vh,calc(100vh-96px))] w-[min(1200px,92vw)] overflow-hidden rounded-xl border border-content/10 bg-background-base p-4 shadow-2xl">
        {/* The page runs again here, at this size, with the current theme. */}
        <VisualFrame html={html} title={title} fill onEscape={onClose} />
      </div>
      <p className="max-w-[92vw] truncate text-xs text-white/75">{title}</p>
      <button
        ref={closeRef}
        type="button"
        aria-label="Close visual"
        title="Close"
        onClick={onClose}
        className="absolute right-4 top-4 grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white/80 shadow-lg backdrop-blur-md hover:bg-black/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>,
    document.body,
  );
}
