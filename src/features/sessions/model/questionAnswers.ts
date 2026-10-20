import { invoke } from "@tauri-apps/api/core";
import { attachmentPathText } from "./attachments";
import type { Attachment } from "./session";
import {
  questionAttachments,
  selectedAnswerLabels,
  type UserQuestion,
  type UserQuestionReply,
} from "./userQuestion";

type AnsweredReply = Extract<UserQuestionReply, { kind: "answered" }>;

/**
 * The files attached to one question's answer, as lines the agent can act on.
 *
 * Every harness takes an answer as text, so a file travels as its absolute
 * path for the agent's own tools to read, in the words a turn already uses
 * for a file the harness cannot take as content.
 */
export function answerAttachmentLines(
  question: UserQuestion,
  reply: AnsweredReply,
): string[] {
  return questionAttachments(question, reply.attachments).map(
    attachmentPathText,
  );
}

/** An answer channel that takes a list: the chosen labels, then each file. */
export function answerParts(
  question: UserQuestion,
  reply: AnsweredReply,
): string[] {
  return [
    ...selectedAnswerLabels(question, reply),
    ...answerAttachmentLines(question, reply),
  ];
}

/** An answer channel that takes one string: `answer`, with its files below. */
export function answerText(
  question: UserQuestion,
  reply: AnsweredReply,
  answer: string,
): string {
  const files = answerAttachmentLines(question, reply).join("\n");
  return [answer, files].filter(Boolean).join("\n\n");
}

/** Every file in a reply, in question order. */
export function replyAttachments(
  questions: UserQuestion[],
  reply: UserQuestionReply,
): Attachment[] {
  if (reply.kind !== "answered") return [];
  return questions.flatMap((question) =>
    questionAttachments(question, reply.attachments),
  );
}

/**
 * Give each answer file a path, since that is how an answer carries it. A
 * pasted image arrives as bytes alone, so it is written where the composer
 * writes the pasted files it cannot send inline.
 */
export function storeAnswerAttachments(
  files: Attachment[],
): Promise<Attachment[]> {
  return Promise.all(
    files.map(async (file) => {
      if (file.path || !file.data) return file;
      const path = await invoke<string>("write_attachment", {
        name: file.name,
        data: file.data,
      });
      return { ...file, path };
    }),
  );
}
