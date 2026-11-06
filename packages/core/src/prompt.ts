import type { JobSpec, ModelDef } from "./types";
import { sizeFor } from "./sizes";

export function defaultSpec(model: ModelDef): JobSpec {
  const aspect = model.mode === "video" ? "16:9" : "1:1";
  const tier = model.sizes?.defaultTier ?? model.sizes?.tiers?.[0] ?? "2K";
  return {
    mode: model.mode,
    modelId: model.id,
    prompt: "",
    negativePrompt: "",
    n: 1,
    aspect,
    size: model.sizes ? sizeFor(model, aspect, tier) : "",
    tier,
    resolution: model.defaultResolution ?? "720P",
    ratio: model.defaultRatio ?? "16:9",
    duration: model.duration?.default ?? 5,
    smartDuration: false,
    audioTrack: model.features.audioTrack,
    seed: null,
    watermark: false,
    promptExtend: model.features.promptExtend,
    promptExtendMode: "direct",
    thinking: model.features.thinking,
    sequential: false,
    colorPalette: [],
    voice: model.voices?.[0]?.id,
    format: "mp3",
    sampleRate: 24000,
    instruction: "",
    refs: [],
  };
}

export type PromptToken = {
  kind: "image" | "video" | "audio";
  n: number;
  raw: string;
  start: number;
  end: number;
};

const TOKEN_RE = /\[(Image|Video|Audio)\s+(\d+)\]/gi;

export function parseTokens(text: string): PromptToken[] {
  const out: PromptToken[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    out.push({
      kind: m[1].toLowerCase() as "image" | "video" | "audio",
      n: parseInt(m[2], 10),
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export function referencedIndexes(text: string, kind: "image" | "video" | "audio" = "image"): number[] {
  const set = new Set<number>();
  for (const t of parseTokens(text)) if (t.kind === kind) set.add(t.n);
  return [...set].sort((a, b) => a - b);
}

/** Rewrite [Image N] tokens using a 1-based index -> 1-based index map. Null removes the token. */
export function remapTokens(text: string, map: Record<number, number | null>, kind = "image"): string {
  return text.replace(TOKEN_RE, (raw, k: string, n: string) => {
    if (k.toLowerCase() !== kind) return raw;
    const next = map[parseInt(n, 10)];
    if (next === null || next === undefined) return raw;
    return `[${k[0].toUpperCase()}${k.slice(1).toLowerCase()} ${next}]`;
  });
}

/** Turn a prompt into a filesystem-safe slug. */
export function slugify(text: string, max = 48): string {
  const base = text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, max)
    .replace(/-+$/g, "");
  return base || "untitled";
}

export function titleFromPrompt(text: string): string {
  const clean = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled prompt";
  const words = clean.split(" ").slice(0, 7).join(" ");
  return words.length < clean.length ? `${words}…` : words;
}

/** Rough, honest ranges for the running state. */
export function estimateSeconds(model: ModelDef, spec: JobSpec): [number, number] {
  if (model.mode === "audio") {
    const n = Math.max(1, Math.round((spec.prompt?.length ?? 0) / 14));
    return [Math.max(2, n), Math.max(4, n + 4)];
  }
  if (model.mode === "video") {
    const dur = spec.smartDuration ? 5 : spec.duration;
    const high = spec.resolution === "1080P" ? 1.4 : 1;
    return [Math.round(dur * 6 * high), Math.round(dur * 14 * high + 30)];
  }
  const base = model.family === "wan-image" ? 18 : 24;
  return [base, base + 30 + spec.n * 4];
}

