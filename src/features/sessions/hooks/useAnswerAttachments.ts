import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type RefObject,
} from "react";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  mergeAttachments,
  pickAttachments,
  revokeAttachment,
} from "../model/attachments";
import { storeAnswerAttachments } from "../model/questionAnswers";
import type { Attachment } from "../model/session";
import type { UserQuestion, UserQuestionReply } from "../model/userQuestion";
import {
  isFileReferenceText,
  messageFilesFromClipboard,
  nativeClipboardAttachments,
} from "../../../platform/tauri/clipboard";
import { captureDraft } from "../../../shared/lib/draftRestore";
import { useFileDrop } from "./useFileDrop";

const EMPTY_DROP =
  "Nothing to attach from that drop — the file may have been moved, renamed, or deleted.";

/**
 * Files attached to a question's answers, kept per question. They arrive the
 * way the composer's do: from the file picker, dropped on `zone`, or pasted
 * into it, including screenshots that only the native clipboard holds.
 */
export function useAnswerAttachments({
  requestId,
  question,
  enabled,
  zone,
  onActivity,
  onPasteText,
}: {
  requestId: number;
  /** The question on screen, which new files attach to. */
  question: UserQuestion | undefined;
  /** Whether that question can take files with its answer. */
  enabled: boolean;
  /** The form files are dropped on. */
  zone: RefObject<HTMLElement | null>;
  /** Attaching a file counts as working on the answer. */
  onActivity: () => void;
  /** Sets the answer field's text once a pasted file link is resolved. */
  onPasteText: (question: UserQuestion, value: string) => void;
}) {
  const [files, setFiles] = useState<Record<string, Attachment[]>>({});
  const [reading, setReading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const generation = useRef(0);
  const sent = useRef(false);

  useEffect(() => {
    setFiles({});
    setReading(0);
    setError(null);
    sent.current = false;
    return () => {
      // A read still in flight belongs to this request, not the next one.
      generation.current += 1;
      if (!sent.current)
        Object.values(filesRef.current).flat().forEach(revokeAttachment);
    };
  }, [requestId]);

  const attach = (
    questionId: string,
    read: () => Promise<Attachment[]>,
    empty?: string,
  ) => {
    const current = generation.current;
    onActivity();
    setError(null);
    setReading((count) => count + 1);
    void read()
      .then(storeAnswerAttachments)
      .then((incoming) => {
        if (generation.current !== current) {
          incoming.forEach(revokeAttachment);
          return;
        }
        if (incoming.length === 0) {
          if (empty) setError(empty);
          return;
        }
        setFiles((all) => ({
          ...all,
          [questionId]: mergeAttachments(all[questionId] ?? [], incoming),
        }));
      })
      .catch((reason: unknown) => {
        if (generation.current !== current) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (generation.current === current)
          setReading((count) => Math.max(0, count - 1));
      });
  };

  // Native drop listeners register once, so they read the latest state here.
  const latest = useRef({ attach, question });
  latest.current = { attach, question };
  const dropState = useRef({ attachmentsSupported: enabled, remote: false });
  dropState.current = { attachmentsSupported: enabled, remote: false };
  const readDrop = useCallback((read: () => Promise<Attachment[]>) => {
    const { attach, question } = latest.current;
    if (question) attach(question.id, read, EMPTY_DROP);
  }, []);
  const fileDrag = useFileDrop({
    anchor: zone,
    enabled,
    state: dropState,
    read: readDrop,
    onError: setError,
    zone: "self",
  });

  const pick = (onClose?: () => void) => {
    if (!enabled || !question) return;
    attach(question.id, () => pickAttachments().finally(() => onClose?.()));
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    if (!enabled || !question) return;
    const target = question;
    const data = event.clipboardData;
    const captured = captureDraft(event.target);
    // A message copied in Onmicode brings its words along for the answer field.
    const message = messageFilesFromClipboard(data);
    if (message) {
      if (!captured) event.preventDefault();
      attach(target.id, () => attachmentsFromFiles(message));
      return;
    }
    const pasted = filesFromClipboard(data);
    if (pasted.length) {
      event.preventDefault();
      attach(target.id, () => attachmentsFromFiles(pasted));
      return;
    }
    // Words are the field's to insert. A screenshot, or a file copied in a
    // file manager, reaches only the native clipboard: as a file link or as
    // nothing the webview can see.
    const text = data.getData("text/plain");
    if (text && !isFileReferenceText(text)) return;
    event.preventDefault();
    attach(target.id, async () => {
      const result = await nativeClipboardAttachments(text);
      if (result.warning) setError(result.warning);
      if (captured && text) {
        const { field, value, start, end } = captured;
        const inserted = value.slice(0, start) + text + value.slice(end);
        // WebKit can insert the link despite preventDefault. A chip replaces
        // it; a link that named no file stays as typed text.
        if (result.files.length) {
          if (field.value === inserted) onPasteText(target, value);
        } else if (field.value !== inserted) {
          onPasteText(target, inserted);
        }
      }
      return result.files;
    });
  };

  const remove = (questionId: string, fileId: string) => {
    const removed = filesRef.current[questionId]?.find(
      (file) => file.id === fileId,
    );
    if (removed) revokeAttachment(removed);
    setFiles((all) => ({
      ...all,
      [questionId]: (all[questionId] ?? []).filter(
        (file) => file.id !== fileId,
      ),
    }));
    setError(null);
  };

  /** A skipped question sends no files. Returns what is left. */
  const discard = (questionId: string): Record<string, Attachment[]> => {
    filesRef.current[questionId]?.forEach(revokeAttachment);
    const next = { ...filesRef.current };
    delete next[questionId];
    filesRef.current = next;
    setFiles(next);
    return next;
  };

  /** Files sent with the reply live on in the transcript; the rest go. */
  const settle = (
    reply: UserQuestionReply,
    all: Record<string, Attachment[]> = filesRef.current,
  ) => {
    const kept = new Set(
      reply.kind === "answered"
        ? Object.values(reply.attachments ?? {}).flat()
        : [],
    );
    for (const file of Object.values(all).flat())
      if (!kept.has(file)) revokeAttachment(file);
    sent.current = true;
  };

  return {
    files,
    reading: reading > 0,
    error,
    fileDrag,
    pick,
    onPaste,
    remove,
    discard,
    settle,
  };
}
