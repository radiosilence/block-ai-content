import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { icon } from "./icons.mjs";

const watch = process.argv.includes("--watch");
const out = "dist";

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/icons`, { recursive: true });
await cp("static", out, { recursive: true });
for (const size of [16, 32, 48, 128]) await writeFile(`${out}/icons/${size}.png`, icon(size));

// package.json is the single source of truth for the version.
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile(`${out}/manifest.json`, "utf8"));
await writeFile(`${out}/manifest.json`, JSON.stringify({ ...manifest, version }, null, 2));

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/ui/popup.ts",
    options: "src/ui/options.ts",
  },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "chrome116",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

if (watch) {
  await (await esbuild.context(options)).watch();
} else {
  await esbuild.build(options);
}
