import type { ModelDef } from "./types";

export const ASPECTS = [
  { id: "1:1", label: "1:1", w: 1, h: 1 },
  { id: "4:3", label: "4:3", w: 4, h: 3 },
  { id: "3:4", label: "3:4", w: 3, h: 4 },
  { id: "16:9", label: "16:9", w: 16, h: 9 },
  { id: "9:16", label: "9:16", w: 9, h: 16 },
  { id: "3:2", label: "3:2", w: 3, h: 2 },
  { id: "2:3", label: "2:3", w: 2, h: 3 },
  { id: "21:9", label: "21:9", w: 21, h: 9 },
];

const WAN_TABLE: Record<string, Record<string, [number, number]>> = {
  "1K": {
    "1:1": [1280, 1280],
    "16:9": [1696, 960],
    "9:16": [960, 1696],
    "4:3": [1472, 1104],
    "3:4": [1104, 1472],
    "3:2": [1536, 1024],
    "2:3": [1024, 1536],
    "21:9": [1696, 728],
  },
  "2K": {
    "1:1": [2048, 2048],
    "16:9": [2688, 1536],
    "9:16": [1536, 2688],
    "4:3": [2368, 1728],
    "3:4": [1728, 2368],
    "3:2": [2688, 1792],
    "2:3": [1792, 2688],
    "21:9": [2688, 1152],
  },
  "4K": {
    "1:1": [4096, 4096],
    "16:9": [4096, 2304],
    "9:16": [2304, 4096],
    "4:3": [4096, 3072],
    "3:4": [3072, 4096],
    "3:2": [4096, 2731],
    "2:3": [2731, 4096],
    "21:9": [4096, 1755],
  },
};

function round8(n: number) {
  return Math.max(8, Math.round(n / 8) * 8);
}

/**
 * Compute a concrete "width*height" string for a model, aspect and tier.
 * Wan 2.7 has a documented pixel table; Qwen is derived from the long side.
 */
export function sizeFor(model: ModelDef, aspect: string, tier: string): string {
  const a = ASPECTS.find((x) => x.id === aspect) ?? ASPECTS[0];
  if (model.family === "wan-image") {
    const table = WAN_TABLE[tier] ?? WAN_TABLE["2K"];
    const hit = table[aspect];
    if (hit) return `${hit[0]}*${hit[1]}`;
  }
  const base = tier === "1K" ? 1024 : tier === "4K" ? 4096 : 2048;
  const max = model.sizes?.max ?? base;
  const target = Math.min(base, max);
  const long = target;
  let w: number;
  let h: number;
  if (a.w >= a.h) {
    w = long;
    h = (long * a.h) / a.w;
  } else {
    h = long;
    w = (long * a.w) / a.h;
  }
  const min = model.sizes?.min ?? 512;
  w = Math.max(min, Math.min(max, round8(w)));
  h = Math.max(min, Math.min(max, round8(h)));
  return `${w}*${h}`;
}

export function parseSize(size: string) {
  const [w, h] = size.split("*").map((x) => parseInt(x, 10));
  return { width: w || undefined, height: h || undefined };
}
