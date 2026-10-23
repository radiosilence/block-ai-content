import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { type BrowserContext, test as base, chromium, type Worker } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, "dist");
export const fixture = (name: string) => readFileSync(path.join(ROOT, "tests/fixtures", name));

export interface Hit {
  path: string;
  range?: string;
}

/**
 * A tiny HTTP server: serves HTML from `pages`, images from tests/fixtures,
 * honours `Range: bytes=0-N` like a real CDN, and logs every request so tests
 * can assert on what the extension downloaded.
 */
const serve = (pages: Record<string, string>) =>
  new Promise<{ server: Server; origin: string; hits: Hit[] }>((resolve) => {
    const hits: Hit[] = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      hits.push({ path: url.pathname, range: req.headers.range });
      const page = pages[url.pathname];
      if (page !== undefined) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(page);
      }
      let body: Buffer;
      try {
        body = fixture(path.basename(url.pathname));
      } catch {
        res.writeHead(404);
        return res.end();
      }
      const m = /^bytes=0-(\d+)$/.exec(req.headers.range ?? "");
      if (m) {
        const end = Math.min(Number(m[1]), body.length - 1);
        res.writeHead(206, {
          "content-type": "image/jpeg",
          "content-range": `bytes 0-${end}/${body.length}`,
          "content-length": end + 1,
        });
        return res.end(body.subarray(0, end + 1));
      }
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": body.length });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}`, hits });
    });
  });

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  site: (pages: Record<string, string>) => Promise<{ origin: string; hits: Hit[] }>;
  setSettings: (patch: Record<string, unknown>) => Promise<void>;
  badge: (urlPattern: string) => Promise<string>;
}

export const test = base.extend<Fixtures>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the {} parameter
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium", // the full browser, whose headless mode runs extensions
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    await use(worker);
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires the {} parameter
  site: async ({}, use) => {
    const servers: Server[] = [];
    await use(async (pages) => {
      const s = await serve(pages);
      servers.push(s.server);
      return s;
    });
    for (const s of servers) s.close();
  },
  setSettings: async ({ worker }, use) => {
    await use((patch) => worker.evaluate((p) => chrome.storage.sync.set(p), patch));
  },
  badge: async ({ worker }, use) => {
    await use((pattern) =>
      worker.evaluate(async (url) => {
        const [tab] = await chrome.tabs.query({ url });
        return tab?.id === undefined ? "" : chrome.action.getBadgeText({ tabId: tab.id });
      }, pattern),
    );
  },
});

export const expect = test.expect;

/** data-aiblock state of every <img>/<video> with an id. */
export const states = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("img[id], video[id]")].map((el) => [el.id, el.getAttribute("data-aiblock")]),
    ),
  );
