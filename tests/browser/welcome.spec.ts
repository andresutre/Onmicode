import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1300, height: 900 } });

async function pickFolderWith(page: Page, path: string) {
  await page.evaluate((folder) => {
    const fixture = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const base = fixture.__TAURI_INTERNALS__.invoke;
    fixture.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command === "plugin:dialog|open") return Promise.resolve([folder]);
      if (command === "session_list_by_project") return Promise.resolve([]);
      return base(command, args);
    };
  }, path);
}

test("walks a fresh install through setup into its first project", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/workspace-performance.html?empty&welcome");
  const dialog = page.getByRole("dialog", { name: "Set up Onmicode" });
  const heading = (name: string) =>
    dialog.getByRole("heading", { name, exact: true });
  await expect(heading("Welcome to Onmicode")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Try the new layout" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Get started", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("welcome.png") });

  await page.keyboard.press("Enter");
  await expect(heading("Your coding agents")).toBeVisible();
  // The fixture has no agent CLIs, so only the primary three are listed.
  await expect(
    dialog.getByRole("list", { name: "Coding agents" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(dialog.getByText("Not installed.").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("welcome-agents.png") });

  await page.keyboard.press("Enter");
  await expect(heading("Pick a first project")).toBeVisible();
  await pickFolderWith(page, "/fixture/first-project");
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByText("first-project", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Continue", exact: true }),
  ).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(heading("Choose a look")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("welcome-look.png") });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(heading("You're all set")).toBeVisible();
  await expect(dialog).toContainText("first-project opens in a new session.");
  await page.screenshot({ path: testInfo.outputPath("welcome-done.png") });
  await dialog
    .getByRole("button", { name: "Start coding", exact: true })
    .click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("first-project").first()).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Try the new layout" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("monocode.welcomeCompleted"),
    ),
  ).toBe("1");

  await page.reload();
  await expect(page.getByText("first-project").first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("never greets an existing workspace, and reopens from the palette", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-performance.html?welcome");
  await expect(
    page.locator('[data-session-drop="workspace-session-0"]'),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("monocode.welcomeCompleted")),
    )
    .toBe("1");

  const modifier = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+Shift+P`);
  await page.keyboard.type("Show Welcome");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Set up Onmicode" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Get started", exact: true }),
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
