import { describe, expect, it } from "vitest";
import { shellPath } from "./shellPath";

describe("shellPath", () => {
  it("quotes the control path only when the shell needs it", () => {
    expect(
      shellPath("/Applications/MonoCode.app/Contents/MacOS/monocode"),
    ).toBe("/Applications/MonoCode.app/Contents/MacOS/monocode");
    expect(shellPath("/Users/a b/MonoCode")).toBe("'/Users/a b/MonoCode'");
    expect(shellPath("C:/Program Files/MonoCode/monocode.exe")).toBe(
      '"C:/Program Files/MonoCode/monocode.exe"',
    );
    expect(shellPath("C:\Tools\monocode.exe")).toBe(
      "C:\Tools\monocode.exe",
    );
    // A backslash escapes in a POSIX shell, so bare would rewrite the path.
    expect(shellPath("/Users/a\b/MonoCode")).toBe("'/Users/a\b/MonoCode'");
    expect(shellPath("/Users/it's/MonoCode")).toBe(
      "'/Users/it'\''s/MonoCode'",
    );
  });
});
