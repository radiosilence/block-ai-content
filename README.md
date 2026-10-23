# Block AI Content

A browser extension that hides images labelled as AI-generated.

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
- **Video and audio** aren't inspected yet (C2PA supports them; contributions welcome).
- **CSS background images** aren't inspected, only `<img>` elements.

So: a false positive is very unlikely (the file has to say it's AI), but plenty
of AI content will get through.

## Architecture

```
src/
  detect/          Pure, browser-free detection. Unit tested.
    containers.ts  Pulls metadata out of JPEG / PNG / WebP (falls back to a whole-file scan for others)
    index.ts       Looks for AI labels in that metadata
    bytes.ts       Byte-level helpers
  background.ts    Service worker: fetches image bytes (bypassing CORS), memoises results, badge count
  content.ts       Finds <img>s near the viewport, asks the worker about each, marks the AI ones
  settings.ts      chrome.storage.sync-backed settings
  ui/              Popup and options page
static/            manifest.json, HTML, CSS
scripts/           esbuild build, icon generator, release packager
tests/             Vitest suite, including real signed files from the C2PA reference SDK
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
```

Load `dist/` via **chrome://extensions → Developer mode → Load unpacked**, and
hit the reload icon on the extension card after rebuilding.

### Releasing

Bump `version` in `package.json` (the manifest takes its version from there)
and push to `main`. GitHub Actions notices there's no release for that version
yet, runs the tests, builds, and publishes `v0.2.0` with
`block-ai-content-0.2.0.zip` attached, which is what [INSTALL.md](INSTALL.md)
points people at. Pushes that don't change the version do nothing.

## Licence

MIT. Test fixtures in `tests/fixtures` are from
[c2pa-rs](https://github.com/contentauth/c2pa-rs) (MIT/Apache-2.0).
