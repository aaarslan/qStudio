import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import { getModel } from "@qstudio/core";
import type { JobSpec, MediaAsset, PromptRecord, ShotTake } from "@qstudio/core";
import { THUMB_DIR } from "../config";
import { emit } from "../events";
import {
  ensureThumb,
  extractFrameJpeg,
  grabFrameAsset,
  mimeForFile,
  readRange,
  reveal,
  saveUpload,
  transformImageAsset,
} from "../media";
import { cancel } from "../runner";
import {
  addPrompt,
  decorateMedia,
  getJob,
  getMedia,
  getShot,
  jobReferences,
  listJobs,
  listPrompts,
  mediaReferences,
  removeJob,
  removeMedia,
  removePrompt,
  uid,
  updateMedia,
  updatePrompt,
  updateShot,
} from "../store";
import { apiErrorBody, cleanPromptPatch, submitSpec, validate } from "./shared";

export function registerLibraryRoutes(app: Hono) {
  app.post("/api/upload", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "No file uploaded." }, 400);
    if (file.size > 30 * 1024 * 1024) return c.json({ error: "File is larger than 30 MB." }, 400);
    const asset = await saveUpload(file);
    return c.json({ media: decorateMedia(asset) });
  });

  app.get("/api/media/:id/file", async (c) => {
    const media = getMedia(c.req.param("id"));
    if (!media || !fs.existsSync(media.filePath)) return c.notFound();
    const { start, end, size, partial, unsatisfiable } = readRange(media.filePath, c.req.header("range"));
    c.header("Accept-Ranges", "bytes");
    if (unsatisfiable) {
      c.header("Content-Range", `bytes */${size}`);
      return c.body(null, 416);
    }
    c.header("Content-Type", media.mime || mimeForFile(media.filePath));
    c.header("Cache-Control", "private, max-age=300");
    if (partial) {
      c.status(206);
      c.header("Content-Range", `bytes ${start}-${end}/${size}`);
      c.header("Content-Length", String(end - start + 1));
    } else {
      c.header("Content-Length", String(size));
    }
    const stream = fs.createReadStream(media.filePath, { start, end });
    return c.body(Readable.toWeb(stream) as unknown as ReadableStream);
  });

  app.get("/api/media/:id/download", async (c) => {
    const media = getMedia(c.req.param("id"));
    if (!media || !fs.existsSync(media.filePath)) return c.notFound();
    c.header("Content-Type", media.mime || mimeForFile(media.filePath));
    c.header("Content-Disposition", `attachment; filename="${path.basename(media.filePath).replace(/"/g, "")}"`);
    c.header("Content-Length", String(fs.statSync(media.filePath).size));
    return c.body(Readable.toWeb(fs.createReadStream(media.filePath)) as unknown as ReadableStream);
  });

  app.get("/api/media/:id/thumb", async (c) => {
    const media = getMedia(c.req.param("id"));
    if (!media) return c.notFound();
    const thumb = (await ensureThumb(media)) ?? path.join(THUMB_DIR, `${media.id}.jpg`);
    const file = fs.existsSync(thumb) ? thumb : media.filePath;
    if (!fs.existsSync(file)) return c.notFound();
    c.header("Content-Type", fs.existsSync(thumb) ? "image/jpeg" : media.mime);
    c.header("Cache-Control", "private, max-age=3600");
    return c.body(Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream);
  });

  app.get("/api/media/:id/frame", async (c) => {
    const media = getMedia(c.req.param("id"));
    if (!media || media.kind !== "video") return c.notFound();
    const raw = c.req.query("at") ?? "0";
    const at = raw === "last" ? ("last" as const) : Number(raw);
    if (at !== "last" && (!Number.isFinite(at) || at < 0)) return c.json({ error: "Bad frame time." }, 400);
    try {
      const file = await extractFrameJpeg(media, at);
      c.header("Content-Type", "image/jpeg");
      c.header("Cache-Control", "private, max-age=3600");
      return c.body(Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/media/:id/frame", async (c) => {
    const media = getMedia(c.req.param("id"));
    if (!media || media.kind !== "video") return c.notFound();
    const { at } = (await c.req.json().catch(() => ({}))) as { at?: number | "last" };
    try {
      const asset = await grabFrameAsset(media, at === "last" ? "last" : Number(at ?? 0));
      emit({ type: "media" });
      return c.json({ media: decorateMedia(asset) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/media/:id/transform", async (c) => {
    const media = getMedia(c.req.param("id"));
    if (!media) return c.notFound();
    const body = (await c.req.json()) as {
      crop?: { x: number; y: number; w: number; h: number };
      preset?: string;
      rotate?: 0 | 90 | 180 | 270;
      flipH?: boolean;
    };
    try {
      const asset = await transformImageAsset(media, body);
      emit({ type: "media" });
      return c.json({ media: decorateMedia(asset) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.patch("/api/media/:id", async (c) => {
    const patch = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return c.json({ error: "Media patch must be an object." }, 400);
    }
    const clean: Partial<MediaAsset> = {};
    if ("referenceStatus" in patch) {
      if (patch.referenceStatus !== "candidate" && patch.referenceStatus !== "approved") return c.json({ error: "Reference status must be candidate or approved." }, 400);
      clean.referenceStatus = patch.referenceStatus;
    }
    if ("qualityLabels" in patch) {
      if (!Array.isArray(patch.qualityLabels) || patch.qualityLabels.length > 2 || patch.qualityLabels.some((label) => label !== "best-likeness" && label !== "best-motion")) return c.json({ error: "Unknown quality label." }, 400);
      clean.qualityLabels = [...new Set(patch.qualityLabels)] as MediaAsset["qualityLabels"];
    }
    if ("favorite" in patch) {
      if (typeof patch.favorite !== "boolean") return c.json({ error: "Favourite must be true or false." }, 400);
      clean.favorite = patch.favorite;
    }
    if ("tags" in patch) {
      if (!Array.isArray(patch.tags) || patch.tags.length > 30 || patch.tags.some((tag) => typeof tag !== "string" || tag.length > 60)) {
        return c.json({ error: "Tags must be up to 30 strings of 60 characters or less." }, 400);
      }
      clean.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))];
    }
    for (const key of ["collection", "name", "prompt"] as const) {
      if (!(key in patch)) continue;
      if (typeof patch[key] !== "string" || patch[key].length > 500) {
        return c.json({ error: `${key} must be a string of 500 characters or less.` }, 400);
      }
      clean[key] = patch[key].trim();
    }
    if (!Object.keys(clean).length) return c.json({ error: "No supported media fields were given." }, 400);
    const media = updateMedia(c.req.param("id"), clean);
    if (!media) return c.notFound();
    return c.json({ media: decorateMedia(media) });
  });

  app.delete("/api/media/:id", async (c) => {
    const refs = mediaReferences(c.req.param("id"));
    if (refs.length) {
      return c.json(
        {
          error: `This media is still used by ${refs.slice(0, 3).join(", ")}. Remove those references first.`,
          code: "REFERENCED",
          references: refs,
        },
        409
      );
    }
    const media = removeMedia(c.req.param("id"));
    if (!media) return c.notFound();
    if (c.req.query("file") !== "keep") {
      try {
        fs.rmSync(media.filePath, { force: true });
        fs.rmSync(path.join(THUMB_DIR, `${media.id}.jpg`), { force: true });
      } catch {
      }
    }
    emit({ type: "media" });
    return c.json({ ok: true });
  });

  app.post("/api/media/:id/reveal", async (c) => {
    const media = getMedia(c.req.param("id"));
    if (!media) return c.notFound();
    await reveal(media.filePath);
    return c.json({ ok: true });
  });

  app.post("/api/jobs", async (c) => {
    const body = (await c.req.json()) as { spec: JobSpec; promptId?: string; force?: boolean };
    try {
      const job = submitSpec(body.spec, { force: body.force });
      if (body.promptId) {
        const p = listPrompts().find((x) => x.id === body.promptId);
        if (p) {
          updatePrompt(p.id, { useCount: p.useCount + 1, lastUsedAt: new Date().toISOString() });
        }
      }
      return c.json({ job });
    } catch (err) {
      const { status, body: payload } = apiErrorBody(err);
      return c.json(payload, status);
    }
  });

  app.get("/api/jobs", (c) => c.json({ jobs: listJobs() }));

  app.get("/api/jobs/:id", (c) => {
    const job = getJob(c.req.param("id"));
    if (!job) return c.notFound();
    return c.json({ job });
  });

  app.post("/api/jobs/:id/retry", async (c) => {
    const previous = getJob(c.req.param("id"));
    if (!previous) return c.notFound();
    if (previous.status === "queued" || previous.status === "running") {
      return c.json({ error: "That job is still active." }, 400);
    }
    const problem = validate(previous.spec);
    if (problem) return c.json({ error: problem }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { force?: boolean; resume?: boolean };
    const priorMessage = `${previous.statusNote ?? ""} ${previous.error?.message ?? ""}`;
    const resumeTaskId =
      previous.taskId && !previous.assets.length &&
      (body.resume === true ||
        /timed out|timeout|download failed|connection lost|provider was unavailable|still finish|fetch failed|econn/i.test(
          priorMessage
        ))
        ? previous.taskId
        : undefined;
    const jobId = uid("job");
    let film = previous.film;
    let restore: { shotId: string; takes: ShotTake[]; selectedTakeId?: string } | null = null;
    if (film) {
      const target = getShot(film.shotId);
      const existing = target?.takes.find((take) => take.id === film!.takeId);
      if (target && existing) {
        restore = {
          shotId: target.id,
          takes: target.takes.map((take) => ({ ...take, mediaIds: take.mediaIds ? [...take.mediaIds] : take.mediaIds })),
          selectedTakeId: target.selectedTakeId,
        };
        if (previous.status !== "succeeded" && !existing.mediaIds?.length) {
          existing.jobId = jobId;
          existing.createdAt = new Date().toISOString();
          existing.verdict = null;
          existing.drift = undefined;
          updateShot(target.id, { takes: target.takes.map((take) => (take.id === existing.id ? existing : take)) });
        } else {
          const nextTake: ShotTake = {
            ...existing,
            id: uid("take"),
            jobId,
            label: `Take ${target.takes.length + 1}`,
            createdAt: new Date().toISOString(),
            verdict: null,
            drift: undefined,
            mediaIds: [],
          };
          updateShot(target.id, { takes: [...target.takes, nextTake] });
          film = { ...film, takeId: nextTake.id };
        }
      }
    }
    try {
      const job = submitSpec(previous.spec, {
        force: body.force,
        film,
        jobId,
        resumeTaskId,
      });
      emit({ type: "film" });
      return c.json({ job });
    } catch (err) {
      if (restore) {
        updateShot(restore.shotId, { takes: restore.takes, selectedTakeId: restore.selectedTakeId });
        emit({ type: "film" });
      }
      const { status, body: payload } = apiErrorBody(err);
      return c.json(payload, status);
    }
  });

  app.post("/api/jobs/:id/cancel", async (c) => {
    await cancel(c.req.param("id"));
    const job = getJob(c.req.param("id"));
    return c.json({ job });
  });

  app.delete("/api/jobs/:id", (c) => {
    const refs = jobReferences(c.req.param("id"));
    if (refs.length) {
      return c.json(
        { error: `This job is still used by ${refs.slice(0, 3).join(", ")}.`, code: "REFERENCED", references: refs },
        409
      );
    }
    removeJob(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/api/prompts", (c) => c.json({ prompts: listPrompts() }));

  app.post("/api/prompts", async (c) => {
    const body = await c.req.json().catch(() => null);
    const { patch, error } = cleanPromptPatch(body);
    if (error) return c.json({ error }, 400);
    const mode = patch.mode ?? "image";
    const modelId = patch.modelId ?? getModel("qwen-image-3.0-pro").id;
    if (getModel(modelId).mode !== mode) return c.json({ error: "The prompt model does not support that mode." }, 400);
    const prompt: PromptRecord = {
      id: uid("prm"),
      title: patch.title ?? "Untitled prompt",
      text: patch.text ?? "",
      mode,
      modelId,
      params: patch.params ?? {},
      tags: patch.tags ?? [],
      favorite: patch.favorite ?? false,
      useCount: 0,
      createdAt: new Date().toISOString(),
      coverMediaId: patch.coverMediaId,
      notes: patch.notes,
      recipe: patch.recipe,
      exampleMediaIds: patch.exampleMediaIds,
    };
    addPrompt(prompt);
    return c.json({ prompt });
  });

  app.patch("/api/prompts/:id", async (c) => {
    const current = listPrompts().find((p) => p.id === c.req.param("id"));
    if (!current) return c.notFound();
    const body = await c.req.json().catch(() => null);
    const { patch, error } = cleanPromptPatch(body, current);
    if (error) return c.json({ error }, 400);
    const contentChanged =
      (patch.text !== undefined && patch.text !== current.text) ||
      (patch.title !== undefined && patch.title !== current.title) ||
      (patch.params !== undefined && JSON.stringify(patch.params) !== JSON.stringify(current.params)) ||
      (patch.recipe !== undefined && JSON.stringify(patch.recipe) !== JSON.stringify(current.recipe));
    if (contentChanged) {
      const snapshot = {
        title: current.title,
        text: current.text,
        params: current.params,
        recipe: current.recipe,
        editedAt: new Date().toISOString(),
      };
      patch.history = [snapshot, ...(current.history ?? [])].slice(0, 20);
    }
    const prompt = updatePrompt(c.req.param("id"), patch);
    if (!prompt) return c.notFound();
    return c.json({ prompt });
  });

  app.delete("/api/prompts/:id", (c) => {
    removePrompt(c.req.param("id"));
    return c.json({ ok: true });
  });
}
