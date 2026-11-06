import type {
  DriftReport,
  Entity,
  FilmForecast,
  Job,
  JobSpec,
  KeyStatus,
  LocalExport,
  MediaAsset,
  ModelDef,
  PatchSuggestion,
  PromptRecord,
  Scene,
  Settings,
  Shot,
  UsageRecord,
  World,
} from "@core";
import { getEngineInfo, isTauri, type EngineInfo } from "./tauri";

export interface CompiledPreview {
  prompt: string;
  spec: JobSpec;
  refs: { mediaId: string; role: string; name: string }[];
  palette: string[];
  fingerprint: string;
  warnings: string[];
  stale: string[];
  units: number;
  coverage: { ratio: number; missing: string[] };
}

export interface ApiState {
  settings: Settings;
  key: KeyStatus & { kind?: string };
  models: ModelDef[];
  jobs: Job[];
  media: MediaAsset[];
  prompts: PromptRecord[];
  worlds: World[];
  entities: Entity[];
  scenes: Scene[];
  shots: Shot[];
  exports: LocalExport[];
  stats: { media: number; jobs: number; prompts: number; worlds: number; shots: number };
  baseUrl: string;
  outputRoot: string;
  usage: { monthUnits: number; capUnits: number; label: string };
  tools: { ffmpeg: string | null; ffprobe: string | null; sips: boolean };
  integrity: { warnings: string[]; orphanedTakes: number; missingTakeMedia: number };
  revision: number;
  engineInstance: string;
}

let engine: EngineInfo = { baseUrl: "", token: "", running: true };

export function currentEngine(): EngineInfo {
  return engine;
}

export async function initEngine(): Promise<EngineInfo> {
  if (!isTauri()) {
    engine = { baseUrl: "", token: "", running: true };
    return engine;
  }
  const info = await getEngineInfo();
  if (info) engine = info;
  return engine;
}

export function setEngine(info: EngineInfo) {
  engine = info;
}

export function mediaUrl(path?: string): string {
  if (!path) return "";
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  const absolute = path.startsWith("/") ? `${engine.baseUrl}${path}` : path;
  if (!engine.token || !absolute.includes("/api/")) return absolute;
  const joiner = absolute.includes("?") ? "&" : "?";
  return `${absolute}${joiner}token=${encodeURIComponent(engine.token)}`;
}

export function eventsUrl(): string {
  const base = `${engine.baseUrl}/api/events`;
  return engine.token ? `${base}?token=${encodeURIComponent(engine.token)}` : base;
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const res = await fetch(`${engine.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(engine.token ? { Authorization: `Bearer ${engine.token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && isTauri() && !retried) {
    await initEngine();
    return request<T>(path, init, true);
  }
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `Request failed (${res.status})`) as Error & {
      code?: string;
    };
    err.code = data?.code;
    throw err;
  }
  return data as T;
}

