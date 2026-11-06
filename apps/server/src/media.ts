import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, execSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { THUMB_DIR, loadSettings } from "./config";
import { addMedia, findMediaByHash, getJob, removeMedia, sha256, uid, updateMedia } from "./store";
import { slugify } from "@qstudio/core";
import { parseMediaInfo, presetCrop, transformFilter } from "@qstudio/core";
import type { TransformOptions } from "@qstudio/core";
import { parseSize } from "@qstudio/core";
import type { FilmRenderGraph } from "@qstudio/core";
import type { JobAsset, MediaAsset } from "@qstudio/core";

const exec = promisify(execFile);

function findBin(name: "ffmpeg" | "ffprobe"): string | null {
  const envValue = name === "ffmpeg" ? process.env.QSTUDIO_FFMPEG : process.env.QSTUDIO_FFPROBE;
  if (envValue && fs.existsSync(envValue)) return envValue;
  if (name === "ffmpeg") {
    const bundled = path.join(path.dirname(process.execPath), "bin", "ffmpeg");
    if (fs.existsSync(bundled)) return bundled;
  }
  try {
    const found = execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
    if (found) return found;
  } catch {
  }
  for (const candidate of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let ffmpegCache: string | null | undefined;
let ffprobeCache: string | null | undefined;

function ffmpegBin(): string | null {
  if (ffmpegCache === undefined) ffmpegCache = findBin("ffmpeg");
  return ffmpegCache;
}

function ffprobeBin(): string | null {
  if (ffprobeCache === undefined) ffprobeCache = findBin("ffprobe");
  return ffprobeCache;
}

export function mediaTools() {
  return { ffmpeg: ffmpegBin(), ffprobe: ffprobeBin(), sips: process.platform === "darwin" };
}

export function kindFromMime(mime: string, name = ""): "image" | "video" | "audio" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = path.extname(name).toLowerCase();
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(ext)) return "audio";
  return "image";
}

function extFrom(mime: string, fallback = "png"): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
  };
  return map[mime.toLowerCase()] ?? fallback;
}

export function mimeForFile(file: string, fallback = "application/octet-stream"): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
  };
  return map[path.extname(file).toLowerCase()] ?? fallback;
}

function dateFolder(): string {
  return new Date().toISOString().slice(0, 10);
}

