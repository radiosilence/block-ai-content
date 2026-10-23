# Block AI Content

A Chrome extension that hides images labelled as AI-generated, including on
Facebook, Instagram and Threads. (Also works in Edge, Brave, Arc and other
Chromium browsers. iOS Safari is [tracked here](https://github.com/radiosilence/block-ai-content/issues).)

**Just want to install it? → [Installation guide](INSTALL.md)** (no technical knowledge needed)

![Hidden image placeholder](docs/screenshot.png)

## How it works

There's no reliable way to look at an image and tell whether AI made it. AI
detectors are bad at it and getting worse. What *does* work is reading the
labels AI vendors put inside the file:

| Signal | What it is | Who writes it |
| --- | --- | --- |
| **IPTC digital source type** `trainedAlgorithmicMedia` / `compositeWithTrainedAlgorithmicMedia` | The standard vocabulary for "a model made this (or part of it)", in XMP metadata or inside a C2PA manifest | OpenAI, Adobe Firefly, Google, Microsoft, Meta, … |
| **C2PA Content Credentials** | A signed provenance record embedded in the file (JPEG APP11, PNG `caBX`, WebP `C2PA`) | Same, plus cameras and editing tools (which aren't AI, so C2PA alone isn't treated as a signal) |
| **Generator leftovers** *(optional, on by default)* | Stable Diffusion `parameters`, ComfyUI `prompt`/`workflow`, InvokeAI metadata in PNG text chunks; Google's "Made with Google AI" credit | Local image-generation tools |

The EU AI Act (Article 50(2)) requires providers of generative AI systems to
mark their output in a machine-readable, detectable way. Under the Digital
Omnibus amendments the marking duty applies from **2 December 2026**, and the
Commission's transparency Code of Practice names C2PA-style provenance metadata
and invisible watermarks as the ways to do it. This extension reads the
metadata half of that.

### What it can't do

- **Invisible watermarks** (Google SynthID, Meta Video Seal, etc.) need the
  vendor's proprietary detector. They can't be checked in the browser.
- **Stripped metadata.** Most social platforms and many CDNs strip metadata on
  upload, taking the label with it. A screenshot removes it too. The Act puts
  the duty on the AI provider, not on every site that reposts the image.
- **Text.** AI text watermarking isn't deployed in any detectable form, and
  statistical "AI text detectors" have false positive rates that make them
  unfit for purpose.
- **Video and audio files** aren't inspected for embedded labels yet (C2PA supports them; contributions welcome). Videos *are* hidden on Meta sites via the post label.
- **CSS background images** aren't inspected, only `<img>` elements.

So: a false positive is very unlikely (the file has to say it's AI), but plenty
of AI content will get through.

### Facebook, Instagram and Threads

Meta re-encodes uploads and strips their metadata, so the file check above sees
nothing there. But Meta reads the IPTC/C2PA labels *at upload* and shows an
**"AI info"** label on the post. On those sites the extension finds that label
and hides the images and videos in its post:

- The label is matched by its exact text (or `aria-label`), never by class names,
  which Meta regenerates constantly. A post that merely *mentions* "AI info" in
  a sentence doesn't count.
- The post is the label's nearest `role="article"` / `<article>` /
  `aria-posinset` / feed-unit / dialog ancestor. Failing those, it's the nearest
  ancestor holding media, but never one containing the whole feed.
- Media drawn smaller than 100px (avatars, icons) is left alone.
- Media added to a flagged post later (carousels, lazy loading) is hidden too.
  If React reuses the post's container for a different post, the hidden media
  is shown again.
- **English UI only** for now; other languages show translated label text.
- **Tested against Facebook- and Instagram-shaped markup, not live Facebook**,
  which needs a logged-in account. If Meta changes the label's wording or
  structure this will need updating; please open an issue if it stops working.

It only catches what Meta catches, so unlabelled AI content still gets through.

## Architecture

```
src/
  detect/          Pure, browser-free detection. Unit tested.
    containers.ts  Pulls metadata out of JPEG / PNG / WebP (falls back to a whole-file scan for others)
    index.ts       Looks for AI labels in that metadata
    bytes.ts       Byte-level helpers
  platforms/
    meta.ts        Finds Meta's "AI info" labels and the post/media they belong to. Unit tested.
  background.ts    Service worker: fetches image bytes (bypassing CORS), memoises results, badge count
  content.ts       Finds <img>s near the viewport, asks the worker about each, marks the AI ones;
                   on Meta sites also watches for "AI info" labels
  settings.ts      chrome.storage.sync-backed settings
  ui/              Popup and options page
static/            manifest.json, HTML, CSS
scripts/           esbuild build, icon generator, release packager
tests/             Vitest suite: real signed files from the C2PA reference SDK, and
                   Facebook/Instagram-shaped markup (jsdom)
```

Images are inspected as they approach the viewport (1500px margin), skipping
anything under 48px. The service worker re-downloads each image cookie-less,
with up to 6 concurrent requests and a 25 MB cap, and caches verdicts per URL.

Styling is entirely in `static/content.css`, keyed off `data-aiblock` attributes.
"Hide" keeps the element's box (so the page doesn't reflow) and paints a
placeholder by pushing the image out with `object-position`.

## Development

Requires Node 22+.

```sh
npm install
npm run build       # → dist/
npm run watch       # rebuild on change
npm test
npm run typecheck
npm run check       # all three of the above: what CI runs
```

Load `dist/` via **chrome://extensions → Developer mode → Load unpacked**, and
hit the reload icon on the extension card after rebuilding.

### CI/CD and releasing

`.github/workflows/ci-cd.yml` runs `npm run check` on every push and pull
request, then packages the extension (downloadable from the run as an artifact).

To release, bump `version` in `package.json` (the manifest takes its version
from there) and push to `main`. Once the check passes, the release job sees
there's no release for that version yet and publishes e.g. `v0.3.0` with
`block-ai-content-0.3.0.zip` attached, which is what [INSTALL.md](INSTALL.md)
points people at. Pushes that don't change the version don't release.

## Licence

MIT. Test fixtures in `tests/fixtures` are from
[c2pa-rs](https://github.com/contentauth/c2pa-rs) (MIT/Apache-2.0).
