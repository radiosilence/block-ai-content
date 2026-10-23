// Assembles the GitHub Pages test site into _site/: the page plus the real
// signed test images it shows, copied from tests/fixtures.
import { cp, mkdir, rm } from "node:fs/promises";

const out = "_site";
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/images`, { recursive: true });
await cp("site", out, { recursive: true });
for (const img of ["ocsp.jpg", "CA.jpg", "no_manifest.jpg"]) await cp(`tests/fixtures/${img}`, `${out}/images/${img}`);
console.log(`Built ${out}/`);
