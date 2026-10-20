import { useEffect, useMemo, useRef, useState } from "react";
import { pickFolders } from "../../../platform/tauri/fs";
import { AlertCircle } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import {
  looksLikeProject,
  type RecentProject,
} from "../../projects/model/recents";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { resolveModel } from "../../sessions/model/models";
import { HARNESS_TITLE } from "../../sessions/model/session";
import {
  formatPromptLinkProject,
  leadingSlashCommand,
  matchPromptLinkProject,
  type PromptLink,
  type PromptLinkResult,
} from "../model/promptLinks";
import {
  promptLinkCandidates,
  promptLinkChoice,
  type PromptLinkLaunch,
} from "../model/promptLinkSession";

type Props = {
  link: PromptLinkResult<PromptLink>;
  recents: RecentProject[];
  /** The window's project, used when the link names none. */
  currentCwd: string;
  onOpen: (launch: PromptLinkLaunch) => void;
  onClose: () => void;
};

export function PromptLinkDialog({ link, ...props }: Props) {
  if (!link.ok) {
    return (
      <Modal title="Could not open the link" size="sm" onClose={props.onClose}>
        <div className="flex flex-col gap-4 p-4 pt-2">
          <p className="text-[12px] leading-relaxed text-content/60">
            {link.error}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80"
            >
              OK
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  return <PromptLinkReview link={link.value} {...props} />;
}

type ProjectMatch = "none" | "searching" | "found" | "missing";

/**
 * What a link would open, before anything opens. The prompt only lands in a
 * composer; sending it stays with the user.
 */
function PromptLinkReview({
  link,
  recents,
  currentCwd,
  onOpen,
  onClose,
}: Omit<Props, "link"> & { link: PromptLink }) {
  const hint = link.project;
  const [cwd, setCwd] = useState(() =>
    !hint && looksLikeProject(currentCwd) ? currentCwd : "",
  );
  const [match, setMatch] = useState<ProjectMatch>(hint ? "searching" : "none");
  const picked = useRef(false);
  const choose = (path: string) => {
    picked.current = true;
    setCwd(path);
  };

  useEffect(() => {
    if (!hint) return;
    let cancelled = false;
    const paths = recents
      .filter((project) => looksLikeProject(project.path))
      .sort((a, b) => b.openedAt - a.openedAt)
      .map((project) => project.path);
    void promptLinkCandidates(paths).then((candidates) => {
      if (cancelled) return;
      const found = matchPromptLinkProject(hint, candidates);
      setMatch(found ? "found" : "missing");
      // A project the user picked while this ran stays picked.
      if (found && !picked.current) setCwd(found);
    });
    return () => {
      cancelled = true;
    };
  }, [hint, recents]);

  const choice = useMemo(
    () => (cwd ? promptLinkChoice(link, cwd) : null),
    [link, cwd],
  );
  const command = leadingSlashCommand(link.prompt.text);
  const hidden = link.prompt.hiddenCharacters;
  const hintLabel = hint ? formatPromptLinkProject(hint) : "";

  const open = () => {
    if (!choice || !cwd) return;
    onOpen({
      cwd,
      harness: choice.harness,
      model: choice.model,
      prompt: link.prompt.text,
    });
  };

  return (
    <Modal
      title="Open linked prompt"
      description="It opens as a draft. Nothing runs until you send it."
      onClose={onClose}
      fitViewport
    >
      <div className="flex flex-col gap-4 p-4 pt-3">
        {hidden > 0 ? (
          <div
            role="alert"
            className="flex gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[12px] leading-relaxed text-content/80"
          >
            <AlertCircle
              className="mt-0.5 size-3.5 shrink-0 text-amber-400"
              strokeWidth={1.75}
            />
            <span>
              Onmicode removed {hidden} hidden character
              {hidden === 1 ? "" : "s"} from this prompt. Hidden characters can
              carry instructions you cannot see, so the link may be malicious.
              Read the prompt before you send it.
            </span>
          </div>
        ) : null}

        <section className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">Prompt</span>
          <pre className="max-h-[38vh] min-h-12 overflow-auto whitespace-pre-wrap break-words rounded-md border border-content/10 bg-content/5 px-2.5 py-2 font-sans text-[12.5px] leading-relaxed text-content select-text">
            {link.prompt.text}
          </pre>
          {command ? (
            <p className="text-[11px] leading-4 text-content/50">
              It starts with /{command}, which runs as a command when you send
              it.
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">Project</span>
          <SearchableProjectPicker
            cwd={cwd}
            recents={recents}
            railCwd={currentCwd}
            appearance="filled"
            className="self-start"
            onSelectProject={choose}
            onOpenProject={() => {
              void pickFolders("Choose a project").then((paths) => {
                const path = paths[paths.length - 1];
                if (path) choose(path);
              });
            }}
          />
          {match === "searching" ? (
            <p className="text-[11px] leading-4 text-content/45">
              Looking for {hintLabel}…
            </p>
          ) : match === "found" ? (
            <p className="text-[11px] leading-4 text-content/45">
              The link names {hintLabel}.
            </p>
          ) : match === "missing" ? (
            <p className="text-[11px] leading-4 text-content/55">
              No project here matches {hintLabel}. Choose one to work in.
            </p>
          ) : null}
        </section>

        {choice ? (
          <section className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-content/70">Agent</span>
            <p className="text-[12px] text-content/80">
              {HARNESS_TITLE[choice.harness]} ·{" "}
              {resolveModel(choice.harness, choice.model).name}
            </p>
            {choice.notes.map((note) => (
              <p key={note} className="text-[11px] leading-4 text-content/55">
                {note}
              </p>
            ))}
          </section>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!choice}
            onClick={open}
            className="rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            Open as draft
          </button>
        </div>
      </div>
    </Modal>
  );
}
