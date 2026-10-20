/**
 * One short-lived status line for prompt link actions. Copying runs from the
 * composer menu or the command palette, and both close before the clipboard
 * write settles, so the result is shown by the workspace instead.
 */

export type PromptLinkNotice = {
  id: number;
  kind: "success" | "error";
  text: string;
};

let current: PromptLinkNotice | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export function showPromptLinkNotice(notice: Omit<PromptLinkNotice, "id">) {
  current = { ...notice, id: ++nextId };
  emit();
}

/** Clears the notice only if it is still the one the caller showed. */
export function dismissPromptLinkNotice(id: number) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

export function currentPromptLinkNotice(): PromptLinkNotice | null {
  return current;
}

export function subscribePromptLinkNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
