import {
  bindPiSession,
  cancelPiTurn,
  compactPiContext,
  forgetPiSession,
  respondPiApproval,
  rewindPiLastTurn,
  sendPiTurn,
  steerPiTurn,
  stopPiSession,
} from "./pi";
import { refreshPiCatalog } from "./piCatalog";
import { generatePiSessionTitle } from "./piTitle";
import { runPiTextPrompt, stopPiTextPrompt, warmupPiText } from "./piText";
import { registerHarness, type HarnessAdapter } from "../../core/registry";
import { discoverPiSkills } from "./piSkills";
import { respondQuestion } from "./piFamily";
import { PI_FLAVOR } from "./piFlavor";

export const piAdapter: HarnessAdapter = {
  id: "pi",
  live: true,
  commands: { discover: ({ cwd }) => discoverPiSkills(cwd) },
  respondQuestion: (sessionId, requestId, reply) =>
    respondQuestion(PI_FLAVOR, sessionId, requestId, reply),
  sendTurn: sendPiTurn,
  compactContext: compactPiContext,
  rewindLastTurn: rewindPiLastTurn,
  steerTurn: steerPiTurn,
  cancelTurn: cancelPiTurn,
  respondApproval: respondPiApproval,
  stopSession: stopPiSession,
  forgetSession: forgetPiSession,
  bindSession: bindPiSession,
  refreshCatalog: refreshPiCatalog,
  generateTitle: generatePiSessionTitle,
  warmupText: warmupPiText,
  runTextPrompt: runPiTextPrompt,
  stopTextPrompt: stopPiTextPrompt,
};

let registered = false;

export function ensurePiRegistered(): void {
  if (registered) return;
  registerHarness(piAdapter);
  registered = true;
}
