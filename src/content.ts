import { detect, type Detection } from "./detect";
import { send, type CheckResponse } from "./messages";
import { isAllowlisted, loadSettings, onSettingsChanged, type Settings } from "./settings";

/**
 * Watches the page's images, asks the background worker to inspect each one
 * as it nears the viewport, and marks the ones labelled as AI-generated.
 * All styling lives in content.css, keyed off data attributes, so changing
 * mode is just a matter of rewriting one attribute.
 */

const ATTR = "data-aiblock"; // "blocked" | "revealed"
const MODE_ATTR = "data-aiblock-mode";
const MIN_SIZE = 48; // px; skip icons, avatars-in-lists, tracking pixels

let settings: Settings;
const checked = new WeakMap<HTMLImageElement, string>(); // img -> last URL inspected
const flagged = new Set<HTMLImageElement>();

const active = () => settings.enabled && !isAllowlisted(location.hostname, settings.allowlist);

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
  return send<CheckResponse>({ type: "check", url, heuristics: settings.heuristics });
};

const mark = (img: HTMLImageElement, d: Detection) => {
  if (flagged.has(img)) return;
  flagged.add(img);
  img.setAttribute(ATTR, "blocked");
  img.setAttribute(MODE_ATTR, settings.mode);
  img.dataset.aiblockReason = d.reasons.join("\n");
  if (!img.hasAttribute("data-aiblock-title")) img.setAttribute("data-aiblock-title", img.title);
  img.title = `Hidden by Block AI Content\n${d.reasons.map((r) => `• ${r}`).join("\n")}\n\nClick to show.`;
  void send({ type: "blocked" });
};

const unmark = (img: HTMLImageElement) => {
  flagged.delete(img);
  img.removeAttribute(ATTR);
  img.removeAttribute(MODE_ATTR);
  delete img.dataset.aiblockReason;
  img.title = img.getAttribute("data-aiblock-title") ?? "";
  img.removeAttribute("data-aiblock-title");
};

const consider = async (img: HTMLImageElement) => {
  if (!active() || tooSmall(img)) return;
  const url = urlOf(img);
  if (!url || checked.get(img) === url) return;
  checked.set(img, url);
  // The image changed source (carousels, responsive srcset); start clean.
  if (flagged.has(img)) unmark(img);

  const result = await inspect(url);
  if (checked.get(img) !== url || !active()) return; // superseded meanwhile
  if ("ai" in result && result.ai) mark(img, result);
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
  root.querySelectorAll?.("img").forEach((img) => viewport.observe(img));
};

const mutations = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "attributes") {
      // src/srcset swapped on an existing image: look at it again.
      if (!(r.target instanceof HTMLImageElement)) continue;
      viewport.unobserve(r.target);
      viewport.observe(r.target);
    } else {
      r.addedNodes.forEach((n) => n instanceof Element && watch(n));
    }
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

// First click on a hidden image reveals it rather than following any link it
// sits inside. The next click behaves normally.
document.addEventListener(
  "click",
  (e) => {
    const img = (e.target as Element | null)?.closest?.(`img[${ATTR}="blocked"]`);
    if (!(img instanceof HTMLImageElement) || settings.mode === "label") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    img.setAttribute(ATTR, "revealed");
  },
  true,
);

// --- settings ---------------------------------------------------------------

const apply = () => {
  if (!active()) {
    flagged.forEach(unmark);
    return;
  }
  flagged.forEach((img) => img.setAttribute(MODE_ATTR, settings.mode));
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
  mutations.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset"],
  });
  onSettingsChanged((next) => {
    const recheck = next.heuristics !== settings.heuristics;
    settings = next;
    if (recheck) flagged.forEach(unmark);
    apply();
  });
});
