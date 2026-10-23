import { detect } from "./detect";
import { type CheckResponse, send } from "./messages";
import { findLabels, isMetaHost, mediaIn, platformName, postFor } from "./platforms/meta";
import { isAllowlisted, loadSettings, onSettingsChanged, type Settings } from "./settings";

/**
 * Two ways in:
 *  1. Every site: inspect each image's file for an embedded AI label.
 *  2. Facebook / Instagram / Threads: those strip file metadata, so read the
 *     "AI info" label Meta puts on the post and hide that post's media.
 *
 * All styling lives in content.css, keyed off data attributes, so changing
 * mode is just a matter of rewriting one attribute.
 */

type Media = HTMLImageElement | HTMLVideoElement;

const ATTR = "data-aiblock"; // "blocked" | "revealed"
const MODE_ATTR = "data-aiblock-mode";
const POST_ATTR = "data-aiblock-post";
const MIN_SIZE = 48; // px; skip icons, avatars-in-lists, tracking pixels

let settings: Settings;
const checked = new WeakMap<HTMLImageElement, string>(); // img -> last URL inspected
const flagged = new Set<Media>();
const posts = new Map<Element, Element>(); // flagged post -> the label that flagged it

const onMeta = isMetaHost(location.hostname);

/**
 * After the extension is updated or reloaded, content scripts already running
 * in open tabs are orphaned: every chrome.* call throws. Notice that once and
 * go quiet rather than throwing on every image until the tab is refreshed.
 */
let orphaned = false;
const alive = () => {
  if (!orphaned && !chrome.runtime?.id) orphaned = true;
  return !orphaned;
};
const sendSafe = async <T>(msg: Parameters<typeof send>[0]): Promise<T | undefined> => {
  if (!alive()) return undefined;
  try {
    return await send<T>(msg);
  } catch {
    orphaned = !chrome.runtime?.id;
    return undefined;
  }
};

const active = () => alive() && settings.enabled && !isAllowlisted(location.hostname, settings.allowlist);
const useLabels = () => onMeta && settings.platformLabels && active();

// --- marking ----------------------------------------------------------------

const mark = (el: Media, reasons: string[]) => {
  if (flagged.has(el)) return;
  flagged.add(el);
  el.setAttribute(ATTR, "blocked");
  el.setAttribute(MODE_ATTR, settings.mode);
  if (!el.hasAttribute("data-aiblock-title")) el.setAttribute("data-aiblock-title", el.title);
  el.title = `Hidden by Block AI Content\n${reasons.map((r) => `• ${r}`).join("\n")}\n\nClick to show.`;
  if (el instanceof HTMLVideoElement && settings.mode !== "label") el.pause();
  void sendSafe({ type: "blocked" });
};

const unmark = (el: Media) => {
  flagged.delete(el);
  el.removeAttribute(ATTR);
  el.removeAttribute(MODE_ATTR);
  el.title = el.getAttribute("data-aiblock-title") ?? "";
  el.removeAttribute("data-aiblock-title");
};

// --- 1. file metadata -------------------------------------------------------

const urlOf = (img: HTMLImageElement): string | null => {
  const src = img.currentSrc || img.src;
  return /^(https?|data|blob):/.test(src) ? src : null;
};

const tooSmall = (img: HTMLImageElement): boolean => {
  if (!img.complete) return false; // dimensions unknown yet; check anyway
  return img.naturalWidth < MIN_SIZE && img.naturalHeight < MIN_SIZE;
};

const inspect = async (url: string): Promise<CheckResponse> => {
  // data: and blob: URLs only make sense in this document, so read them here.
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    try {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return await detect(bytes, { heuristics: settings.heuristics });
    } catch (e) {
      return { error: String(e) };
    }
  }
  return (
    (await sendSafe<CheckResponse>({ type: "check", url, heuristics: settings.heuristics })) ?? { error: "orphaned" }
  );
};

const consider = async (img: HTMLImageElement) => {
  if (!active() || tooSmall(img)) return;
  if (inFlaggedPost(img)) return; // already handled by its post's label
  const url = urlOf(img);
  if (!url || checked.get(img) === url) return;
  checked.set(img, url);
  // The image changed source (carousels, responsive srcset); start clean.
  if (flagged.has(img)) unmark(img);

  const result = await inspect(url);
  if (checked.get(img) !== url || !active()) return; // superseded meanwhile
  if ("ai" in result && result.ai) mark(img, result.reasons);
};

// --- 2. platform labels (Meta) ----------------------------------------------

const labelReason = () => [`${platformName(location.hostname)} labelled this post "AI info"`];

