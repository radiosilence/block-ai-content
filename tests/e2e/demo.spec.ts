import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, states, test } from "./fixtures";

// The GitHub Pages test page (site/index.html) should report success on its own.
const DEMO = readFileSync(path.resolve(import.meta.dirname, "../../site/index.html"), "utf8");

test("the public test page reports the extension as working", async ({ context, site }) => {
  const { origin } = await site({ "/": DEMO });
  const page = await context.newPage();
  await page.goto(origin);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ok", { timeout: 10_000 });
  await expect(page.locator("#status")).toContainText("It's working");
  expect(await states(page)).toEqual({ ai: "blocked", signed: null, plain: null });
});

test("the public test page says so when the extension is switched off", async ({ context, site, setSettings }) => {
  await setSettings({ enabled: false });
  const { origin } = await site({ "/": DEMO });
  const page = await context.newPage();
  await page.goto(origin);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "bad", { timeout: 15_000 });
  await expect(page.locator("#status")).toContainText("doesn't seem to be running");
});
