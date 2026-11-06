import type { JobAsset, JobStatus } from "./types";

type Any = Record<string, any>;

export function extractImageUrls(raw: unknown): string[] {
  const out = new Set<string>();
  const r = raw as Any;
  const choices = r?.output?.choices;
  if (Array.isArray(choices)) {
    for (const c of choices) {
      const content = c?.message?.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (typeof item?.image === "string") out.add(item.image);
          if (typeof item?.url === "string" && item?.type === "image") out.add(item.url);
        }
      }
    }
  }
  const results = r?.output?.results;
  if (Array.isArray(results)) {
    for (const item of results) {
      if (typeof item?.url === "string") out.add(item.url);
    }
  }
  if (typeof r?.output?.image_url === "string") out.add(r.output.image_url);
  return [...out];
}

export function extractVideoUrl(raw: unknown): string | undefined {
  const r = raw as Any;
  return (
    r?.output?.video_url ??
    r?.output?.results?.[0]?.url ??
    r?.output?.results?.[0]?.video_url ??
    undefined
  );
}

export function extractAudioUrl(raw: unknown): string | undefined {
  const r = raw as Any;
  return r?.output?.audio?.url ?? r?.output?.audio_url ?? r?.output?.results?.[0]?.url ?? undefined;
}

export function extractTaskId(raw: unknown): string | undefined {
  const r = raw as Any;
  return r?.output?.task_id ?? r?.task_id;
}

export function extractTaskStatus(raw: unknown): JobStatus | "pending" | "running" | undefined {
  const r = raw as Any;
  const s = String(r?.output?.task_status ?? "").toUpperCase();
  if (s === "PENDING") return "pending";
  if (s === "RUNNING") return "running";
  if (s === "SUCCEEDED") return "succeeded";
  if (s === "FAILED") return "failed";
  if (s === "CANCELED" || s === "CANCELLED") return "canceled";
  return undefined;
}

export function extractUsage(raw: unknown): Record<string, unknown> | undefined {
  return (raw as Any)?.usage;
}

export interface ProviderError {
  code?: string;
  message: string;
  hint?: string;
}

const HINTS: Record<string, string> = {
  DataInspectionFailed:
    "The prompt or a reference was blocked by content moderation. Reword the sensitive part and retry.",
  Throttling: "Rate limited. Wait a moment, then retry. The queue will not double-submit.",
  "Throttling.RateQuota": "Rate limited. Wait a moment, then retry.",
  InvalidParameter: "A parameter is outside this model's supported range. Check size, duration or reference count.",
  model_not_supported:
    "The Token Plan does not expose this model. Pick one from the model list — free-text model IDs can't draw down the plan.",
  "InvalidApiKey": "The key was rejected. Check that it starts with sk-sp- and belongs to your Token Plan.",
  Unauthorized: "The key was rejected. Re-enter it in Settings.",
  Forbidden: "This key can't call this endpoint. Token Plan keys are Singapore-only.",
  AccessDenied:
    "The gateway refused this call. If it mentions synchronous calls, the model is async-only and Q Studio will retry as a task.",
};

export function parseError(status: number, text: string, json?: unknown): ProviderError {
  const j = (json ?? {}) as Any;
  const code: string | undefined =
    j?.code ?? j?.error?.code ?? j?.output?.code ?? (status === 429 ? "Throttling" : undefined);
  const message: string =
    j?.message ??
    j?.error?.message ??
    j?.output?.message ??
    (text ? text.slice(0, 400) : `HTTP ${status}`);
  if (code === "DataInspectionFailed" && /\(output\)/i.test(message)) {
    return {
      code,
      message,
      hint: "The request was accepted and generated, but QwenCloud's output check rejected the finished frames. Soften close or intimate framing and escalating viewer-directed beats, or split the idea into shorter shots. The Prompt Doctor flags common triggers before you submit.",
    };
  }
  if (code === "DataInspectionFailed" && /\(input\)/i.test(message)) {
    return {
      code,
      message,
      hint: "QwenCloud's input check rejected the prompt or a reference before generation. Soften the flagged theme in the text, or swap the reference, and retry. The Prompt Doctor flags common triggers before you submit.",
    };
  }
  if (/does not support synchronous calls/i.test(message)) {
    return {
      code,
      message,
      hint: "This gateway only accepts this model as an async task. Q Studio resubmits with X-DashScope-Async automatically — if it still fails, update to the latest build and copy the request from the panel.",
    };
  }
  const key = code && HINTS[code] ? code : status === 401 || status === 403 ? "Unauthorized" : code;
  return { code, message, hint: key ? HINTS[key] : undefined };
}

export function reusableRemoteUrl(url?: string, nowMs: number = Date.now()): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    const expires = new URL(url).searchParams.get("Expires");
    if (expires) {
      const secs = Number(expires);
      if (Number.isFinite(secs) && secs * 1000 <= nowMs + 60_000) return undefined;
    }
  } catch {
    return undefined;
  }
  return url;
}

export function assetKindFor(url: string, fallback: "image" | "video" | "audio"): JobAsset["kind"] {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(mp4|mov|webm|m4v)$/.test(clean)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(clean)) return "audio";
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(clean)) return "image";
  return fallback;
}
