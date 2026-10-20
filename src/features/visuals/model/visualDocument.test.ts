import { describe, expect, it } from "vitest";
import {
  clampVisualHeight,
  readVisualMessage,
  VISUAL_MAX_HEIGHT,
  VISUAL_MIN_HEIGHT,
  VISUAL_PAGE_CSP,
  visualDocument,
  visualExportDocument,
  visualFileName,
  visualThemeMessage,
  type VisualTheme,
} from "./visualDocument";

const theme: VisualTheme = {
  scheme: "light",
  vars: { "--background": "rgb(250, 250, 250)", "--accent": "rgb(1, 2, 3)" },
};

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${VISUAL_PAGE_CSP}">`;

describe("visual documents", () => {
  it("puts the CSP, theme and bootstrap first in the page's head", () => {
    const page = visualDocument(
      '<!doctype html><html lang="en"><head><title>Chart</title></head><body><p>hi</p></body></html>',
      theme,
    );
    expect(page.startsWith('<!doctype html><html lang="en"><head><meta')).toBe(
      true,
    );
    expect(page).toContain(CSP_META);
    expect(page.indexOf(CSP_META)).toBeLessThan(page.indexOf("<title>"));
    expect(page.indexOf("<script>")).toBeLessThan(page.indexOf("<title>"));
    expect(page).toContain(
      ":root{color-scheme:light;--background:rgb(250, 250, 250);",
    );
  });

  it("never goes before the doctype, and wraps a bare fragment", () => {
    expect(
      visualDocument("<!DOCTYPE html>\n<body>x</body>", theme).startsWith(
        "<!DOCTYPE html><meta",
      ),
    ).toBe(true);
    expect(
      visualDocument("<html><body>x</body></html>", theme).startsWith(
        "<html><meta",
      ),
    ).toBe(true);
    const fragment = visualDocument("<div>chart</div>", theme);
    expect(fragment.startsWith('<meta charset="utf-8">')).toBe(true);
    expect(fragment.endsWith("</script><div>chart</div>")).toBe(true);
  });

  it("skips a head tag written inside a comment or a script", () => {
    const html =
      '<!-- <head> --><script>const t = "<head>";</script><html><head></head></html>';
    const page = visualDocument(html, theme);
    expect(
      page.startsWith(
        '<!-- <head> --><script>const t = "<head>";</script><html><head><meta charset="utf-8">',
      ),
    ).toBe(true);
  });

  it("keeps the page's own charset and viewport", () => {
    const page = visualDocument(
      '<head><meta charset="utf-8"><meta name="viewport" content="width=500"></head>',
      theme,
    );
    expect(page.match(/charset/g)).toHaveLength(1);
    expect(page.match(/name="viewport"/g)).toHaveLength(1);
  });

  it("drops theme values that could escape the style element", () => {
    const page = visualDocument("<p>x</p>", {
      scheme: "dark",
      vars: {
        "--accent": "red;}</style><script>alert(1)</script>",
        "bad name": "blue",
      },
    });
    expect(page).not.toContain("</style><script>alert");
    expect(page).not.toContain("bad name");
    expect(page).toContain("--accent:red/stylescriptalert(1)/script;");
  });

  it("ships a bootstrap that parses", () => {
    const page = visualDocument("<p>x</p>", theme);
    const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it("saves a page that keeps the theme and CSP but never talks to the app", () => {
    const page = visualExportDocument("<p>x</p>", theme);
    expect(page).toContain(CSP_META);
    expect(page).toContain("html{background:var(--background);");
    expect(page).toContain("body{margin:24px}");
    expect(page).not.toContain("<script>");
    expect(page).not.toContain("postMessage");
  });

  it("blocks all network access in its policy", () => {
    expect(VISUAL_PAGE_CSP).toContain("default-src 'none'");
    expect(VISUAL_PAGE_CSP).toContain("connect-src 'none'");
    expect(VISUAL_PAGE_CSP).not.toMatch(/https?:|\*/);
  });
});

describe("visual messages", () => {
  it("reads heights, web links and Escape, and nothing else", () => {
    expect(
      readVisualMessage({ type: "onmicode:visual-height", height: 320.5 }),
    ).toEqual({ type: "height", height: 320.5 });
    expect(
      readVisualMessage({
        type: "onmicode:visual-link",
        url: "https://example.com/a",
      }),
    ).toEqual({ type: "link", url: "https://example.com/a" });
    expect(readVisualMessage({ type: "onmicode:visual-escape" })).toEqual({
      type: "escape",
    });
    for (const data of [
      null,
      "onmicode:visual-height",
      { type: "onmicode:visual-height", height: -1 },
      { type: "onmicode:visual-height", height: Number.NaN },
      { type: "onmicode:visual-height", height: "200" },
      { type: "onmicode:visual-link", url: "file:///etc/passwd" },
      { type: "onmicode:visual-link", url: "javascript:alert(1)" },
      { type: "onmicode:visual-theme" },
    ]) {
      expect(readVisualMessage(data)).toBeNull();
    }
  });

  it("clamps a reported height", () => {
    expect(clampVisualHeight(10)).toBe(VISUAL_MIN_HEIGHT);
    expect(clampVisualHeight(240.2)).toBe(241);
    expect(clampVisualHeight(1e9)).toBe(VISUAL_MAX_HEIGHT);
  });

  it("posts the theme in the shape the bootstrap reads", () => {
    expect(visualThemeMessage(theme)).toEqual({
      type: "onmicode:visual-theme",
      scheme: "light",
      vars: theme.vars,
    });
  });
});

describe("visual file names", () => {
  it("keeps a title that is safe on every platform", () => {
    expect(visualFileName('Q3: "sales" / region?')).toBe(
      "Q3 sales region.html",
    );
    expect(visualFileName("   ")).toBe("Visual.html");
  });
});
