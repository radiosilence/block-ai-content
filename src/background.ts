import { detect } from "./detect";
import type { CheckResponse, Request } from "./messages";

/**
 * The service worker does the fetching. Content scripts can't read the bytes
 * of cross-origin images (CORS), but an extension with host permissions can.
 * Requests are cookie-less and prefer the HTTP cache, but Chrome partitions
 * that cache by top-level site, so expect most images to be downloaded a second
 * time. Results are memoised per URL to keep that to once per session.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;
const CACHE_LIMIT = 3000;

const cache = new Map<string, Promise<CheckResponse>>();

let active = 0;
const waiting: Array<() => void> = [];
const limit = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (active >= CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
};

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const res = await fetch(url, {
    credentials: "omit",
    cache: "force-cache",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new Error("too large");

  // Read up to MAX_BYTES; metadata is nearly always near the start, so a
  // truncated read of a huge file is still worth inspecting.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  void reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, MAX_BYTES));
  let o = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, out.length - o);
    out.set(c.subarray(0, n), o);
    o += n;
  }
  return out;
};

const check = (url: string, heuristics: boolean): Promise<CheckResponse> => {
  const key = `${heuristics ? 1 : 0}:${url}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = limit(async (): Promise<CheckResponse> => {
      try {
        return await detect(await fetchBytes(url), { heuristics });
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
    cache.set(key, hit);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return hit;
};

// --- per-tab blocked counter, shown on the toolbar badge --------------------

const countKey = (tabId: number) => `count:${tabId}`;

const getCount = async (tabId: number): Promise<number> =>
  ((await chrome.storage.session.get(countKey(tabId)))[countKey(tabId)] as number | undefined) ?? 0;

const setCount = async (tabId: number, n: number): Promise<void> => {
  await chrome.storage.session.set({ [countKey(tabId)]: n });
  await chrome.action.setBadgeText({ tabId, text: n > 0 ? String(n) : "" });
};

// Serialise increments so concurrent messages from many frames don't race.
let queue = Promise.resolve();
const bump = (tabId: number) => {
  queue = queue.then(async () => setCount(tabId, (await getCount(tabId)) + 1)).catch(() => {});
};

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) void setCount(tabId, 0);
});
chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(countKey(tabId)));

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
});

chrome.runtime.onMessage.addListener((msg: Request, sender, reply) => {
  switch (msg.type) {
    case "check":
      void check(msg.url, msg.heuristics).then(reply);
      return true; // async reply
    case "blocked":
      if (sender.tab?.id !== undefined) bump(sender.tab.id);
      return false;
    case "count":
      void getCount(msg.tabId).then(reply);
      return true;
  }
});
