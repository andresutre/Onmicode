import { MessageSquare } from "../../../shared/ui/icons";
import type { AnsweredQuestion } from "../model/userQuestion";
import { AttachmentChip } from "./AttachmentChip";

/** What the user answered when the agent asked, with the files they attached. */
export function QuestionAnswerHistory({
  questions,
  embedded = false,
}: {
  questions: AnsweredQuestion[];
  /** True when the parent surface already provides the horizontal gutter. */
  embedded?: boolean;
}) {
  if (questions.length === 0) return null;
  return (
    <div className={embedded ? "py-1" : "px-4 py-1"}>
      <div
        role="group"
        aria-label="Your answer"
        className="flex flex-col gap-2 rounded-lg border border-content/10 bg-content/3 px-3 py-2"
      >
        {questions.map((question) => (
          <div key={question.id} className="flex min-w-0 items-start gap-1.5">
            <MessageSquare
              className="mt-0.5 size-3.5 shrink-0 text-content/45"
              strokeWidth={1.75}
            />
            <div className="min-w-0 flex-1">
              <p className="break-words text-[12px] leading-snug text-content/55">
                {question.prompt}
              </p>
              {question.answers.length > 0 ? (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug text-content">
                  {question.answers.join(", ")}
                </p>
              ) : null}
              {question.attachments?.length ? (
                <div
                  role="group"
                  aria-label="Attached files"
                  className="mt-1.5 flex flex-wrap gap-1.5"
                >
                  {question.attachments.map((file) => (
                    <AttachmentChip key={file.id} attachment={file} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
