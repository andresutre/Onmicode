import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** The app's own scheme for visual pages; see `src-tauri/src/visuals.rs`. */
export const VISUAL_SCHEME = "visual";

/**
 * Registers a complete page with the backend and returns the URL its
 * sandboxed frame loads. A `srcdoc` frame would inherit the app's CSP, which
 * blocks the page's inline scripts.
 */
export async function visualPageUrl(page: string): Promise<string> {
  const id = await invoke<string>("visual_register", { html: page });
  return convertFileSrc(id, VISUAL_SCHEME);
}
