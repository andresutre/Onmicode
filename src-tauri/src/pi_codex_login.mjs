// Written by Onmicode and loaded into the Pi sessions it starts.
//
// Signs Pi's built-in `openai-codex` provider in with the Codex CLI login of
// the Codex profile Onmicode picked, found in ONMICODE_CODEX_HOME/auth.json.
// The token is read again before every run, so one the Codex CLI refreshed in
// the meantime is picked up. Without a readable login, Pi keeps its own.
import { readFileSync } from "node:fs";
import { join } from "node:path";

function codexToken() {
  const home = process.env.ONMICODE_CODEX_HOME;
  if (!home) return undefined;
  try {
    const auth = JSON.parse(readFileSync(join(home, "auth.json"), "utf8"));
    const token = auth && auth.tokens && auth.tokens.access_token;
    return typeof token === "string" && token.split(".").length === 3
      ? token
      : undefined;
  } catch {
    return undefined;
  }
}

function provider(token) {
  return {
    apiKey: token,
    // Stands in for a login Pi may have stored itself, which would otherwise
    // win over the key. Pi's auth.json is never written.
    oauth: {
      name: "OpenAI Codex (Onmicode profile)",
      isSubscription: true,
      login: async () => {
        throw new Error("Sign in to Codex from Onmicode's account picker.");
      },
      refreshToken: async (credentials) => credentials,
      getApiKey: () => codexToken() || token,
    },
  };
}

export default function onmicodeCodexLogin(pi) {
  const sync = () => {
    const token = codexToken();
    if (token) pi.registerProvider("openai-codex", provider(token));
  };
  sync();
  pi.on("before_agent_start", sync);
}
