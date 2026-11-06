import fs from "node:fs";
import path from "node:path";
import {
  REGIONS,
  UNITS_LABEL,
  canvasForAspect,
  compileFilmRenderGraph,
  estimateUnits,
  getModel,
  normalizePalette,
} from "@qstudio/core";
import type {
  Entity,
  FilmRenderClip,
  Job,
  JobFilmLink,
  JobSpec,
  MediaAsset,
  PromptRecord,
  Scene,
  Settings,
  Shot,
  ShotTake,
  World,
} from "@qstudio/core";
import { getStoredKey, keyKind, loadSettings, maskKey } from "../config";
import { emit } from "../events";
import { grabFrameAsset, mediaHasAudio } from "../media";
import { enqueue } from "../runner";
import {
  addJob,
  addShot,
  getEntity,
  getJob,
  getMedia,
  getScene,
  getShot,
  getWorld,
  listEntities,
  listJobs,
  listScenes,
  listShots,
  monthUnits,
  sha256,
  uid,
} from "../store";

export function keyStatus() {
  return getStoredKey().then((stored) => {
    if (!stored) return { present: false, prefix: "", source: "none" as const };
    return {
      present: true,
      prefix: maskKey(stored.key),
      source: stored.source,
      kind: keyKind(stored.key),
    };
  });
}

export const healthBody = () => ({
  ok: true,
  app: "Q Studio",
  version: "0.3.0",
  running: listJobs().filter((j) => j.status === "running" || j.status === "queued").length,
});

export async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirBytes(full);
      else if (entry.isFile()) total += (await fs.promises.stat(full)).size;
    }
  } catch {
  }
  return total;
}

export function cleanSettingsPatch(input: unknown): { patch: Partial<Settings>; error?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { patch: {}, error: "Settings must be an object." };
  }
  const body = input as Record<string, unknown>;
  const allowed = new Set([
    "theme",
    "demoMode",
    "profile",
    "region",
    "referenceTransport",
    "concurrencyImages",
    "concurrencyVideo",
    "monthlyCapUnits",
    "outputRoot",
  ]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) return { patch: {}, error: `Unknown setting: ${unknown}.` };
  const patch: Partial<Settings> = {};
  if ("theme" in body) {
    if (body.theme !== "dark" && body.theme !== "light") return { patch, error: "Unknown theme." };
    patch.theme = body.theme;
  }
  if ("demoMode" in body) {
    if (typeof body.demoMode !== "boolean") return { patch, error: "Demo mode must be true or false." };
    patch.demoMode = body.demoMode;
  }
  if ("profile" in body) {
    if (body.profile !== "token-plan" && body.profile !== "payg") {
      return { patch, error: "Unknown API profile." };
    }
    patch.profile = body.profile;
  }
  if ("region" in body) {
    if (typeof body.region !== "string" || !(body.region in REGIONS)) {
      return { patch, error: "Unknown API region." };
    }
    patch.region = body.region;
  }
  if ("referenceTransport" in body) {
    if (!["auto", "base64", "oss"].includes(String(body.referenceTransport))) {
      return { patch, error: "Unknown reference transport." };
    }
    patch.referenceTransport = body.referenceTransport as Settings["referenceTransport"];
  }
  for (const key of ["concurrencyImages", "concurrencyVideo"] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 4) {
      return { patch, error: `${key} must be an integer from 1 to 4.` };
    }
    patch[key] = value;
  }
  if ("monthlyCapUnits" in body) {
    const value = body.monthlyCapUnits;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
      return { patch, error: "Monthly cap must be between 0 and 1,000,000 units." };
    }
    patch.monthlyCapUnits = value;
  }
  if ("outputRoot" in body) {
    if (typeof body.outputRoot !== "string" || !body.outputRoot.trim()) {
      return { patch, error: "Output folder must be a path." };
    }
    const root = body.outputRoot.trim();
    if (!path.isAbsolute(root) || root.length > 4096) {
      return { patch, error: "Output folder must be an absolute path." };
    }
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch (err) {
      return { patch, error: `Cannot create the output folder: ${(err as Error).message}` };
    }
    patch.outputRoot = root;
  }
  return { patch };
}

