import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileActionError } from "../../files/ui/FileActionError";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { HighlightedCodeBlock } from "../../sessions/ui/HighlightedCodeBlock";
import { copyText } from "../../../platform/tauri/clipboard";
import { writeTextFile } from "../../../platform/tauri/fs";
import {
  ArrowDownCircle,
  ChartBreakoutSquare,
  Check,
  Code,
  Copy,
  Eye,
  Maximize2,
} from "../../../shared/ui/icons";
import {
  VISUAL_MAX_BYTES,
  visualExportDocument,
  visualFileName,
} from "../model/visualDocument";
import { getVisualTheme } from "../model/visualTheme";
import { VisualDialog } from "./VisualDialog";
import { VISUAL_PLACEHOLDER_HEIGHT, VisualFrame } from "./VisualFrame";

/**
 * A visual in a reply: a placeholder while its fence streams, then its page
 * in a sandboxed frame, with its code, a copy, a saved file and a larger view
 * one click away.
 */
export function VisualBlock({
  html,
  title,
  incomplete,
}: {
  html: string;
  title: string;
  incomplete: boolean;
}) {
  const [showCode, setShowCode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const page = html.replace(/\r?\n$/, "");
  const tooLarge = useMemo(
    () =>
      !incomplete && new TextEncoder().encode(page).length > VISUAL_MAX_BYTES,
    [incomplete, page],
  );

  useEffect(
    () => () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (incomplete) {
    return (
      <div
        role="status"
        data-visual-placeholder=""
        className="my-4 min-w-0"
        dir="ltr"
      >
        <div className="mb-1 flex h-7 min-w-0 items-center gap-1.5 text-[12px] text-content/50">
          <ChartBreakoutSquare
            className="size-3.5 shrink-0"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">Drawing {title}…</span>
        </div>
        <div
          className="animate-pulse rounded-[10px] border border-content/10 bg-content/6"
          style={{ height: VISUAL_PLACEHOLDER_HEIGHT }}
        />
      </div>
    );
  }

  const copy = () => {
    void copyText(page).then(
      () => {
        setCopied(true);
        if (copiedTimer.current != null)
          window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => setError("Could not copy the visual's HTML."),
    );
  };

  const saveFile = async () => {
    try {
      const path = await save({
        title: "Save Visual",
        defaultPath: visualFileName(title),
        filters: [{ name: "HTML page", extensions: ["html"] }],
      });
      if (!path) return;
      await writeTextFile(path, visualExportDocument(page, getVisualTheme()));
    } catch (cause) {
      setError(`Could not save the visual: ${String(cause)}`);
    }
  };

  const code = showCode || tooLarge;
  // The actions sit in a header rather than appearing on hover: a pointer over
  // the frame is in another document, so the reply never sees it hover.
  return (
    <div className="my-4 min-w-0" data-visual="" dir="ltr">
      <div className="mb-1 flex h-7 min-w-0 items-center gap-1.5 text-[12px] text-content/50">
        <ChartBreakoutSquare
          className="size-3.5 shrink-0"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <div
          role="toolbar"
          aria-label={`${title} actions`}
          className="flex shrink-0 gap-0.5"
        >
          {tooLarge ? null : (
            <VisualAction
              label={showCode ? "Show visual" : "Show code"}
              onClick={() => setShowCode((value) => !value)}
            >
              {showCode ? (
                <Eye className="size-3.5" strokeWidth={1.75} />
              ) : (
                <Code className="size-3.5" strokeWidth={1.75} />
              )}
            </VisualAction>
          )}
          <VisualAction label={copied ? "Copied" : "Copy HTML"} onClick={copy}>
            {copied ? (
              <Check className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.75} />
            )}
          </VisualAction>
          <VisualAction label="Save as HTML…" onClick={() => void saveFile()}>
            <ArrowDownCircle className="size-3.5" strokeWidth={1.75} />
          </VisualAction>
          {tooLarge ? null : (
            <VisualAction label="Open larger" onClick={() => setExpanded(true)}>
              <Maximize2 className="size-3.5" strokeWidth={1.75} />
            </VisualAction>
          )}
        </div>
      </div>
      {code ? (
        <div className="markdown-code-shell" style={{ marginBlock: 0 }}>
          <span className="markdown-code-icon" aria-hidden="true">
            <FileTypeIcon name="visual.html" isDir={false} />
          </span>
          <HighlightedCodeBlock
            code={page}
            isIncomplete={false}
            language="html"
            lineNumbers
          />
        </div>
      ) : (
        <VisualFrame html={page} title={title} />
      )}
      {tooLarge ? (
        <p className="mt-1 text-xs text-content/45">
          This visual is too large to show, so it appears as code.
        </p>
      ) : null}
      {expanded ? (
        <VisualDialog
          html={page}
          title={title}
          onClose={() => setExpanded(false)}
        />
      ) : null}
      {error ? (
        <FileActionError message={error} onDismiss={() => setError(null)} />
      ) : null}
    </div>
  );
}

function VisualAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}
