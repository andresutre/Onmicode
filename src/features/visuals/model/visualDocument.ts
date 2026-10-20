/** The app theme as the CSS variables a page can use. */
export type VisualTheme = {
  scheme: "dark" | "light";
  vars: Readonly<Record<string, string>>;
};

/** A larger page shows as code. The backend refuses anything past 1 MB. */
export const VISUAL_MAX_BYTES = 512 * 1024;
export const VISUAL_MIN_HEIGHT = 80;
/** Bounds a page whose height grows with its frame, such as one using 100vh. */
export const VISUAL_MAX_HEIGHT = 2000;

/**
 * The policy the page is also served with. Repeating it in the document keeps
 * a saved copy opened in a browser as cut off from the network as in the app.
 */
export const VISUAL_PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; " +
  "frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";

const THEME_MESSAGE = "onmicode:visual-theme";
const HEIGHT_MESSAGE = "onmicode:visual-height";
const LINK_MESSAGE = "onmicode:visual-link";
const ESCAPE_MESSAGE = "onmicode:visual-escape";
const THEME_STYLE_ID = "onmicode-visual-theme";

// The page paints the chat's own background color rather than relying on the
// frame being transparent; see the frame's color scheme in VisualFrame.
const BASE_CSS =
  "html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}" +
  "body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}a{color:var(--link)}";

// A saved page opens on its own, so it gets some room.
const EXPORT_CSS = "body{margin:24px}";

/**
 * Runs first in the page. It applies the theme the app posts, reports the
 * content height so the frame can fit it, hands web links to the app instead
 * of navigating the frame, and passes Escape on so a dialog can still close.
 */
const BOOTSTRAP = `(function(){
var style=document.getElementById(${JSON.stringify(THEME_STYLE_ID)}),base=${JSON.stringify(BASE_CSS)},height;
function post(message){if(parent!==window)parent.postMessage(message,"*");}
function applyTheme(theme){if(!style||!theme||!theme.vars||typeof theme.vars!=="object")return;var css=":root{color-scheme:"+(theme.scheme==="light"?"light":"dark")+";";for(var name in theme.vars){if(/^--[a-z0-9-]+$/.test(name))css+=name+":"+String(theme.vars[name]).replace(/[;{}<>]/g,"")+";";}style.textContent=css+"}"+base;}
window.addEventListener("message",function(event){var data=event.data;if(event.source===parent&&data&&data.type===${JSON.stringify(THEME_MESSAGE)})applyTheme(data);});
document.addEventListener("click",function(event){var link=event.target&&event.target.closest?event.target.closest("a[href]"):null,url;if(!link)return;try{url=new URL(link.getAttribute("href"),document.baseURI);}catch(error){return;}if(url.href.split("#")[0]===location.href.split("#")[0])return;event.preventDefault();if(event.isTrusted&&/^https?:$/.test(url.protocol))post({type:${JSON.stringify(LINK_MESSAGE)},url:url.href});},true);
document.addEventListener("keydown",function(event){if(event.key==="Escape"&&!event.defaultPrevented)post({type:${JSON.stringify(ESCAPE_MESSAGE)}});});
function measure(){var root=document.documentElement,next=Math.ceil(root.scrollHeight>root.clientHeight?root.scrollHeight:root.getBoundingClientRect().height);if(next===height)return;height=next;post({type:${JSON.stringify(HEIGHT_MESSAGE)},height:next});}
if(window.ResizeObserver){var observer=new ResizeObserver(measure);observer.observe(document.documentElement);document.addEventListener("DOMContentLoaded",function(){if(document.body)observer.observe(document.body);});}
document.addEventListener("DOMContentLoaded",measure);window.addEventListener("load",measure);
})();`;

function themeRule(theme: VisualTheme): string {
  let css = `:root{color-scheme:${theme.scheme === "light" ? "light" : "dark"};`;
  for (const [name, value] of Object.entries(theme.vars)) {
    if (/^--[a-z0-9-]+$/.test(name))
      css += `${name}:${value.replace(/[;{}<>]/g, "")};`;
  }
  return `${css}}`;
}

/** The page the frame loads: the agent's HTML with the theme and bootstrap first. */
export function visualDocument(html: string, theme: VisualTheme): string {
  return withHead(
    html,
    `<style id="${THEME_STYLE_ID}">${themeRule(theme)}${BASE_CSS}</style><script>${BOOTSTRAP}</script>`,
  );
}

/** A copy to save: the same page and theme, but nothing that talks to the app. */
export function visualExportDocument(html: string, theme: VisualTheme): string {
  return withHead(
    html,
    `<style>${themeRule(theme)}${BASE_CSS}${EXPORT_CSS}</style>`,
  );
}

function withHead(html: string, markup: string): string {
  const scan = markupOnly(html);
  const head = [
    /<meta\s[^>]*charset/i.test(scan.slice(0, 4096))
      ? ""
      : '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${VISUAL_PAGE_CSP}">`,
    /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(scan)
      ? ""
      : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    markup,
  ].join("");
  const at = headOffset(scan);
  return html.slice(0, at) + head + html.slice(at);
}

/**
 * Where the injected markup goes: the start of `<head>`, else just after
 * `<html>` or the doctype, else the very start. Before the doctype would
 * switch the page into quirks mode.
 */
function headOffset(scan: string): number {
  const head = /<head(?:\s[^>]*)?>/i.exec(scan);
  if (head) return head.index + head[0].length;
  const root = /<html(?:\s[^>]*)?>/i.exec(scan);
  if (root) return root.index + root[0].length;
  return /^\s*<!doctype[^>]*>/i.exec(scan)?.[0].length ?? 0;
}

// Comments and raw-text elements are blanked to their own length, so a tag
// written inside them is never mistaken for the page's and offsets still match.
function markupOnly(html: string): string {
  return html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|template|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
    (match) => " ".repeat(match.length),
  );
}

export function visualThemeMessage(theme: VisualTheme) {
  return { type: THEME_MESSAGE, scheme: theme.scheme, vars: theme.vars };
}

export type VisualMessage =
  | { type: "height"; height: number }
  | { type: "link"; url: string }
  | { type: "escape" };

/** A message from a page, if `data` is one. Only http(s) links are accepted. */
export function readVisualMessage(data: unknown): VisualMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as { type?: unknown; height?: unknown; url?: unknown };
  switch (message.type) {
    case HEIGHT_MESSAGE:
      return typeof message.height === "number" &&
        Number.isFinite(message.height) &&
        message.height > 0
        ? { type: "height", height: message.height }
        : null;
    case LINK_MESSAGE:
      return typeof message.url === "string" &&
        /^https?:\/\//i.test(message.url)
        ? { type: "link", url: message.url }
        : null;
    case ESCAPE_MESSAGE:
      return { type: "escape" };
    default:
      return null;
  }
}

export function clampVisualHeight(height: number): number {
  return Math.min(
    VISUAL_MAX_HEIGHT,
    Math.max(VISUAL_MIN_HEIGHT, Math.ceil(height)),
  );
}

export function visualFileName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  return `${name || "Visual"}.html`;
}