export function validate(spec: JobSpec): string | null {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return "A job specification is required.";
  if (typeof spec.modelId !== "string" || typeof spec.mode !== "string") {
    return "The job is missing its model or mode.";
  }
  if (!Array.isArray(spec.refs)) return "References must be a list.";
  if (typeof spec.prompt !== "string") return "The prompt must be text.";
  if (!Number.isInteger(spec.n) || spec.n < 1) return "The output count must be a whole number.";
  if (!Number.isFinite(spec.duration) || spec.duration <= 0) return "The duration must be a positive number.";
  if (spec.seed != null && (!Number.isInteger(spec.seed) || spec.seed < 0)) return "The seed must be a non-negative whole number.";
  if (spec.colorPalette && (!Array.isArray(spec.colorPalette) || spec.colorPalette.some((c) => typeof c !== "string"))) {
    return "The colour palette must be a list of colours.";
  }
  const model = getModel(spec.modelId);
  if (model.id !== spec.modelId) return "Unknown model for this Token Plan.";
  if (model.mode !== spec.mode) return "This model belongs to a different mode.";
  if (!spec.prompt.trim() && model.mode !== "image") return "A prompt is required.";
  if (!spec.prompt.trim() && model.mode === "image" && !spec.refs.length)
    return "A prompt is required.";

  const roles = new Set(["reference", "first_frame", "last_frame", "audio", "video"]);
  const counts: Record<string, number> = {};
  for (const ref of spec.refs) {
    if (!ref || typeof ref !== "object" || typeof ref.mediaId !== "string" || !roles.has(ref.role)) {
      return "Every reference needs a media file and a valid role.";
    }
    const media = getMedia(ref.mediaId);
    if (!media) return "A reference file is missing from the library.";
    if (!fs.existsSync(media.filePath)) return `The reference file for "${media.name}" is missing from disk.`;
    counts[ref.role] = (counts[ref.role] ?? 0) + 1;
  }
  if ((counts.reference ?? 0) > model.refs.reference)
    return `${model.label} accepts at most ${model.refs.reference} reference image(s).`;
  if ((counts.first_frame ?? 0) > model.refs.first_frame)
    return `${model.label} accepts one first frame.`;
  if ((counts.last_frame ?? 0) > model.refs.last_frame)
    return `${model.label} accepts one last frame.`;
  if ((counts.audio ?? 0) > model.refs.audio) return `${model.label} accepts at most ${model.refs.audio} audio refs.`;
  if ((counts.video ?? 0) > model.refs.video) return `${model.label} accepts at most ${model.refs.video} video refs.`;
  for (const req of model.refs.required ?? []) {
    if (!counts[req]) return `${model.label} needs at least one ${req.replace("_", " ")}.`;
  }
  if (model.refs.exclusiveFrames && (counts.first_frame || counts.last_frame)) {
    if (counts.reference || counts.audio || counts.video)
      return "First/last frames cannot be mixed with reference materials on Wan 3.0.";
  }
  if (model.mode === "image" && (spec.n < 1 || spec.n > (spec.sequential ? model.n.sequentialMax ?? model.n.max : model.n.max)))
    return `This model supports 1–${spec.sequential ? model.n.sequentialMax ?? model.n.max : model.n.max} images.`;
  if (model.mode === "video") {
    const d = spec.smartDuration ? 5 : spec.duration;
    if (model.duration && (d < model.duration.min || d > model.duration.max))
      return `Duration must be ${model.duration.min}–${model.duration.max}s.`;
  }
  return null;
}

export function specFingerprint(spec: JobSpec): string {
  return sha256(Buffer.from(JSON.stringify(spec)));
}

export type ApiStatus = 400 | 409 | 500;

