import {
  buildThreadTitlePrompt,
  parseGeneratedSessionTitle,
  type GeneratedSessionTitle,
} from "../../../../features/sessions/model/sessionTitle";
import { OMP_FLAVOR, PI_FLAVOR, type PiFlavor } from "./piFlavor";
import { runTextPrompt } from "./piText";
import type { PiSubagentTitler } from "./piFamily";
import {
  buildSubagentTitlePrompt,
  parseSubagentTitles,
} from "./piSubagentTitles";

const TITLE_TIMEOUT_MS = 45_000;

async function generateSessionTitle(
  flavor: PiFlavor,
  input: {
    sessionId: string;
    cwd: string;
    message: string;
    providerAccountId?: string;
    codexAccountId?: string;
  },
): Promise<GeneratedSessionTitle | null> {
  try {
    const output = await runTextPrompt(flavor, {
      cwd: input.cwd,
      providerAccountId: input.providerAccountId,
      codexAccountId: input.codexAccountId,
      prompt: buildThreadTitlePrompt(input.message),
      timeoutMs: TITLE_TIMEOUT_MS,
    });
    return parseGeneratedSessionTitle(output, input.message);
  } catch (error) {
    console.debug("[monocode] session title", error);
    return null;
  }
}

/** Titles for a launch's subagents, from the same cheap model as the thread's. */
export const generatePiSubagentTitles: PiSubagentTitler = async ({
  flavor,
  cwd,
  providerAccountId,
  codexAccountId,
  briefs,
}) => {
  const output = await runTextPrompt(flavor, {
    cwd,
    providerAccountId,
    codexAccountId,
    prompt: buildSubagentTitlePrompt(briefs),
    timeoutMs: TITLE_TIMEOUT_MS,
  });
  return parseSubagentTitles(output, briefs.length);
};

export function generatePiSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
  providerAccountId?: string;
  codexAccountId?: string;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(PI_FLAVOR, input);
}

export function generateOmpSessionTitle(input: {
  sessionId: string;
  cwd: string;
  message: string;
}): Promise<GeneratedSessionTitle | null> {
  return generateSessionTitle(OMP_FLAVOR, input);
}
