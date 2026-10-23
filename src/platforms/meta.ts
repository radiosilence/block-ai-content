/**
 * Facebook, Instagram and Threads re-encode uploads and throw the file
 * metadata away, so by the time an image reaches the browser there's no label
 * left to read. Meta does read that metadata on upload, though, and shows its
 * own "AI info" label on the post. On those sites we find that label in the
 * page and hide the media in the post it belongs to.
 *
 * Meta's markup is generated and changes often, so nothing here relies on
 * class names: only on the label's text, ARIA roles, and page structure.
 */

const HOSTS = /(^|\.)(facebook\.com|instagram\.com|threads\.net|threads\.com)$/;

/** The label text Meta shows (English UI). "Made with AI" was the pre-2024 wording. */
const LABELS = new Set(["ai info", "made with ai"]);

/** Ancestors that explicitly mark out one post (or comment, or photo viewer). */
const POST = '[role="article"], article, [aria-posinset], [data-pagelet^="FeedUnit"], [role="dialog"]';

/** Never climb into these: they hold many posts. */
const STOP = '[role="feed"], [role="main"], main, body';

/** Smaller than this is an avatar, emoji or icon, not the post's media. */
const MIN_MEDIA_PX = 100;

export const isMetaHost = (host: string): boolean => HOSTS.test(host.toLowerCase());

export const platformName = (host: string): string => {
  const h = host.toLowerCase();
  if (h.includes("instagram")) return "Instagram";
  if (h.includes("threads")) return "Threads";
  return "Facebook";
};

const isLabelText = (s: string | null | undefined): boolean => !!s && LABELS.has(s.trim().toLowerCase());

/** Elements in (or equal to) `root` that are Meta's AI label. */
export const findLabels = (root: Node): Element[] => {
  const found = new Set<Element>();
  const doc = root.ownerDocument ?? (root as Document);

  if (root.nodeType === Node.TEXT_NODE) {
    if (isLabelText(root.textContent) && root.parentElement) found.add(root.parentElement);
    return [...found];
  }
  if (!(root instanceof Element || root instanceof Document)) return [];

  // Visible text. Comparing whole text nodes keeps this cheap and avoids
  // matching posts that merely mention "AI info" in a sentence.
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (isLabelText(n.textContent) && n.parentElement) found.add(n.parentElement);
  }
  // Icon-only buttons that carry the label in aria-label.
  if (root instanceof Element && isLabelText(root.getAttribute("aria-label"))) found.add(root);
  root.querySelectorAll("[aria-label]").forEach((el) => {
    if (isLabelText(el.getAttribute("aria-label"))) found.add(el);
  });
  return [...found];
};

const isBigEnough = (el: HTMLImageElement | HTMLVideoElement): boolean => {
  if (el instanceof HTMLVideoElement) return true;
  // Judge by how big it's drawn: avatars are often served far larger than shown.
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return Math.max(rect.width, rect.height) >= MIN_MEDIA_PX;
  // Not laid out yet (or hidden): fall back to declared, then intrinsic, size.
  return (el.getAttribute("width") ? el.width : el.naturalWidth) >= MIN_MEDIA_PX;
};

/** The post's images and videos, minus avatars and icons. */
export const mediaIn = (root: Element): Array<HTMLImageElement | HTMLVideoElement> => {
  const all = root.matches("img, video") ? [root] : [...root.querySelectorAll("img, video")];
  return all.filter(
    (el): el is HTMLImageElement | HTMLVideoElement =>
      (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) && isBigEnough(el),
  );
};

/** The post a label belongs to, or null if we can't tell safely. */
export const postFor = (label: Element): Element | null => {
  const explicit = label.closest(POST);
  if (explicit) return explicit;
  // No ARIA landmarks: climb to the nearest ancestor that holds media, but
  // stop before reaching anything that contains other posts.
  for (let el = label.parentElement, depth = 0; el && depth < 25; el = el.parentElement, depth++) {
    if (el.matches(STOP)) return null;
    if (mediaIn(el).length > 0) return el;
  }
  return null;
};