export class ApiError extends Error {
  status: ApiStatus;
  code?: string;
  job?: Job;
  constructor(status: ApiStatus, message: string, code?: string, job?: Job) {
    super(message);
    this.status = status;
    this.code = code;
    this.job = job;
  }
}

export function apiErrorBody(err: unknown): { status: ApiStatus; body: Record<string, unknown> } {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.job ? { job: err.job } : {}) },
    };
  }
  return { status: 500, body: { error: (err as Error).message || "Request failed." } };
}

export function submitSpec(
  spec: JobSpec,
  opts?: { force?: boolean; film?: JobFilmLink; jobId?: string; resumeTaskId?: string }
): Job {
  const problem = validate(spec);
  if (problem) throw new ApiError(400, problem);
  const settings = loadSettings();
  const units = estimateUnits(spec);
  const cap = settings.monthlyCapUnits ?? 0;
  if (cap > 0 && monthUnits() + units > cap && !opts?.force) {
    throw new ApiError(
      400,
      `Monthly soft cap reached (${monthUnits()} of ${cap} units, ${UNITS_LABEL}). Raise the cap in Settings, or submit again to override.`,
      "CAP"
    );
  }
  try {
    const free = fs.statfsSync(settings.outputRoot);
    if (free.bavail * free.bsize < 500 * 1024 * 1024) {
      throw new ApiError(400, "Less than 500 MB free on the output volume. Free space before generating.");
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }
  if (!opts?.force) {
    const fingerprint = specFingerprint(spec);
    const dup = listJobs().find(
      (j) =>
        (j.status === "queued" || j.status === "running") &&
        specFingerprint(j.spec) === fingerprint &&
        Date.now() - Date.parse(j.createdAt) < 30_000
    );
    if (dup) throw new ApiError(409, "An identical job is already queued or running.", "DUPLICATE", dup);
  }
  const job: Job = {
    id: opts?.jobId ?? uid("job"),
    mode: spec.mode,
    modelId: spec.modelId,
    status: "queued",
    prompt: spec.prompt,
    spec: { ...spec, refs: spec.refs.map((ref) => ({ mediaId: ref.mediaId, role: ref.role })) },
    createdAt: new Date().toISOString(),
    statusNote: opts?.resumeTaskId ? "Queued to resume the provider task" : "Queued",
    taskId: opts?.resumeTaskId,
    assets: [],
    units,
    film: opts?.film,
  };
  addJob(job);
  emit({ type: "job", job });
  enqueue(job.id);
  return job;
}

export function cleanPromptPatch(
  input: unknown,
  current?: PromptRecord
): { patch: Partial<PromptRecord>; error?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { patch: {}, error: "Prompt data must be an object." };
  }
  const body = input as Record<string, unknown>;
  const patch: Partial<PromptRecord> = {};
  if ("recipe" in body) {
    const recipe = body.recipe;
    if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return { patch, error: "Recipe must be an object." };
    const fields = ["identity", "wardrobe", "pose", "expression", "lighting", "background", "camera"] as const;
    const controls = ["preserveFace", "preserveProportions", "preserveOutfit"] as const;
    const value = recipe as Record<string, unknown>;
    if (Object.keys(value).some((key) => ![...fields, ...controls].includes(key as typeof fields[number])) || fields.some((key) => typeof value[key] !== "string" || (value[key] as string).length > 20_000) || controls.some((key) => typeof value[key] !== "boolean")) {
      return { patch, error: "Recipe fields must be strings under 20,000 characters and consistency controls must be boolean." };
    }
    patch.recipe = structuredClone(recipe) as PromptRecord["recipe"];
  }
  if ("exampleMediaIds" in body) {
    if (!Array.isArray(body.exampleMediaIds) || body.exampleMediaIds.length > 12 || body.exampleMediaIds.some((id) => typeof id !== "string" || getMedia(id)?.source !== "generated")) return { patch, error: "Examples must be up to 12 existing generated media items." };
    patch.exampleMediaIds = [...new Set(body.exampleMediaIds)] as string[];
  }
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200) {
      return { patch, error: "Prompt title must be 1 to 200 characters." };
    }
    patch.title = body.title.trim();
  }
  if ("text" in body) {
    if (typeof body.text !== "string" || body.text.length > 1_000_000) {
      return { patch, error: "Prompt text must be a string under 1 MB." };
    }
    patch.text = body.text;
  }
  if ("mode" in body) {
    if (body.mode !== "image" && body.mode !== "video" && body.mode !== "audio") {
      return { patch, error: "Prompt mode must be image, video, or audio." };
    }
    patch.mode = body.mode;
  }
  if ("modelId" in body) {
    if (typeof body.modelId !== "string" || getModel(body.modelId).id !== body.modelId) {
      return { patch, error: "Unknown prompt model." };
    }
    patch.modelId = body.modelId;
  }
  if ("params" in body) {
    if (!body.params || typeof body.params !== "object" || Array.isArray(body.params)) {
      return { patch, error: "Prompt parameters must be an object." };
    }
    patch.params = body.params as Partial<JobSpec>;
  }
  if ("tags" in body) {
    if (
      !Array.isArray(body.tags) ||
      body.tags.length > 30 ||
      body.tags.some((tag) => typeof tag !== "string" || tag.length > 60)
    ) {
      return { patch, error: "Prompt tags must be up to 30 strings of 60 characters or less." };
    }
    patch.tags = [...new Set(body.tags.map((tag) => tag.trim()).filter(Boolean))];
  }
  if ("favorite" in body) {
    if (typeof body.favorite !== "boolean") return { patch, error: "Favourite must be true or false." };
    patch.favorite = body.favorite;
  }
  if ("coverMediaId" in body) {
    if (body.coverMediaId !== undefined && (typeof body.coverMediaId !== "string" || !getMedia(body.coverMediaId))) {
      return { patch, error: "Prompt cover must be an existing media item." };
    }
    patch.coverMediaId = body.coverMediaId as string | undefined;
  }
  if ("notes" in body) {
    if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 20_000)) {
      return { patch, error: "Prompt notes must be under 20,000 characters." };
    }
    patch.notes = body.notes as string | undefined;
  }
  const mode = patch.mode ?? current?.mode;
  const modelId = patch.modelId ?? current?.modelId;
  if (mode && modelId && getModel(modelId).mode !== mode) {
    return { patch, error: "The prompt model does not support that mode." };
  }
  return { patch };
}

