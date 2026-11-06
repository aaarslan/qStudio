import type { BuiltRequest, ModelDef, JobSpec, ResolvedRef } from "./types";
import { ssmlToText } from "./transform";

export const TOKEN_PLAN_BASE = "https://token-plan.maas.qwencloudapi.com";

export const REGIONS: Record<string, string> = {
  singapore: "https://ap-southeast-1.maas.qwencloudapi.com",
  beijing: "https://cn-beijing.maas.qwencloudapi.com",
  frankfurt: "https://eu-central-1.maas.qwencloudapi.com",
  "hong-kong": "https://cn-hongkong.maas.qwencloudapi.com",
  tokyo: "https://ap-northeast-1.maas.qwencloudapi.com",
  virginia: "https://us-east-1.maas.qwencloudapi.com",
};

export function endpointPath(model: ModelDef): string {
  switch (model.family) {
    case "qwen-image":
      return "/api/v1/services/aigc/multimodal-generation/generation";
    case "wan-image":
      return "/api/v1/services/aigc/image-generation/generation";
    case "wan-video":
    case "happyhorse-t2v":
    case "happyhorse-i2v":
    case "happyhorse-r2v":
      return "/api/v1/services/aigc/video-generation/video-synthesis";
    case "tts":
      return "/api/v1/services/audio/tts/SpeechSynthesizer";
    default:
      return "/api/v1/services/aigc/multimodal-generation/generation";
  }
}

export function isAsync(model: ModelDef): boolean {
  return model.mode === "video" || model.async === true;
}

function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

/**
 * Build the exact HTTP request for a job. This same object is what the
 * inspector displays and what "Copy as cURL" renders.
 */
export function buildRequest(
  model: ModelDef,
  spec: JobSpec,
  refs: ResolvedRef[],
  baseUrl: string
): BuiltRequest {
  const url = `${baseUrl.replace(/\/$/, "")}${endpointPath(model)}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isAsync(model)) headers["X-DashScope-Async"] = "enable";
  if (refs.some((r) => r.url.startsWith("oss://"))) {
    headers["X-DashScope-OssResourceResolve"] = "enable";
  }

  const images = refs.filter((r) => r.role === "reference" || r.role === "first_frame" || r.role === "last_frame");
  let body: unknown;

  if (model.mode === "image") {
    const content: Record<string, string>[] = images.map((r) => ({ image: r.url }));
    content.push({ text: spec.prompt });
    if (model.family === "qwen-image") {
      body = {
        model: model.id,
        input: { messages: [{ role: "user", content }] },
        parameters: clean({
          size: spec.size || undefined,
          n: spec.n > 1 ? spec.n : 1,
          watermark: spec.watermark,
          prompt_extend: spec.promptExtend,
          prompt_extend_mode:
            spec.promptExtend && model.features.promptExtendMode && images.length === 0
              ? spec.promptExtendMode ?? "direct"
              : undefined,
          enable_thinking: model.features.thinking ? spec.thinking !== false : undefined,
          negative_prompt: model.features.negativePrompt ? spec.negativePrompt || undefined : undefined,
          seed: model.features.seed && spec.seed != null ? spec.seed : undefined,
        }),
      };
    } else {
      body = {
        model: model.id,
        input: { messages: [{ role: "user", content }] },
        parameters: clean({
          size: spec.size || undefined,
          n: spec.n,
          watermark: spec.watermark,
          enable_sequential: model.features.sequential && spec.sequential ? true : undefined,
          thinking_mode:
            model.features.thinking && !spec.sequential ? spec.thinking !== false : undefined,
          color_palette:
            model.features.colorPalette && spec.colorPalette?.length ? spec.colorPalette : undefined,
        }),
      };
    }
  } else if (model.mode === "video") {
    const media: Record<string, string>[] = [];
    const byRole = (role: string) => refs.filter((r) => r.role === role);
    if (model.family === "happyhorse-i2v" || model.family === "wan-video") {
      for (const r of byRole("first_frame")) media.push({ type: "first_frame", url: r.url });
      for (const r of byRole("last_frame")) media.push({ type: "last_frame", url: r.url });
    }
    if (model.family !== "happyhorse-t2v" && model.family !== "happyhorse-i2v") {
      for (const r of byRole("reference")) media.push({ type: "reference_image", url: r.url });
    }
    if (model.family === "wan-video") {
      for (const r of byRole("audio")) media.push({ type: "reference_audio", url: r.url });
      for (const r of byRole("video")) media.push({ type: "reference_video", url: r.url });
    }
    const params = clean({
      resolution: spec.resolution || model.defaultResolution,
      ratio:
        model.family === "happyhorse-i2v"
          ? undefined
          : spec.ratio === "adaptive"
            ? model.family === "wan-video"
              ? "adaptive"
              : undefined
            : spec.ratio || model.defaultRatio,
      duration: spec.smartDuration && model.features.smartDuration ? -1 : spec.duration,
      prompt_extend: model.features.promptExtend ? spec.promptExtend : undefined,
      watermark: spec.watermark,
      audio: model.features.audioTrack ? spec.audioTrack !== false : undefined,
    });
    body = {
      model: model.id,
      input: clean({ prompt: spec.prompt, media }),
      parameters: params,
    };
  } else {
    const converted = spec.ssml ? ssmlToText(spec.prompt) : null;
    const instruction = [spec.instruction, ...(converted?.hints ?? [])]
      .filter(Boolean)
      .join(" ");
    body = {
      model: model.id,
      input: clean({
        text: converted ? converted.text : spec.prompt,
        voice: spec.voice,
        format: spec.format ?? "mp3",
        sample_rate: spec.sampleRate ?? 24000,
        instruction: model.features.instruction ? instruction || undefined : undefined,
      }),
    };
  }

  return { url, method: "POST", headers, body, async: isAsync(model) };
}

export function toCurl(req: { url: string; headers: Record<string, string>; body: unknown }): string {
  const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const headers = Object.entries(req.headers)
    .map(([k, v]) => `  -H ${shellQuote(`${k}: ${v}`)}`)
    .join(" \\\n");
  return `curl -s -X POST ${shellQuote(req.url)} \\\n${headers} \\\n  -H "Authorization: Bearer $QSTUDIO_API_KEY" \\\n  -d ${shellQuote(JSON.stringify(req.body, null, 2))}`;
}

/** Replace data:/oss: URLs and auth headers before persisting a request. */
export function sanitizeRequest(req: BuiltRequest): BuiltRequest {
  const clone = JSON.parse(JSON.stringify(req)) as BuiltRequest;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.startsWith("data:")) return `data:${v.slice(5, v.indexOf(";"))};base64,<…>`;
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  clone.body = walk(clone.body);
  return clone;
}
