import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const URL =
  "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz";
const GZ_SHA256 = "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa";
const BIN_SHA256 = "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(os.homedir(), ".cache", "qstudio");
const cached = path.join(cacheDir, "ffmpeg-darwin-arm64");
const destDir = path.join(root, "apps", "desktop", "src-tauri", "resources", "engine", "bin");
const dest = path.join(destDir, "ffmpeg");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(destDir, { recursive: true });

if (!fs.existsSync(cached) || sha256(cached) !== BIN_SHA256) {
  console.log("[fetch-ffmpeg] downloading static ffmpeg (darwin-arm64, ffmpeg-static b6.1.1)…");
  const res = await fetch(URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const gzHash = crypto.createHash("sha256").update(gz).digest("hex");
  if (gzHash !== GZ_SHA256) throw new Error(`gz sha256 mismatch: ${gzHash}`);
  fs.writeFileSync(cached, zlib.gunzipSync(gz));
  if (sha256(cached) !== BIN_SHA256) throw new Error("binary sha256 mismatch after gunzip");
}

fs.copyFileSync(cached, dest);
fs.chmodSync(dest, 0o755);
try {
  execFileSync("codesign", ["--force", "--sign", "-", dest], { stdio: "inherit" });
} catch {
  console.warn("[fetch-ffmpeg] ad-hoc codesign failed");
}
const version = execFileSync(dest, ["-version"], { encoding: "utf8" }).split("\n")[0];
console.log(`[fetch-ffmpeg] ${version} -> ${dest} (${(fs.statSync(dest).size / 1024 / 1024).toFixed(0)} MB)`);