export function outputDir(kind: "image" | "video" | "audio"): string {
  const root = loadSettings().outputRoot;
  const folder = kind === "image" ? "images" : kind === "video" ? "videos" : "audio";
  const dir = path.join(root, folder, dateFolder());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function referenceDir(): string {
  const dir = path.join(loadSettings().outputRoot, "references", dateFolder());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function reserveUniquePath(dir: string, base: string, ext: string): string {
  for (let i = 0; ; i++) {
    const suffix = i ? `-${i}` : "";
    const file = path.join(dir, `${base}${suffix}.${ext}`);
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.closeSync(fd);
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function probeImage(filePath: string, signal?: AbortSignal): Promise<{ width?: number; height?: number }> {
  throwIfAborted(signal);
  if (filePath.toLowerCase().endsWith(".svg")) {
    try {
      const text = await fsp.readFile(filePath, "utf8");
      const w = /<svg[^>]*\swidth="([\d.]+)"/.exec(text);
      const h = /<svg[^>]*\sheight="([\d.]+)"/.exec(text);
      const vb = /viewBox="[\d.\s-]+ [\d.\s-]+ ([\d.]+) ([\d.]+)"/.exec(text);
      return {
        width: w ? Number(w[1]) : vb ? Number(vb[1]) : undefined,
        height: h ? Number(h[1]) : vb ? Number(vb[2]) : undefined,
      };
    } catch {
      return {};
    }
  }
  const probeBin = ffprobeBin();
  if (probeBin) {
    try {
      const { stdout } = await exec(probeBin, [
        "-v", "error", "-print_format", "json", "-show_streams", filePath,
      ], { timeout: 15_000, signal });
      const json = JSON.parse(stdout) as any;
      const stream = (json.streams ?? []).find((s: any) => s.width) ?? {};
      if (stream.width) return { width: stream.width, height: stream.height };
    } catch {
      throwIfAborted(signal);
    }
  }
  if (process.platform === "darwin") {
    try {
      const { stdout } = await exec("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { timeout: 15_000, signal });
      const w = /pixelWidth:\s*(\d+)/.exec(stdout);
      const h = /pixelHeight:\s*(\d+)/.exec(stdout);
      return { width: w ? Number(w[1]) : undefined, height: h ? Number(h[1]) : undefined };
    } catch {
      throwIfAborted(signal);
    }
  }
  return {};
}

export async function probe(
  filePath: string,
  kind: "image" | "video" | "audio",
  signal?: AbortSignal
): Promise<{ width?: number; height?: number; durationSeconds?: number; hasAudio?: boolean }> {
  try {
    throwIfAborted(signal);
    if (kind === "image") {
      return await probeImage(filePath, signal);
    }
    const probeBin = ffprobeBin();
    if (!probeBin) {
      const ff = ffmpegBin();
      if (!ff) return {};
      const { stderr } = await exec(ff, ["-hide_banner", "-i", filePath], { timeout: 15_000, signal }).catch(
        (err: any) => {
          throwIfAborted(signal);
          return { stderr: String(err?.stderr ?? "") };
        }
      );
      return { ...parseMediaInfo(stderr), hasAudio: /Stream #[^\n]*Audio:/i.test(stderr) || kind === "audio" };
    }
    const { stdout } = await exec(probeBin, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ], { timeout: 15_000, signal });
    const json = JSON.parse(stdout) as any;
    const streams = json.streams ?? [];
    const stream = streams.find((s: any) => s.width) ?? streams[0] ?? {};
    return {
      width: stream.width,
      height: stream.height,
      durationSeconds: json.format?.duration ? Number(json.format.duration) : undefined,
      hasAudio: kind === "audio" || streams.some((s: any) => s.codec_type === "audio"),
    };
  } catch {
    throwIfAborted(signal);
    return {};
  }
}

export async function mediaHasAudio(media: MediaAsset, signal?: AbortSignal): Promise<boolean> {
  if (media.kind !== "video") return false;
  if (media.hasAudio !== undefined) return media.hasAudio;
  const meta = await probe(media.filePath, "video", signal);
  if (meta.hasAudio !== undefined) updateMedia(media.id, { hasAudio: meta.hasAudio });
  return meta.hasAudio === true;
}

export async function ensureThumb(media: MediaAsset): Promise<string | undefined> {
  const dest = path.join(THUMB_DIR, `${media.id}.jpg`);
  if (fs.existsSync(dest)) return dest;
  const made = await makeThumb(media.id, media.filePath, media.kind);
  return made ? dest : undefined;
}

async function makeThumb(id: string, filePath: string, kind: "image" | "video" | "audio", signal?: AbortSignal) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  const dest = path.join(THUMB_DIR, `${id}.jpg`);
  try {
    if (kind === "image") {
      if (filePath.toLowerCase().endsWith(".svg")) return undefined;
      const ff = ffmpegBin();
      if (ff) {
        await exec(ff, [
          "-y", "-i", filePath,
          "-vf", "scale=640:640:force_original_aspect_ratio=decrease",
          "-frames:v", "1", "-q:v", "4", dest,
        ], { timeout: 60_000, signal });
        return `/api/media/${id}/thumb`;
      }
      if (process.platform === "darwin") {
        await exec("sips", ["-Z", "640", "-s", "format", "jpeg", filePath, "--out", dest], { timeout: 60_000, signal });
        return `/api/media/${id}/thumb`;
      }
      return undefined;
    }
    if (kind === "video") {
      const ff = ffmpegBin();
      if (!ff) return undefined;
      await exec(ff, [
        "-y",
        "-ss",
        "0.25",
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-2",
        dest,
      ], { timeout: 60_000, signal });
      return `/api/media/${id}/thumb`;
    }
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throwIfAborted(signal);
    console.warn("[media] thumb failed", err);
  }
  return undefined;
}

export interface SavedMedia {
  asset: MediaAsset;
  assetOut: JobAsset;
}

export async function persistMedia(opts: {
  id?: string;
  buffer?: Buffer;
  filePath?: string;
  name: string;
  mime: string;
  kind: "image" | "video" | "audio";
  source: "upload" | "generated";
  parentMediaIds?: string[];
  dir: string;
  slug: string;
  prompt?: string;
  jobId?: string;
  sourceUrl?: string;
  signal?: AbortSignal;
}): Promise<SavedMedia> {
  const id = opts.id ?? uid("med");
  let filePath = opts.filePath;

  if (!filePath) {
    const ext = extFrom(opts.mime, opts.kind === "image" ? "png" : opts.kind === "video" ? "mp4" : "mp3");
    filePath = reserveUniquePath(opts.dir, opts.slug || "asset", ext);
    try {
      await fsp.writeFile(filePath, opts.buffer!);
    } catch (err) {
      fs.rmSync(filePath, { force: true });
      throw err;
    }
  }

  let thumb: string | undefined;
  try {
    throwIfAborted(opts.signal);
    const stat = await fsp.stat(filePath);
    const hash = opts.buffer ? sha256(opts.buffer) : await hashFile(filePath, opts.signal);
    throwIfAborted(opts.signal);
    const meta = await probe(filePath, opts.kind, opts.signal);
    throwIfAborted(opts.signal);
    thumb = await makeThumb(id, filePath, opts.kind, opts.signal);
    throwIfAborted(opts.signal);

    const asset: MediaAsset = {
      id,
      kind: opts.kind,
      name: opts.name,
      filePath,
      url: `/api/media/${id}/file`,
      sourceUrl: opts.sourceUrl,
      thumb,
      mime: opts.mime || mimeForFile(filePath),
      bytes: stat.size,
      hash,
      ...meta,
      source: opts.source,
      parentMediaIds: opts.parentMediaIds ?? (opts.jobId ? [...new Set(getJob(opts.jobId)?.spec.refs.map((ref) => ref.mediaId) ?? [])] : undefined),
      jobId: opts.jobId,
      prompt: opts.prompt,
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      useCount: 0,
    };
    addMedia(asset);

    const assetOut: JobAsset = {
      id,
      kind: opts.kind,
      url: `/api/media/${id}/file`,
      sourceUrl: opts.sourceUrl,
      filePath,
      thumb,
      mime: asset.mime,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      hasAudio: asset.hasAudio,
    };
    return { asset, assetOut };
  } catch (err) {
    fs.rmSync(filePath, { force: true });
    fs.rmSync(path.join(THUMB_DIR, `${id}.jpg`), { force: true });
    throw err;
  }
}

export function discardMediaAsset(id: string): MediaAsset | undefined {
  const asset = removeMedia(id);
  if (!asset) return undefined;
  fs.rmSync(asset.filePath, { force: true });
  fs.rmSync(path.join(THUMB_DIR, `${asset.id}.jpg`), { force: true });
  return asset;
}

async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash, signal ? { signal } : {});
  return hash.digest("hex");
}

export async function saveUpload(file: File): Promise<MediaAsset> {
  const buf = Buffer.from(await file.arrayBuffer());
  const hash = sha256(buf);
  const existing = findMediaByHash(hash);
  if (existing) return existing;

  const kind = kindFromMime(file.type, file.name);
  const ext = extFrom(file.type, path.extname(file.name).replace(".", "") || "png");
  const name = file.name || `reference.${ext}`;
  const base = slugify(path.basename(name, path.extname(name)), 40) || "reference";
  const { asset } = await persistMedia({
    buffer: buf,
    name,
    mime: file.type || mimeForFile(name),
    kind,
    source: "upload",
    dir: referenceDir(),
    slug: base,
  });
  return asset;
}

export async function downloadToFile(
  url: string,
  destDir: string,
  slug: string,
  fallbackKind: "image" | "video" | "audio",
  signal?: AbortSignal
) {
  const res = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const maxBytes = 1024 * 1024 * 1024;
  const announced = Number(res.headers.get("content-length") ?? 0);
  if (announced > maxBytes) throw new Error("Download is larger than the 1 GB safety limit.");
  const declaredMime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const declaredKind = /^(image|video|audio)\//.test(declaredMime) ? kindFromMime(declaredMime) : undefined;
  const kind = declaredKind ?? fallbackKind;
  const urlMime = mimeForFile(new URL(res.url || url).pathname, "");
  const expectedPrefix = `${kind}/`;
  const mime = declaredKind
    ? declaredMime
    : urlMime.startsWith(expectedPrefix)
      ? urlMime
      : kind === "image"
        ? "image/png"
        : kind === "video"
          ? "video/mp4"
          : "audio/mpeg";
  const ext = extFrom(mime, kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3");
  const dest = reserveUniquePath(destDir, slug || "asset", ext);
  const part = `${dest}.part`;
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) callback(new Error("Download exceeded the 1 GB safety limit."));
      else callback(null, chunk);
    },
  });
  try {
    if (!res.body) throw new Error("The download returned no body.");
    await pipeline(
      Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
      limiter,
      fs.createWriteStream(part, { mode: 0o600, flags: "wx" }),
      signal ? { signal } : {}
    );
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    fs.renameSync(part, dest);
  } catch (err) {
    fs.rmSync(part, { force: true });
    fs.rmSync(dest, { force: true });
    throw err;
  }
  return { filePath: dest, mime: mime || mimeForFile(dest), kind, ext, bufBytes: bytes };
}

