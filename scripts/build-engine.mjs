import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "apps", "desktop", "src-tauri", "resources", "engine");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "apps", "server", "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: path.join(outDir, "index.mjs"),
  external: ["node:sqlite"],
  logLevel: "info",
});

const nodeDest = path.join(outDir, "node");
fs.copyFileSync(process.execPath, nodeDest);
fs.chmodSync(nodeDest, 0o755);
if (process.platform === "darwin") {
  try {
    execFileSync("codesign", ["--force", "--sign", "-", nodeDest], { stdio: "inherit" });
  } catch {
    console.warn("[build-engine] ad-hoc codesign failed; the .app may need it later");
  }
}

execFileSync("node", [path.join(root, "scripts", "fetch-ffmpeg.mjs")], { stdio: "inherit" });

for (const name of ["index.mjs", "node", path.join("bin", "ffmpeg")]) {
  const size = fs.statSync(path.join(outDir, name)).size;
  console.log(`[build-engine] ${name}: ${(size / 1024 / 1024).toFixed(1)} MB`);
}
console.log(`[build-engine] engine ready in ${outDir}`);