/**
 * A post stays flagged only while the label that flagged it is still inside
 * it. React reuses DOM nodes, and we don't want a recycled container to keep
 * hiding whatever post moves into it next.
 */
const postStillLabelled = (post: Element): boolean => {
  const label = posts.get(post);
  return !!label && label.isConnected && post.contains(label);
};

const unflagPost = (post: Element) => {
  posts.delete(post);
  post.removeAttribute(POST_ATTR);
  for (const el of mediaIn(post)) if (flagged.has(el)) unmark(el);
};

const inFlaggedPost = (el: Element): boolean => {
  if (!useLabels()) return false;
  const post = el.closest(`[${POST_ATTR}]`);
  if (!post) return false;
  if (postStillLabelled(post)) {
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      if (mediaIn(post).includes(el)) mark(el, labelReason());
    }
    return true;
  }
  unflagPost(post);
  return false;
};

const scanLabels = (root: Node) => {
  if (!useLabels()) return;
  for (const label of findLabels(root)) {
    const post = postFor(label);
    if (!post) continue;
    posts.set(post, label);
    post.setAttribute(POST_ATTR, "");
    for (const el of mediaIn(post)) mark(el, labelReason());
  }
};

/**
 * Re-validate flagged posts after DOM changes and pick up media added to them.
 * Also forget elements that have left the page, so an hour of infinite scroll
 * doesn't keep thousands of dead nodes alive.
 */
const refreshPosts = () => {
  for (const el of flagged) if (!el.isConnected) flagged.delete(el);
  for (const post of posts.keys()) {
    if (!postStillLabelled(post)) unflagPost(post);
    else for (const el of mediaIn(post)) mark(el, labelReason());
  }
};

// --- discovery --------------------------------------------------------------

const viewport = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) void consider(e.target as HTMLImageElement);
  },
  { rootMargin: "1500px 0px" },
);

const watch = (root: ParentNode) => {
  if (root instanceof HTMLImageElement) viewport.observe(root);
  for (const img of root.querySelectorAll?.("img") ?? []) viewport.observe(img);
};

let refreshQueued = false;
const mutations = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "attributes") {
      // src/srcset swapped on an existing image: look at it again.
      if (!(r.target instanceof HTMLImageElement)) continue;
      viewport.unobserve(r.target);
      viewport.observe(r.target);
    } else {
      r.addedNodes.forEach((n) => {
        if (n instanceof Element) watch(n);
        if (n instanceof Element || n.nodeType === Node.TEXT_NODE) scanLabels(n);
      });
    }
  }
  if ((posts.size > 0 || flagged.size > 0) && !refreshQueued) {
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshPosts();
    });
  }
});

// `load` doesn't bubble, but it does pass through the capture phase. This
// catches lazy-loaded images and srcset picking a different candidate.
document.addEventListener(
  "load",
  (e) => {
    if (e.target instanceof HTMLImageElement) void consider(e.target);
  },
  true,
);

// First click on hidden media reveals it rather than following any link it
// sits inside. The next click behaves normally.
document.addEventListener(
  "click",
  (e) => {
    const el = (e.target as Element | null)?.closest?.(`[${ATTR}="blocked"]`);
    if (!el || settings.mode === "label") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    el.setAttribute(ATTR, "revealed");
  },
  true,
);

// Sites (Facebook especially) autoplay video as it scrolls into view. Keep
// hidden videos paused until revealed. `play` doesn't bubble; capture it.
document.addEventListener(
  "play",
  (e) => {
    const v = e.target;
    if (v instanceof HTMLVideoElement && v.getAttribute(ATTR) === "blocked" && settings.mode !== "label") v.pause();
  },
  true,
);

// --- settings ---------------------------------------------------------------

const reset = () => {
  flagged.forEach(unmark);
  [...posts.keys()].forEach(unflagPost);
};

const apply = () => {
  if (!active()) return reset();
  if (!useLabels()) [...posts.keys()].forEach(unflagPost);
  flagged.forEach((el) => {
    el.setAttribute(MODE_ATTR, settings.mode);
    if (el instanceof HTMLVideoElement && settings.mode !== "label" && el.getAttribute(ATTR) === "blocked") el.pause();
  });
  scanLabels(document.body);
  // Re-examine everything not already flagged (cheap: the worker memoises).
  document.querySelectorAll("img").forEach((img) => {
    if (flagged.has(img)) return;
    checked.delete(img);
    viewport.unobserve(img);
    viewport.observe(img);
  });
};

void loadSettings().then((s) => {
  settings = s;
  watch(document);
  scanLabels(document.body);
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });
  onSettingsChanged((next) => {
    const recheck = next.heuristics !== settings.heuristics;
    settings = next;
    if (recheck) reset();
    apply();
  });
});
