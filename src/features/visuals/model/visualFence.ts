/** The info-string word that turns a fenced HTML block into a visual. */
export const VISUAL_FENCE_MARKER = "onmicode-visual";

const DEFAULT_TITLE = "Visual";
const MAX_TITLE_LENGTH = 120;

export type VisualFence = { title: string };

/**
 * A fence is a visual only with the explicit marker, as in
 * ```html onmicode-visual title="Weekly commits"```, or with the marker as its
 * language. A plain ```html block stays code.
 */
export function visualFence(
  language: string,
  meta: string,
): VisualFence | null {
  const lang = language.toLowerCase();
  // Quoted values are blanked first, so a title cannot carry the marker in.
  const words = meta
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .toLowerCase()
    .split(/\s+/);
  const marked =
    lang === VISUAL_FENCE_MARKER ||
    (lang === "html" && words.includes(VISUAL_FENCE_MARKER));
  return marked ? { title: visualTitle(meta) } : null;
}

function visualTitle(meta: string): string {
  const match = meta.match(/(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/i);
  const title = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
  return title || DEFAULT_TITLE;
}
