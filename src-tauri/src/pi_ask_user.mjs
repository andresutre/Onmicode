// Written by Onmicode and loaded into the Pi sessions it starts.
//
// Pi has no tool of its own for asking the user, so this adds `ask_user`. The
// questions travel to Onmicode as an RPC `editor` dialog with a fixed title
// and the questions as JSON in its prefill; Onmicode shows them in its own
// question card and answers with JSON. Keep ASK_USER_TITLE in sync with
// PI_ASK_USER_TITLE in piProtocol.ts.
const ASK_USER_TITLE = "onmicode:ask_user";

const parameters = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      description: "The questions to ask, shown to the user together.",
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "The full question." },
          header: {
            type: "string",
            description: "Very short label for the question (a few words).",
          },
          options: {
            type: "array",
            description:
              "Suggested answers. The user can always type their own answer instead.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                description: { type: "string" },
              },
              required: ["label"],
            },
          },
          multiSelect: {
            type: "boolean",
            description: "Allow choosing more than one option.",
          },
        },
        required: ["question"],
      },
    },
  },
  required: ["questions"],
};

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanQuestions(raw) {
  return (Array.isArray(raw) ? raw : []).flatMap((item) => {
    const question = text(item && item.question);
    if (!question) return [];
    const header = text(item.header);
    const options = (Array.isArray(item.options) ? item.options : []).flatMap(
      (option) => {
        const label = text(option && option.label);
        if (!label) return [];
        const description = text(option.description);
        return [{ label, ...(description ? { description } : {}) }];
      },
    );
    return [
      {
        question,
        ...(header ? { header } : {}),
        options,
        multiSelect: item.multiSelect === true,
      },
    ];
  });
}

function parseAnswers(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed && parsed.answers) ? parsed.answers : [];
  } catch {
    return [];
  }
}

function result(message, details) {
  return { content: [{ type: "text", text: message }], details };
}

export default function onmicodeAskUser(pi) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask user",
    description:
      "Ask the user one or more questions and wait for the answers. Use it when you need a decision or information only the user has, instead of asking in plain text.",
    promptSnippet: "Ask the user questions and wait for their answers",
    parameters,
    executionMode: "sequential",
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const questions = cleanQuestions(params && params.questions);
      if (questions.length === 0) throw new Error("No questions to ask.");
      if (!ctx.hasUI) {
        return result(
          "No user is available to answer. Continue with your best judgement and state your assumptions.",
          { questions, answers: [] },
        );
      }
      const reply = await ctx.ui.editor(
        ASK_USER_TITLE,
        JSON.stringify({ toolCallId, questions }),
      );
      const answers =
        reply === undefined
          ? []
          : parseAnswers(reply).filter(
              (item) => item && text(item.question) && text(item.answer),
            );
      if (answers.length === 0) {
        return result(
          "The user dismissed the questions without answering. Do not ask them again; continue with your best judgement or stop and wait for instructions.",
          { questions, answers },
        );
      }
      const lines = answers.map(
        (item) => `Q: ${text(item.question)}\nA: ${text(item.answer)}`,
      );
      const skipped = questions.length - answers.length;
      if (skipped > 0)
        lines.push(`The user left ${skipped} question(s) unanswered.`);
      return result(`The user answered:\n\n${lines.join("\n\n")}`, {
        questions,
        answers,
      });
    },
  });
}
