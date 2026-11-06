import { getModel } from "./models";
import { defaultSpec } from "./prompt";
import { sizeFor } from "./sizes";
import type { JobSpec } from "./types";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_CROP = 0.05;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP, clamp01(c.w)));
  const h = Math.min(1, Math.max(MIN_CROP, clamp01(c.h)));
  const x = Math.min(clamp01(c.x), 1 - w);
  const y = Math.min(clamp01(c.y), 1 - h);
  return { x, y, w, h };
}

export const CROP_PRESETS = ["1:1", "16:9", "9:16", "4:5", "3:2", "2:3"] as const;

export function presetCrop(preset: string, width: number, height: number): CropRect {
  const [pw, ph] = preset.split(":").map(Number);
  const target = pw && ph ? pw / ph : 1;
  const source = width > 0 && height > 0 ? width / height : 1;
  let w = 1;
  let h = 1;
  if (source > target) {
    w = target / source;
  } else {
    h = source / target;
  }
  return clampCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

export interface TransformOptions {
  crop?: CropRect;
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
}

function frac(v: number): string {
  return String(Math.round(v * 10000) / 10000);
}

export function transformFilter(opts: TransformOptions): string {
  const parts: string[] = [];
  if (opts.crop) {
    const c = clampCrop(opts.crop);
    parts.push(`crop=iw*${frac(c.w)}:ih*${frac(c.h)}:iw*${frac(c.x)}:ih*${frac(c.y)}`);
  }
  if (opts.rotate === 90) parts.push("transpose=1");
  else if (opts.rotate === 270) parts.push("transpose=2");
  else if (opts.rotate === 180) parts.push("hflip", "vflip");
  if (opts.flipH) parts.push("hflip");
  return parts.length ? parts.join(",") : "null";
}

export function frameTimes(durationSeconds: number, count: number): number[] {
  if (!durationSeconds || durationSeconds <= 0 || count < 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.round(((durationSeconds * (i + 1)) / (count + 1)) * 100) / 100);
  }
  return out;
}

export function splitScript(text: string, max = 8): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function parseMediaInfo(text: string): {
  width?: number;
  height?: number;
  durationSeconds?: number;
} {
  const out: { width?: number; height?: number; durationSeconds?: number } = {};
  const dur = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (dur) {
    out.durationSeconds = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  }
  const videoLine = text.split("\n").find((line) => /Stream.*Video:/.test(line));
  if (videoLine) {
    const dims = /,\s*(\d{2,5})x(\d{2,5})(?=[\s,[])/.exec(videoLine);
    if (dims) {
      out.width = Number(dims[1]);
      out.height = Number(dims[2]);
    }
  }
  return out;
}

export function withLockedSeed(spec: JobSpec, locked: boolean, nextInt: () => number): JobSpec {
  if (!locked) return spec;
  const model = getModel(spec.modelId);
  if (!model.features.seed) return spec;
  if (spec.seed != null) return spec;
  return { ...spec, seed: Math.floor(Math.abs(nextInt())) };
}

export interface SsmlResult {
  text: string;
  hints: string[];
}

export function ssmlToText(input: string): SsmlResult {
  if (!input.includes("<")) return { text: input.trim(), hints: [] };
  const hints: string[] = [];
  let text = input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<break[^>]*\/>/gi, " … ");
  text = text.replace(/<sub[^>]*alias="([^"]*)"[^>]*>[\s\S]*?<\/sub>/gi, " $1 ");
  text = text.replace(/<prosody[^>]*>/gi, (tag) => {
    const rate = /rate="([^"]*)"/i.exec(tag)?.[1] ?? "";
    const pitch = /pitch="([^"]*)"/i.exec(tag)?.[1] ?? "";
    if (/slow/i.test(rate)) hints.push("Read slowly where marked.");
    if (/fast/i.test(rate)) hints.push("Read a little faster where marked.");
    if (/high/i.test(pitch)) hints.push("Lift the pitch where marked.");
    if (/low/i.test(pitch)) hints.push("Lower the pitch where marked.");
    return " ";
  });
  text = text
    .replace(/<\/(p|s|paragraph|sentence)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
  text = text.replace(/</g, "").replace(/>/g, "");
  return { text, hints: Array.from(new Set(hints)) };
}

export function abSpecs(base: JobSpec, modelIds: string[]): JobSpec[] {
  const out: JobSpec[] = [];
  for (const id of modelIds) {
    const model = getModel(id);
    if (model.id !== id || model.mode !== base.mode) continue;
    const spec: JobSpec = {
      ...defaultSpec(model),
      prompt: base.prompt,
      negativePrompt: base.negativePrompt,
      n: 1,
      refs: base.refs,
      seed: base.seed,
    };
    if (model.mode === "image" && model.sizes) {
      const tiers = model.sizes.tiers ?? [];
      spec.aspect = base.aspect || spec.aspect;
      spec.tier = tiers.includes(base.tier) ? base.tier : (tiers[0] ?? spec.tier);
      spec.size = sizeFor(model, spec.aspect, spec.tier);
    }
    if (model.mode === "video") {
      if ((model.resolutions ?? []).includes(base.resolution)) spec.resolution = base.resolution;
      if ((model.ratios ?? []).includes(base.ratio)) spec.ratio = base.ratio;
      if (model.duration) {
        spec.duration = Math.min(Math.max(model.duration.min, base.duration), model.duration.max);
      }
      spec.smartDuration = base.smartDuration;
    }
    if (model.mode === "audio") {
      spec.voice = base.voice;
      spec.format = base.format;
      spec.instruction = base.instruction;
    }
    out.push(spec);
  }
  return out;
}