/* --------------------------- mock generation -------------------------- */

function hashColors(seed: string): [string, string, string] {
  const h = crypto.createHash("sha256").update(seed).digest();
  const hue = h[0] * 1.41;
  const a = `hsl(${hue}, 38%, 16%)`;
  const b = `hsl(${(hue + 38) % 360}, 52%, 34%)`;
  const c = `hsl(${(hue + 190) % 360}, 60%, 62%)`;
  return [a, b, c];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.replace(/\[[^\]]*\]/g, "").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      if (line) lines.push(line.trim());
      line = w;
      if (lines.length >= maxLines) break;
    } else line = `${line} ${w}`;
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  return lines;
}

export function mockImageSvg(prompt: string, size: string, variant: number, modelLabel: string): string {
  const { width = 1024, height = 1024 } = parseSize(size);
  const [a, b, c] = hashColors(prompt + variant);
  const lines = wrap(prompt || "Untitled", Math.max(18, Math.floor(width / 26)), 6);
  const fontSize = Math.max(16, Math.round(width / 34));
  const pad = Math.round(width * 0.06);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="55%" stop-color="${b}"/>
      <stop offset="100%" stop-color="${a}"/>
    </linearGradient>
    <radialGradient id="r" cx="72%" cy="28%" r="55%">
      <stop offset="0%" stop-color="${c}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer>
      <feBlend in="SourceGraphic" mode="overlay"/>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#r)"/>
  <g opacity="0.28" stroke="${c}" stroke-width="1">
    ${Array.from({ length: 14 }, (_, i) => `<line x1="0" y1="${(height / 14) * (i + 1)}" x2="${width}" y2="${(height / 14) * (i + 1) - height * 0.18}"/>`).join("")}
  </g>
  <rect width="100%" height="100%" fill="black" opacity="0.18"/>
  <text x="${pad}" y="${pad + fontSize}" font-family="ui-monospace, Menlo, monospace" font-size="${fontSize * 0.62}" letter-spacing="${fontSize * 0.14}" fill="#F2F0EB" opacity="0.62">Q STUDIO / DEMO · ${esc(modelLabel.toUpperCase())}</text>
  ${lines
    .map(
      (l, i) =>
        `<text x="${pad}" y="${height - pad - (lines.length - 1 - i) * fontSize * 1.34}" font-family="Georgia, ui-serif, serif" font-size="${fontSize}" fill="#F2F0EB" opacity="0.94">${esc(l)}</text>`
    )
    .join("\n  ")}
  <text x="${pad}" y="${height - pad + fontSize * 1.5}" font-family="ui-monospace, Menlo, monospace" font-size="${fontSize * 0.5}" letter-spacing="${fontSize * 0.1}" fill="#F2F0EB" opacity="0.4">VARIANT ${variant} · ${width}×${height}</text>
  <rect width="100%" height="100%" filter="url(#grain)" opacity="0.5"/>
</svg>`;
}

export async function extractFrameJpeg(
  media: MediaAsset,
  at: number | "last"
): Promise<string> {
  const ff = ffmpegBin();
  if (!ff) throw new Error("Frame extraction needs ffmpeg. Install it with `brew install ffmpeg`.");
  const dir = path.join(THUMB_DIR, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const key = at === "last" ? "last" : String(Math.round(at * 10));
  const dest = path.join(dir, `${media.id}-${key}.jpg`);
  if (fs.existsSync(dest)) return dest;
  const seek = at === "last" ? ["-sseof", "-0.5"] : ["-ss", String(Math.max(0, at))];
  await exec(ff, ["-y", ...seek, "-i", media.filePath, "-frames:v", "1", "-q:v", "3", dest], {
    timeout: 60_000,
  });
  return dest;
}

export async function grabFrameAsset(media: MediaAsset, at: number | "last"): Promise<MediaAsset> {
  const jpeg = await extractFrameJpeg(media, at);
  const jpegBytes = await fsp.readFile(jpeg);
  const existing = findMediaByHash(sha256(jpegBytes));
  if (existing && fs.existsSync(existing.filePath)) return existing;
  const base = slugify(path.basename(media.name, path.extname(media.name)), 32) || "frame";
  const dest = reserveUniquePath(referenceDir(), `${base}-frame`, "jpg");
  try {
    await fsp.copyFile(jpeg, dest);
    const { asset } = await persistMedia({
      filePath: dest,
      name: path.basename(dest),
      mime: "image/jpeg",
      kind: "image",
      source: "upload",
      dir: referenceDir(),
      slug: base,
      prompt: media.prompt,
      parentMediaIds: [media.id],
    });
    return asset;
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

export async function transformImageAsset(
  media: MediaAsset,
  opts: TransformOptions & { preset?: string }
): Promise<MediaAsset> {
  const ff = ffmpegBin();
  if (!ff) throw new Error("Image transforms need ffmpeg. Install it with `brew install ffmpeg`.");
  if (media.kind !== "image") throw new Error("Crop and rotate apply to images.");
  let crop = opts.crop;
  if (!crop && opts.preset) {
    const meta = media.width && media.height ? media : await probe(media.filePath, "image");
    crop = presetCrop(opts.preset, meta.width ?? 1024, meta.height ?? 1024);
  }
  const filter = transformFilter({ crop, rotate: opts.rotate, flipH: opts.flipH });
  const base = slugify(path.basename(media.name, path.extname(media.name)), 32) || "image";
  const dest = reserveUniquePath(referenceDir(), `${base}-edit`, "jpg");
  try {
    await exec(ff, ["-y", "-i", media.filePath, "-vf", filter, "-frames:v", "1", "-q:v", "2", dest], {
      timeout: 60_000,
    });
    const { asset } = await persistMedia({
      filePath: dest,
      name: path.basename(dest),
      mime: "image/jpeg",
      kind: "image",
      source: "upload",
      dir: referenceDir(),
      slug: base,
      prompt: media.prompt,
      parentMediaIds: [media.id],
    });
    return asset;
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
}

export async function mockImage(prompt: string, size: string, modelLabel: string, variant: number) {
  return Buffer.from(mockImageSvg(prompt, size, variant, modelLabel));
}

export async function importLocalFiles(paths: string[]): Promise<MediaAsset[]> {
  const out: MediaAsset[] = [];
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.size > 30 * 1024 * 1024) continue;
    const buf = await fsp.readFile(resolved);
    const hash = sha256(buf);
    const existing = findMediaByHash(hash);
    if (existing) {
      out.push(existing);
      continue;
    }
    const name = path.basename(resolved);
    const mime = mimeForFile(name);
    const kind = kindFromMime(mime, name);
    const base = slugify(path.basename(name, path.extname(name)), 40) || "reference";
    const dest = reserveUniquePath(referenceDir(), base, path.extname(name).slice(1).toLowerCase() || "png");
    try {
      await fsp.copyFile(resolved, dest);
      const { asset } = await persistMedia({
        filePath: dest,
        name,
        mime,
        kind,
        source: "upload",
        dir: referenceDir(),
        slug: base,
      });
      out.push(asset);
    } catch (err) {
      fs.rmSync(dest, { force: true });
      throw err;
    }
  }
  return out;
}

export async function mockVideo(
  prompt: string,
  width: number,
  height: number,
  seconds: number,
  dest: string,
  signal?: AbortSignal
) {
  const ff = ffmpegBin();
  if (!ff) throw new Error("Demo video needs ffmpeg. Install it with `brew install ffmpeg`.");
  const dur = Math.min(6, Math.max(3, seconds));
  const hue = crypto.createHash("sha256").update(prompt).digest()[0] % 360;
  await exec(
    ff,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${width}x${height}:rate=24:duration=${dur}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${180 + (hue % 120)}:sample_rate=44100:duration=${dur}`,
      "-vf",
      `hue=h=${hue},eq=saturation=0.75:brightness=-0.06`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-shortest",
      dest,
    ],
    { timeout: 120_000, signal }
  );
}