export const api = {
  state: () => request<ApiState>("/api/state"),

  health: () => request<{ ok: boolean; running: number }>("/api/health"),

  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>("/api/settings", {
      method: "POST",
      body: JSON.stringify(patch),
    }),

  saveKey: (key: string, remember: boolean) =>
    request<{ ok: boolean; key: KeyStatus }>("/api/key", {
      method: "POST",
      body: JSON.stringify({ key, remember }),
    }),

  deleteKey: () => request<{ ok: boolean; key: KeyStatus }>("/api/key", { method: "DELETE" }),

  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ media: MediaAsset }>("/api/upload", { method: "POST", body: form });
  },

  importPaths: (paths: string[]) =>
    request<{ media: MediaAsset[] }>("/api/import", {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),

  createJob: (spec: JobSpec, promptId?: string, force?: boolean) =>
    request<{ job: Job }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ spec, promptId, force }),
    }),

  cancelJob: (id: string) => request<{ job: Job }>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  retryJob: (id: string, force?: boolean) => request<{ job: Job }>(`/api/jobs/${id}/retry`, {
    method: "POST",
    body: JSON.stringify({ force }),
  }),
  deleteJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),

  usage: () => request<{ entries: UsageRecord[]; monthUnits: number; label: string }>("/api/usage"),
  storage: () =>
    request<{
      mediaBytes: number;
      byKind: { image: number; video: number; audio: number };
      mediaCount: number;
      demoCount: number;
      thumbsBytes: number;
      dbBytes: number;
      outputRoot: string;
      deadJobs: number;
    }>("/api/storage"),
  prune: (body: { demo?: boolean; olderThanDays?: number; thumbs?: boolean; deadJobs?: boolean }) =>
    request<{ ok: boolean; removedMedia: number; removedJobs: number; freedBytes: number }>(
      "/api/storage/prune",
      { method: "POST", body: JSON.stringify(body) }
    ),
  logs: () => request<{ lines: string[]; note?: string }>("/api/logs"),
  search: (q: string) =>
    request<{
      prompts: PromptRecord[];
      media: MediaAsset[];
      film: { entities: Entity[]; scenes: Scene[]; shots: Shot[] };
    }>(`/api/search?q=${encodeURIComponent(q)}`),

  createWorld: (body: Partial<World>) =>
    request<{ world: World; entities: Entity[]; scenes: Scene[]; shots: Shot[] }>("/api/film/worlds", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchWorld: (id: string, patch: Partial<World>) =>
    request<{ world: World }>(`/api/film/worlds/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteWorld: (id: string) => request<{ ok: boolean }>(`/api/film/worlds/${id}`, { method: "DELETE" }),
  breakdown: (worldId: string, scriptText: string, replace = false) =>
    request<{ world: World; entities: Entity[]; scenes: Scene[]; shots: Shot[] }>(
      `/api/film/worlds/${worldId}/breakdown`,
      { method: "POST", body: JSON.stringify({ scriptText, replace }) }
    ),
  createEntity: (worldId: string, body: Partial<Entity>) =>
    request<{ entity: Entity }>(`/api/film/worlds/${worldId}/entities`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchEntity: (id: string, patch: Partial<Entity>) =>
    request<{ entity: Entity }>(`/api/film/entities/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteEntity: (id: string) => request<{ ok: boolean }>(`/api/film/entities/${id}`, { method: "DELETE" }),
  createScene: (worldId: string, body: Partial<Scene>) =>
    request<{ scene: Scene }>(`/api/film/worlds/${worldId}/scenes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchScene: (id: string, patch: Partial<Scene>) =>
    request<{ scene: Scene }>(`/api/film/scenes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteScene: (id: string) => request<{ ok: boolean }>(`/api/film/scenes/${id}`, { method: "DELETE" }),
  createShot: (sceneId: string, body: Partial<Shot>) =>
    request<{ shot: Shot }>(`/api/film/scenes/${sceneId}/shots`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchShot: (id: string, patch: Partial<Shot>) =>
    request<{ shot: Shot }>(`/api/film/shots/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteShot: (id: string) => request<{ ok: boolean }>(`/api/film/shots/${id}`, { method: "DELETE" }),
  compileShot: (id: string) => request<CompiledPreview>(`/api/film/shots/${id}/compile`),
  renderShot: (id: string, force?: boolean) =>
    request<{ job: Job; shot: Shot; warnings: string[] }>(`/api/film/shots/${id}/render`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  verdictTake: (shotId: string, takeId: string, verdict: "accepted" | "rejected" | null) =>
    request<{ shot: Shot }>(`/api/film/shots/${shotId}/verdict`, {
      method: "POST",
      body: JSON.stringify({ takeId, verdict }),
    }),
  checkDrift: (shotId: string) =>
    request<{ shot: Shot; drift: DriftReport }>(`/api/film/shots/${shotId}/drift`, { method: "POST" }),
  voiceShot: (shotId: string, force?: boolean) =>
    request<{ job: Job; voiceId?: string }>(`/api/film/shots/${shotId}/voice`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),
  previewFilm: (worldId: string) =>
    request<{ localExport: LocalExport; skipped: string[] }>(`/api/film/worlds/${worldId}/preview`, {
      method: "POST",
    }),
  cancelExport: (id: string) =>
    request<{ export: LocalExport }>(`/api/exports/${id}/cancel`, { method: "POST" }),
  renderGraph: (worldId: string) =>
    request<{ graph: import("@core").FilmRenderGraph; skipped: string[] }>(
      `/api/film/worlds/${worldId}/render-graph`
    ),
  forecastFilm: (worldId: string) => request<FilmForecast>(`/api/film/worlds/${worldId}/forecast`),
  suggestions: (worldId: string) =>
    request<{ suggestions: PatchSuggestion[] }>(`/api/film/worlds/${worldId}/suggestions`),
  applySuggestion: (suggestion: PatchSuggestion) =>
    request<{ shot: Shot }>("/api/film/suggestions/apply", {
      method: "POST",
      body: JSON.stringify({ suggestion }),
    }),

  savePrompt: (p: Partial<PromptRecord>) =>
    request<{ prompt: PromptRecord }>("/api/prompts", {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      body: JSON.stringify(p),
    }),

  patchPrompt: (id: string, patch: Partial<PromptRecord>) =>
    request<{ prompt: PromptRecord }>(`/api/prompts/${id}`, {
      signal: AbortSignal.timeout(15_000),
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deletePrompt: (id: string) => request<{ ok: boolean }>(`/api/prompts/${id}`, { method: "DELETE" }),

  transformMedia: (
    id: string,
    body: {
      crop?: { x: number; y: number; w: number; h: number };
      preset?: string;
      rotate?: 0 | 90 | 180 | 270;
      flipH?: boolean;
    }
  ) =>
    request<{ media: MediaAsset }>(`/api/media/${id}/transform`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  grabFrame: (id: string, at: number | "last") =>
    request<{ media: MediaAsset }>(`/api/media/${id}/frame`, {
      method: "POST",
      body: JSON.stringify({ at }),
    }),

  patchMedia: (id: string, patch: Partial<MediaAsset>) =>
    request<{ media: MediaAsset }>(`/api/media/${id}`, {
      signal: AbortSignal.timeout(15_000),
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteMedia: (id: string) =>
    request<{ ok: boolean }>(`/api/media/${id}`, { method: "DELETE" }),

  revealMedia: (id: string) =>
    request<{ ok: boolean }>(`/api/media/${id}/reveal`, { method: "POST" }),

  revealPath: (path: string) =>
    request<{ ok: boolean }>("/api/reveal", { method: "POST", body: JSON.stringify({ path }) }),

  openOutput: () => request<{ ok: boolean }>("/api/open-output", { method: "POST" }),
};

export const frameUrl = (id: string, at: number | "last") =>
  mediaUrl(`/api/media/${id}/frame?at=${at}`);

export const fileUrl = (id: string) => mediaUrl(`/api/media/${id}/file`);
export const downloadUrl = (id: string) => mediaUrl(`/api/media/${id}/download`);
export const thumbUrl = (id: string) => mediaUrl(`/api/media/${id}/thumb`);
