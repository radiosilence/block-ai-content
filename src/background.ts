import { type Detection, detect } from "./detect";
import type { CheckResponse, Request } from "./messages";

/**
 * The service worker does the fetching. Content scripts can't read the bytes
 * of cross-origin images (CORS), but an extension with host permissions can.
 *
 * Chrome partitions its HTTP cache by top-level site, so these requests rarely
 * hit the copy the page already downloaded. To keep the cost down:
 *  - ask for just the first 256 KB, which holds all of a JPEG's metadata, and
 *    only fetch the rest if the parser says the label could be further in;
 *  - remember verdicts per URL, in memory and in session storage, so they
 *    survive Chrome stopping the idle service worker.
 */

const HEAD_BYTES = 256 * 1024;
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;
const CACHE_LIMIT = 3000;

type Verdict = Pick<Detection, "ai" | "c2pa" | "reasons">;

const memo = new Map<string, Promise<CheckResponse>>();

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

interface Download {
  bytes: Uint8Array;
  /** Only the start of the file (the server honoured our Range, or we hit MAX_BYTES). */
  truncated: boolean;
}

const download = async (url: string, range?: number): Promise<Download> => {
  const res = await fetch(url, {
    credentials: "omit",
    cache: "force-cache",
    headers: range ? { Range: `bytes=0-${range - 1}` } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const partial = res.status === 206;
  if (!partial && Number(res.headers.get("content-length")) > MAX_BYTES) throw new Error("too large");

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let done = false;
  while (total < MAX_BYTES) {
    const r = await reader.read();
    if (r.done) {
      done = true;
      break;
    }
    chunks.push(r.value);
    total += r.value.length;
  }
  if (!done) void reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(total, MAX_BYTES));
  let o = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, bytes.length - o);
    bytes.set(c.subarray(0, n), o);
    o += n;
  }
  // A 206 covering the whole file (e.g. "bytes 0-999/1000") isn't really partial.
  const size = Number(res.headers.get("content-range")?.split("/")[1]);
  return { bytes, truncated: !done || (partial && !(size > 0 && bytes.length >= size)) };
};

const inspect = async (url: string, heuristics: boolean): Promise<Verdict> => {
  const head = await download(url, HEAD_BYTES);
  const first = await detect(head.bytes, { heuristics }, head.truncated);
  if (first.ai || first.complete) return first;
  const full = await download(url);
  return detect(full.bytes, { heuristics }, full.truncated);
};

// --- verdict cache that outlives the service worker -------------------------

const storeKey = (key: string) => `v:${key}`;

const recall = async (key: string): Promise<Verdict | undefined> =>
  (await chrome.storage.session.get(storeKey(key)))[storeKey(key)] as Verdict | undefined;

const remember = async (key: string, v: Verdict): Promise<void> => {
  const entry = { [storeKey(key)]: { ai: v.ai, c2pa: v.c2pa, reasons: v.reasons } };
  try {
    await chrome.storage.session.set(entry);
  } catch {
    // Session storage is full (10 MB): drop all remembered verdicts, keep going.
    const all = await chrome.storage.session.get(null);
    await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith("v:")));
    await chrome.storage.session.set(entry).catch(() => {});
  }
};

const check = (url: string, heuristics: boolean): Promise<CheckResponse> => {
  const key = `${heuristics ? 1 : 0}:${url}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const pending = (async (): Promise<CheckResponse> => {
    const stored = await recall(key);
    if (stored) return { ...stored, complete: true };
    try {
      const v = await limit(() => inspect(url, heuristics));
      await remember(key, v);
      return { ...v, complete: true };
    } catch (e) {
      // Don't remember failures: a timeout or blip now shouldn't stick.
      memo.delete(key);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  })();
  memo.set(key, pending);
  const oldest = memo.keys().next().value;
  if (memo.size > CACHE_LIMIT && oldest !== undefined) memo.delete(oldest);
  return pending;
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
