// Zips dist/ into block-ai-content-<version>.zip for releases.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
const name = `block-ai-content-${version}.zip`;
execFileSync("zip", ["-r", "-X", `../${name}`, "."], { cwd: "dist", stdio: "inherit" });
console.log(`\nWrote ${name}`);