export async function mockAudio(
  text: string,
  dest: string,
  format: "mp3" | "wav",
  signal?: AbortSignal
) {
  const ff = ffmpegBin();
  const seconds = Math.min(14, Math.max(2, Math.round(text.length / 16)));
  if (!ff) {
    if (format === "wav") return writeToneWav(dest, seconds);
    throw new Error("Demo audio needs ffmpeg. Install it with `brew install ffmpeg`.");
  }
  const codec = format === "wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "libmp3lame", "-b:a", "96k"];
  await exec(
    ff,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=300:sample_rate=24000:duration=${seconds}`,
      "-af",
      "tremolo=f=3.2:d=0.35,volume=0.32",
      ...codec,
      dest,
    ],
    { timeout: 60_000, signal }
  );
}

function writeToneWav(dest: string, seconds: number) {
  const rate = 16000;
  const samples = rate * seconds;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 3);
    const v = Math.sin(2 * Math.PI * 320 * t) * 0.25 * env;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return fsp.writeFile(dest, buf);
}

export async function reveal(filePath: string) {
  if (process.platform === "darwin") {
    await exec("open", ["-R", filePath]).catch(() => exec("open", [path.dirname(filePath)]));
  } else {
    await exec("xdg-open", [path.dirname(filePath)]).catch(() => {});
  }
}

export async function averageColorHex(media: MediaAsset): Promise<string | null> {
  const ff = ffmpegBin();
  if (!ff || media.kind === "audio") return null;
  if (media.filePath.toLowerCase().endsWith(".svg")) return null;
  try {
    const seek = media.kind === "video" ? ["-ss", "0.5"] : [];
    const { stdout } = (await exec(
      ff,
      ["-v", "error", ...seek, "-i", media.filePath, "-vf", "scale=1:1", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 30_000 }
    )) as unknown as { stdout: Buffer };
    if (!stdout || stdout.length < 3) return null;
    const hex = [stdout[0], stdout[1], stdout[2]]
      .map((v) => v.toString(16).padStart(2, "0").toUpperCase())
      .join("");
    return `#${hex}`;
  } catch {
    return null;
  }
}

