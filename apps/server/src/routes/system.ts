import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { MODELS, UNITS_LABEL } from "@qstudio/core";
import {
  APP_DIR,
  DATA_DIR,
  THUMB_DIR,
  clearStoredKey,
  effectiveBaseUrl,
  keyKind,
  loadSettings,
  saveSettings,
  setStoredKey,
} from "../config";
import { currentRevision, emit, eventInstanceId, subscribe } from "../events";
import { importLocalFiles, mediaTools, reveal } from "../media";
import { listLocalExports } from "../render-exports";
import {
  decorateMedia,
  integrityReport,
  jobReferences,
  listEntities,
  listJobs,
  listMedia,
  listPrompts,
  listScenes,
  listShots,
  listUsage,
  listWorlds,
  mediaReferences,
  monthUnits,
  removeJob,
  removeMedia,
  searchAll,
  searchFilm,
  stats,
} from "../store";
import { cleanSettingsPatch, dirBytes, healthBody, isInsideDir, keyStatus } from "./shared";

export function registerSystemRoutes(app: Hono) {
  app.get("/api/state", async (c) => {
    const settings = loadSettings();
    return c.json({
      settings,
      key: await keyStatus(),
      models: MODELS,
      jobs: listJobs(),
      media: listMedia().map(decorateMedia),
      prompts: listPrompts(),
      worlds: listWorlds(),
      entities: listEntities(),
      scenes: listScenes(),
      shots: listShots(),
      stats: stats(),
      exports: listLocalExports(),
      baseUrl: effectiveBaseUrl(settings),
      outputRoot: settings.outputRoot,
      usage: {
        monthUnits: monthUnits(),
        capUnits: settings.monthlyCapUnits ?? 0,
        label: UNITS_LABEL,
      },
      tools: mediaTools(),
      integrity: integrityReport(),
      revision: currentRevision(),
      engineInstance: eventInstanceId,
    });
  });

  app.get("/api/health", (c) => c.json(healthBody()));
  app.get("/health", (c) => c.json(healthBody()));

  app.get("/api/usage", (c) =>
    c.json({ entries: listUsage(200), monthUnits: monthUnits(), label: UNITS_LABEL })
  );

  app.get("/api/storage", async (c) => {
    const media = listMedia();
    const byKind = { image: 0, video: 0, audio: 0 };
    let mediaBytes = 0;
    for (const m of media) {
      byKind[m.kind] += m.bytes;
      mediaBytes += m.bytes;
    }
    const jobs = listJobs();
    return c.json({
      mediaBytes,
      byKind,
      mediaCount: media.length,
      demoCount: media.filter((m) => jobs.find((j) => j.id === m.jobId)?.demo).length,
      thumbsBytes: await dirBytes(THUMB_DIR),
      dbBytes: await dirBytes(DATA_DIR),
      outputRoot: loadSettings().outputRoot,
      deadJobs: jobs.filter((j) => j.status === "failed" || j.status === "canceled").length,
    });
  });

  app.post("/api/storage/prune", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      demo?: boolean;
      olderThanDays?: number;
      thumbs?: boolean;
      deadJobs?: boolean;
    };
    const jobs = listJobs();
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const cutoff =
      body.olderThanDays && body.olderThanDays > 0
        ? Date.now() - body.olderThanDays * 86_400_000
        : null;
    let removedMedia = 0;
    let removedJobs = 0;
    let freedBytes = 0;
    for (const m of [...listMedia()]) {
      const isDemo = !!jobById.get(m.jobId ?? "")?.demo;
      const isOld =
        cutoff !== null && m.source === "generated" && !m.favorite && Date.parse(m.createdAt) < cutoff;
      if (!((body.demo && isDemo) || isOld)) continue;
      if (mediaReferences(m.id).length) continue;
      const removed = removeMedia(m.id);
      if (!removed) continue;
      removedMedia++;
      freedBytes += removed.bytes;
      try {
        fs.rmSync(removed.filePath, { force: true });
        fs.rmSync(path.join(THUMB_DIR, `${removed.id}.jpg`), { force: true });
      } catch {
      }
    }
    if (body.thumbs) {
      freedBytes += await dirBytes(THUMB_DIR);
      fs.rmSync(THUMB_DIR, { recursive: true, force: true });
      fs.mkdirSync(THUMB_DIR, { recursive: true });
    }
    if (body.deadJobs) {
      for (const j of [...listJobs()]) {
        if (j.status === "failed" || j.status === "canceled") {
          if (jobReferences(j.id).length) continue;
          removeJob(j.id);
          removedJobs++;
        }
      }
    }
    emit({ type: "media" });
    return c.json({ ok: true, removedMedia, removedJobs, freedBytes });
  });

  app.get("/api/search", (c) => {
    const q = c.req.query("q") ?? "";
    const found = searchAll(q);
    return c.json({
      prompts: found.prompts,
      media: found.media.map(decorateMedia),
      film: searchFilm(q),
    });
  });

  app.get("/api/logs", async (c) => {
    const logPath = process.env.QSTUDIO_LOG ?? "";
    if (!logPath || !fs.existsSync(logPath)) {
      return c.json({ lines: [], note: "Engine log file is only available inside the desktop app." });
    }
    const handle = await fs.promises.open(logPath, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, 256 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      const text = buffer.toString("utf8");
      const lines = text.split("\n");
      if (length < stat.size) lines.shift();
      return c.json({ lines: lines.slice(-300) });
    } finally {
      await handle.close();
    }
  });

  app.post("/api/import", async (c) => {
    const { paths } = (await c.req.json()) as { paths?: unknown };
    if (!Array.isArray(paths) || !paths.length) return c.json({ error: "No paths given." }, 400);
    if (paths.length > 100 || paths.some((item) => typeof item !== "string")) {
      return c.json({ error: "Import at most 100 local file paths at a time." }, 400);
    }
    const media = await importLocalFiles(paths as string[]);
    if (!media.length) return c.json({ error: "None of those files could be imported." }, 400);
    emit({ type: "media" });
    return c.json({ media: media.map(decorateMedia) });
  });

  app.post("/api/settings", async (c) => {
    const body = await c.req.json().catch(() => null);
    const { patch, error } = cleanSettingsPatch(body);
    if (error) return c.json({ error }, 400);
    const next = { ...loadSettings(), ...patch };
    saveSettings(next);
    return c.json({ settings: next });
  });

  app.post("/api/open-output", async (c) => {
    const root = loadSettings().outputRoot;
    fs.mkdirSync(root, { recursive: true });
    await reveal(path.join(root, "."));
    return c.json({ ok: true });
  });

  app.get("/api/key", async (c) => c.json(await keyStatus()));

  app.post("/api/key", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { key?: unknown; remember?: unknown };
    if (typeof body.key !== "string") return c.json({ error: "The API key must be text." }, 400);
    if (body.remember !== undefined && typeof body.remember !== "boolean") {
      return c.json({ error: "Remember must be true or false." }, 400);
    }
    const trimmed = body.key.trim();
    if (trimmed.length < 12 || trimmed.length > 256) return c.json({ error: "That key length looks wrong." }, 400);
    if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
      return c.json({ error: "The API key contains unsupported characters." }, 400);
    }
    if (keyKind(trimmed) === "unknown") {
      return c.json({ error: "Keys start with sk-sp- (Token Plan) or sk- / sk-ws- (pay-as-you-go)." }, 400);
    }
    const source = await setStoredKey(trimmed, body.remember !== false);
    return c.json({ ok: true, key: await keyStatus(), source });
  });

  app.delete("/api/key", async (c) => {
    await clearStoredKey();
    return c.json({ ok: true, key: await keyStatus() });
  });

  app.post("/api/reveal", async (c) => {
    const { path: target } = (await c.req.json()) as { path?: string };
    if (!target) return c.json({ error: "No path." }, 400);
    const root = loadSettings().outputRoot;
    const resolved = path.resolve(target);
    if (!isInsideDir(root, resolved) && !isInsideDir(APP_DIR, resolved)) {
      return c.json({ error: "Path is outside the Q Studio folders." }, 400);
    }
    await reveal(resolved);
    return c.json({ ok: true });
  });

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "snapshot",
        data: JSON.stringify({
          jobs: listJobs(),
          revision: currentRevision(),
          instanceId: eventInstanceId,
        }),
      });
      let unsubscribe = () => {};
      let heartbeat: NodeJS.Timeout | null = null;
      await new Promise<void>((resolve) => {
        unsubscribe = subscribe(async (event) => {
          try {
            await stream.writeSSE({ event: "update", data: JSON.stringify(event) });
          } catch {
          }
        });
        heartbeat = setInterval(() => {
          stream.writeSSE({ event: "ping", data: "1" }).catch(() => {});
        }, 20_000);
        stream.onAbort(() => resolve());
      });
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    })
  );
}