export function textField(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function stringsField(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

export function numberField(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function pickFields<T extends object>(body: Record<string, unknown>, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in body) out[k] = body[k];
  return out as Partial<T>;
}

export const SHOT_FIELDS = [
  "sceneId", "title", "action", "dialogue", "speakerEntityId", "framing", "lens", "cameraMove",
  "light", "emotion", "screenDirection", "durationSeconds", "entityIds", "order", "mode",
  "modelId", "status", "continuesFromShotId", "trimIn", "trimOut", "selectedTakeId", "audioMediaIds",
  "audioGain",
];

export function cleanShotPatch(body: Record<string, unknown>): { patch: Partial<Shot>; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { patch: {}, error: "Shot patch must be an object." };
  }
  const patch = pickFields<Shot>(body, SHOT_FIELDS);
  for (const key of ["sceneId", "title", "action", "dialogue", "speakerEntityId", "framing", "lens", "cameraMove", "light", "emotion", "screenDirection", "modelId", "continuesFromShotId", "selectedTakeId"] as const) {
    if (key in patch && patch[key] !== undefined && typeof patch[key] !== "string") {
      return { patch, error: `${key} must be text.` };
    }
  }
  if (patch.entityIds) {
    if (!Array.isArray(patch.entityIds) || patch.entityIds.some((value) => typeof value !== "string")) {
      return { patch, error: "Cast must be a list of entity IDs." };
    }
    patch.entityIds = [...new Set(patch.entityIds)];
  }
  if (patch.audioMediaIds) {
    if (!Array.isArray(patch.audioMediaIds) || patch.audioMediaIds.some((value) => typeof value !== "string")) {
      return { patch, error: "Shot audio must be a list of media IDs." };
    }
    patch.audioMediaIds = [...new Set(patch.audioMediaIds)];
  }
  if ("order" in patch && (typeof patch.order !== "number" || !Number.isFinite(patch.order))) {
    return { patch, error: "Shot order must be a number." };
  }
  if ("durationSeconds" in patch && (typeof patch.durationSeconds !== "number" || !Number.isFinite(patch.durationSeconds) || patch.durationSeconds < 0.1 || patch.durationSeconds > 120)) {
    return { patch, error: "Shot duration must be between 0.1 and 120 seconds." };
  }
  for (const key of ["trimIn", "trimOut"] as const) {
    if (key in patch && patch[key] !== undefined && (typeof patch[key] !== "number" || !Number.isFinite(patch[key]) || patch[key] < 0)) {
      return { patch, error: "Shot trims must be non-negative numbers." };
    }
  }
  if (patch.trimIn !== undefined && patch.trimOut !== undefined && patch.trimOut <= patch.trimIn) {
    return { patch, error: "Shot trim out must come after trim in." };
  }
  if ("audioGain" in patch && (typeof patch.audioGain !== "number" || !Number.isFinite(patch.audioGain) || patch.audioGain < 0 || patch.audioGain > 1)) {
    return { patch, error: "Dialogue gain must be between 0 and 1." };
  }
  if (patch.mode && patch.mode !== "image" && patch.mode !== "video") {
    return { patch, error: "Shot mode must be image or video." };
  }
  if (patch.status && !["draft", "approved", "locked"].includes(patch.status)) {
    return { patch, error: "Unknown shot status." };
  }
  if (patch.modelId && getModel(patch.modelId).id !== patch.modelId) {
    return { patch, error: "Unknown model for this shot." };
  }
  return { patch };
}

export function shotPatchProblem(
  current: Pick<Shot, "id" | "worldId" | "takes" | "mode" | "modelId">,
  patch: Partial<Shot>
): string | null {
  if (patch.sceneId) {
    const scene = getScene(patch.sceneId);
    if (!scene || scene.worldId !== current.worldId) return "Target scene is not part of this world.";
  }
  if (patch.selectedTakeId && !current.takes.some((take) => take.id === patch.selectedTakeId)) {
    return "That take does not belong to this shot.";
  }
  if (patch.entityIds) {
    const entities = new Map(listEntities(current.worldId).map((entity) => [entity.id, entity]));
    if (patch.entityIds.some((id) => !entities.has(id))) return "Every cast member must belong to this world.";
  }
  if (patch.speakerEntityId !== undefined && patch.speakerEntityId) {
    const speaker = getEntity(patch.speakerEntityId);
    if (!speaker || speaker.worldId !== current.worldId) return "The speaker must belong to this world.";
  }
  if (patch.audioMediaIds) {
    const invalid = patch.audioMediaIds.find((id) => getMedia(id)?.kind !== "audio");
    if (invalid) return "Every shot audio reference must be an audio item in the library.";
  }
  if (patch.continuesFromShotId) {
    if (patch.continuesFromShotId === current.id) return "A shot cannot continue from itself.";
    const parent = getShot(patch.continuesFromShotId);
    if (!parent || parent.worldId !== current.worldId) return "The previous shot must belong to this world.";
  }
  const mode = patch.mode ?? current.mode;
  const modelId = patch.modelId ?? current.modelId;
  if (getModel(modelId).mode !== mode) return "The model does not support this shot mode.";
  return null;
}

export function createShotRecord(parentScene: Scene, patch: Partial<Shot>, fallbackTitle: string): Shot {
  const now = new Date().toISOString();
  const siblings = listShots(parentScene.worldId).filter((s) => s.sceneId === parentScene.id);
  return addShot({
    id: uid("sht"),
    worldId: parentScene.worldId,
    sceneId: parentScene.id,
    title: fallbackTitle,
    action: "",
    dialogue: "",
    framing: "Medium shot",
    lens: "",
    cameraMove: "",
    light: "",
    emotion: "",
    screenDirection: "",
    durationSeconds: 5,
    entityIds: [],
    order: siblings.length,
    mode: "video",
    modelId: "wan3.0-video",
    status: "draft",
    takes: [],
    audioMediaIds: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
}

export function selectedTake(shot: Shot) {
  return shot.takes.find((t) => t.id === shot.selectedTakeId) ?? shot.takes[shot.takes.length - 1];
}

export function takeMedia(take: ShotTake, preferred?: "image" | "video" | "audio") {
  const direct = (take.mediaIds ?? []).map(getMedia).filter(Boolean);
  if (direct.length) {
    return direct.find((media) => media!.kind === preferred) ?? direct.find((media) => media!.kind !== "audio") ?? direct[0];
  }
  const job = getJob(take.jobId);
  const asset = (preferred ? job?.assets.find((item) => item.kind === preferred) : undefined) ?? job?.assets[0];
  return asset ? getMedia(asset.id) : undefined;
}

export async function resolveChainFrame(shot: Shot): Promise<string | undefined> {
  if (!shot.continuesFromShotId) return undefined;
  const parent = getShot(shot.continuesFromShotId);
  if (!parent) return undefined;
  const take = selectedTake(parent);
  if (!take) return undefined;
  const media = takeMedia(take);
  if (!media) return undefined;
  if (media.kind === "image") return media.id;
  if (media.kind !== "video") return undefined;
  try {
    const frame = await grabFrameAsset(media, "last");
    return frame.id;
  } catch {
    return undefined;
  }
}

export const shotsRendering = new Set<string>();

export async function buildWorldRenderGraph(worldId: string) {
  const ownerWorld = getWorld(worldId);
  if (!ownerWorld) return null;
  const orderedScenes = listScenes(ownerWorld.id);
  const allShots = listShots(ownerWorld.id);
  const clips: FilmRenderClip[] = [];
  const audioProbes: { clip: FilmRenderClip; media: MediaAsset }[] = [];
  const skipped: string[] = [];
  for (const scene of orderedScenes) {
    const inScene = allShots.filter((shot) => shot.sceneId === scene.id).sort((a, b) => a.order - b.order);
    for (const shot of inScene) {
      const take = selectedTake(shot);
      if (!take) continue;
      const media = takeMedia(take);
      if (!media || (media.kind !== "image" && media.kind !== "video")) {
        skipped.push(shot.title);
        continue;
      }
      const audio = shot.audioMediaIds
        .map(getMedia)
        .filter((item): item is MediaAsset => !!item && item.kind === "audio" && fs.existsSync(item.filePath))
        .map((item) => ({
          id: item.id,
          name: item.name,
          path: item.filePath,
          gain: Math.max(0, Math.min(1, shot.audioGain ?? 1)),
        }));
      const clip: FilmRenderClip = {
        id: shot.id,
        mediaId: media.id,
        name: media.name,
        kind: media.kind,
        path: media.filePath,
        durationSeconds: Math.max(0.1, shot.durationSeconds || 3),
        trimIn: shot.trimIn,
        trimOut: shot.trimOut,
        hasAudio: media.kind === "video" && media.hasAudio === true,
        audio,
      };
      clips.push(clip);
      if (media.kind === "video" && media.hasAudio === undefined) audioProbes.push({ clip, media });
    }
  }
  for (let offset = 0; offset < audioProbes.length; offset += 4) {
    await Promise.all(
      audioProbes.slice(offset, offset + 4).map(async ({ clip, media }) => {
        clip.hasAudio = await mediaHasAudio(media);
      })
    );
  }
  const graph = compileFilmRenderGraph({
    title: ownerWorld.title,
    clips,
    ...canvasForAspect(ownerWorld.aspect || "16:9"),
  });
  return { world: ownerWorld, graph, skipped };
}

export function isInsideDir(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