export async function renderFilmPreview(
  graph: FilmRenderGraph,
  opts: { signal?: AbortSignal; onProgress?: (progress: number, note: string) => void } = {}
): Promise<{ asset: MediaAsset; skipped: string[] }> {
  const ff = ffmpegBin();
  if (!ff) throw new Error("Preview export needs ffmpeg. Install it with `brew install ffmpeg`.");
  const usable = graph.clips;
  if (!usable.length) throw new Error("No selected image or video takes to preview yet.");
  const dir = outputDir("video");
  const work = fs.mkdtempSync(path.join(dir, ".preview-"));
  const skipped: string[] = [];
  const parts: string[] = [];
  const totalSteps = usable.length + 1;
  try {
    for (let i = 0; i < usable.length; i++) {
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const clip = usable[i];
      const part = path.join(work, `part-${String(i).padStart(3, "0")}.mp4`);
      const duration = Math.max(0.1, clip.durationSeconds);
      const inputs: string[] = ["-y"];
      if (clip.kind === "image") {
        inputs.push("-loop", "1", "-t", String(duration), "-i", clip.path);
      } else {
        if ((clip.trimIn ?? 0) > 0) inputs.push("-ss", String(clip.trimIn));
        inputs.push("-t", String(duration), "-i", clip.path);
      }

      let baseAudioIndex = 0;
      if (!clip.hasAudio) {
        baseAudioIndex = inputs.filter((value) => value === "-i").length;
        inputs.push(
          "-f",
          "lavfi",
          "-t",
          String(duration),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000"
        );
      }
      const audioIndexes = clip.audio.map((audio) => {
        const index = inputs.filter((value) => value === "-i").length;
        inputs.push("-t", String(duration), "-i", audio.path);
        return index;
      });

      const filters = [
        `[0:v]scale=${graph.width}:${graph.height}:force_original_aspect_ratio=decrease,pad=${graph.width}:${graph.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${graph.fps},format=yuv420p,trim=duration=${duration},setpts=PTS-STARTPTS[vout]`,
        `[${baseAudioIndex}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS[a0]`,
      ];
      audioIndexes.forEach((index, audioIndex) => {
        filters.push(
          `[${index}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${(clip.audio[audioIndex].gain ?? 1).toFixed(2)}[a${audioIndex + 1}]`
        );
      });
      if (audioIndexes.length) {
        filters.push(
          `[a0]${audioIndexes.map((_, index) => `[a${index + 1}]`).join("")}amix=inputs=${audioIndexes.length + 1}:duration=first:normalize=0[aout]`
        );
      } else {
        filters.push("[a0]anull[aout]");
      }

      try {
        await exec(
          ff,
          [
            ...inputs,
            "-filter_complex",
            filters.join(";"),
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-t",
            String(duration),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            part,
          ],
          { timeout: 180_000, signal: opts.signal }
        );
        parts.push(part);
      } catch (err) {
        if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        skipped.push(clip.name);
        console.warn("[preview] skipped", clip.name, (err as Error).message);
      }
      opts.onProgress?.((i + 1) / totalSteps, `Rendered ${i + 1}/${usable.length} clips`);
    }
    if (!parts.length) throw new Error("None of the selected takes could be read by ffmpeg.");
    opts.onProgress?.(Math.min(0.96, usable.length / totalSteps), "Joining the cut");
    const listFile = path.join(work, "list.txt");
    fs.writeFileSync(listFile, parts.map((part) => `file '${part.replace(/'/g, "'\\''")}'`).join("\n"));
    const slug = slugify(graph.title, 40) || "film-preview";
    const dest = reserveUniquePath(dir, `${slug}-preview`, "mp4");
    try {
      await exec(
        ff,
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listFile,
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-af",
          "loudnorm=I=-16:TP=-1.5:LRA=11",
          "-movflags",
          "+faststart",
          dest,
        ],
        { timeout: 300_000, signal: opts.signal }
      );
      opts.onProgress?.(0.99, "Saving preview");
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { asset } = await persistMedia({
        filePath: dest,
        name: path.basename(dest),
        mime: "video/mp4",
        kind: "video",
        source: "generated",
        dir,
        slug,
        prompt: `Film preview: ${graph.title}`,
        signal: opts.signal,
      });
      if (opts.signal?.aborted) {
        discardMediaAsset(asset.id);
        throw new DOMException("Aborted", "AbortError");
      }
      return { asset, skipped };
    } catch (err) {
      fs.rmSync(dest, { force: true });
      throw err;
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function readRange(filePath: string, range: string | undefined) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  if (!range) return { start: 0, end: size - 1, size, partial: false, unsatisfiable: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (!m[1] && !m[2])) {
    return { start: 0, end: size - 1, size, partial: false, unsatisfiable: false };
  }
  if (!m[1]) {
    const suffix = parseInt(m[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return { start: 0, end: size - 1, size, partial: true, unsatisfiable: true };
    }
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1, size, partial: true, unsatisfiable: false };
  }
  const start = parseInt(m[1], 10);
  const requestedEnd = m[2] ? parseInt(m[2], 10) : size - 1;
  const end = Math.min(requestedEnd, size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) {
    return { start: 0, end: size - 1, size, partial: true, unsatisfiable: true };
  }
  return { start, end, size, partial: true, unsatisfiable: false };
}
