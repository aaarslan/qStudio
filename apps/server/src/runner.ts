import fsp from "node:fs/promises";
import path from "node:path";
import {
  buildRequest,
  extractImageUrls,
  extractTaskId,
  extractTaskStatus,
  extractVideoUrl,
  extractAudioUrl,
  getModel,
  parseError,
  reusableRemoteUrl,
  sanitizeRequest,
  TOKEN_PLAN_BASE,
  slugify,
} from "@qstudio/core";
import type { Job, JobAsset, JobStatus, ModelDef, ResolvedRef } from "@qstudio/core";
import { canTransitionJobStatus, isTerminalJobStatus } from "@qstudio/core";
import { effectiveBaseUrl, getStoredKey, loadSettings } from "./config";
import { emit } from "./events";
import {
  downloadToFile,
  discardMediaAsset,
  mockAudio,
  mockImage,
  mockVideo,
  outputDir,
  persistMedia,
  reserveUniquePath,
} from "./media";
import { addUsage, attachTakeResult, getJob, getMedia, listJobs, uid, updateJob } from "./store";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

function bounded(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

const inflight = new Map<string, AbortController>();

function now() {
  return new Date().toISOString();
}

function patch(id: string, p: Partial<Job>) {
  const current = getJob(id);
  if (!current) return undefined;
  if (p.status && !canTransitionJobStatus(current.status, p.status)) return undefined;
  const job = updateJob(id, p);
  if (job) {
    if (p.status === "succeeded") {
      try {
        const shot = attachTakeResult(job);
        if (shot) emit({ type: "film" });
      } catch {
      }
    }
    if (p.status && isTerminalJobStatus(p.status)) {
      try {
        addUsage({
          id: uid("use"),
          jobId: job.id,
          modelId: job.modelId,
          mode: job.mode,
          units: job.units ?? 0,
          status: job.status,
          createdAt: job.finishedAt ?? now(),
          filePath: job.assets[0]?.filePath,
        });
      } catch {
      }
    }
    emit({ type: "job", job });
  }
  return job;
}

function transition(id: string, status: JobStatus, p: Partial<Job> = {}) {
  return patch(id, { ...p, status });
}

/* ----------------------------- refs ----------------------------- */

async function uploadOss(
  baseUrl: string,
  key: string,
  model: string,
  media: { filePath: string; mime: string; name: string },
  signal: AbortSignal
): Promise<string> {
  const policyRes = await fetch(
    `${baseUrl}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    { headers: { Authorization: `Bearer ${key}` }, signal: bounded(signal, 60_000) }
  );
  if (!policyRes.ok) {
    throw new Error(`Upload policy unavailable (HTTP ${policyRes.status})`);
  }
  const data = ((await policyRes.json()) as any).data;
  if (!data?.upload_host) throw new Error("Upload policy response was incomplete");
  throwIfAborted(signal);

  const buf = await fsp.readFile(media.filePath);
  throwIfAborted(signal);
  const safeName = media.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectKey = `${data.upload_dir}/${Date.now()}_${safeName}`;
  const form = new FormData();
  form.append("OSSAccessKeyId", data.oss_access_key_id);
  form.append("Signature", data.signature);
  form.append("policy", data.policy);
  form.append("x-oss-object-acl", data.x_oss_object_acl);
  form.append("x-oss-forbid-overwrite", data.x_oss_forbid_overwrite);
  form.append("key", objectKey);
  form.append("success_action_status", "200");
  form.append("file", new Blob([buf], { type: media.mime }), safeName);

  const up = await fetch(data.upload_host, {
    method: "POST",
    body: form,
    signal: bounded(signal, 120_000),
  });
  if (!up.ok) throw new Error(`Upload failed (HTTP ${up.status})`);
  throwIfAborted(signal);
  return `oss://${objectKey}`;
}

export async function resolveRefs(
  job: Job,
  model: ModelDef,
  opts: { key: string | null; baseUrl: string; demo: boolean; signal: AbortSignal }
): Promise<ResolvedRef[]> {
  const settings = loadSettings();
  const out: ResolvedRef[] = [];
  for (const ref of job.spec.refs) {
    throwIfAborted(opts.signal);
    const media = getMedia(ref.mediaId);
    if (!media) throw new Error("A reference file is missing from the library.");
    const needsUrl = media.kind === "video" || media.kind === "audio";
    const transport = settings.referenceTransport;

    const preferBase64 =
      opts.demo || transport === "base64" || (!needsUrl && transport !== "oss");

    if (needsUrl && !preferBase64) {
      const hosted =
        reusableRemoteUrl(media.sourceUrl) ??
        reusableRemoteUrl(
          media.jobId
            ? getJob(media.jobId)?.assets.find((a) => a.id === media.id)?.sourceUrl
            : undefined
        );
      if (hosted) {
        out.push({ mediaId: media.id, role: ref.role, url: hosted, mime: media.mime });
        continue;
      }
    }

    const asDataUrl = async () => {
      const buf = await fsp.readFile(media.filePath);
      throwIfAborted(opts.signal);
      return `data:${media.mime};base64,${buf.toString("base64")}`;
    };

    if (preferBase64 || !opts.key) {
      const dataUrl = await asDataUrl();
      out.push({ mediaId: media.id, role: ref.role, url: dataUrl, mime: media.mime });
      continue;
    }
    try {
      const url = await uploadOss(opts.baseUrl, opts.key, model.id, media, opts.signal);
      out.push({ mediaId: media.id, role: ref.role, url, mime: media.mime });
    } catch (err) {
      if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (media.kind === "image") {
        const dataUrl = await asDataUrl();
        out.push({ mediaId: media.id, role: ref.role, url: dataUrl, mime: media.mime });
      } else if (opts.baseUrl.replace(/\/$/, "") === TOKEN_PLAN_BASE) {
        throw new Error(
          `Could not send "${media.name}" to ${model.label}. Video and audio references need QwenCloud temporary upload, which the Token Plan gateway does not provide. Use an image reference instead, chain a clip generated in the last 24 hours so its hosted URL can be reused, or switch to a pay-as-you-go key in Settings.`
        );
      } else {
        throw new Error(
          `Could not upload "${media.name}" for ${model.label}. ${
            (err as Error).message
          }. Check the key and region in Settings, or use an image reference instead.`
        );
      }
    }
  }
  return out;
}

/* ----------------------------- runner ----------------------------- */

const queues: Record<string, string[]> = { image: [], video: [], audio: [] };
const active: Record<string, number> = { image: 0, video: 0, audio: 0 };

export function enqueue(jobId: string) {
  const job = getJob(jobId);
  if (!job || isTerminalJobStatus(job.status)) return;
  queues[job.mode].push(jobId);
  pump();
}

function capacity(mode: string) {
  const s = loadSettings();
  const configured = mode === "image" ? s.concurrencyImages : s.concurrencyVideo;
  return Math.min(4, Math.max(1, Math.floor(configured) || 1));
}

function pump() {
  for (const mode of ["image", "video", "audio"] as const) {
    while (queues[mode].length && active[mode] < capacity(mode)) {
      const id = queues[mode].shift()!;
      const job = getJob(id);
      if (!job || isTerminalJobStatus(job.status)) continue;
      active[mode]++;
      execute(id)
        .catch(() => {})
        .finally(() => {
          active[mode]--;
          pump();
        });
    }
  }
}

export async function cancel(jobId: string) {
  const job = getJob(jobId);
  if (!job || isTerminalJobStatus(job.status)) return job;
  queues[job.mode] = queues[job.mode].filter((id) => id !== jobId);
  inflight.get(jobId)?.abort();
  transition(jobId, "canceled", { finishedAt: now(), statusNote: "Canceled" });
  const current = getJob(jobId);
  if (job.taskId) {
    try {
      const stored = await getStoredKey();
      if (stored) {
        void fetch(`${effectiveBaseUrl(loadSettings())}/api/v1/tasks/${job.taskId}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${stored.key}` },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => {});
      }
    } catch {
    }
  }
  return current;
}

export function resume() {
  for (const job of listJobs()) {
    if (job.status === "queued" || job.status === "running") {
      if (job.status === "running") transition(job.id, "queued", { statusNote: "Resuming…" });
      enqueue(job.id);
    }
  }
}

async function execute(jobId: string) {
  const job = getJob(jobId);
  if (!job || isTerminalJobStatus(job.status)) return;
  const controller = new AbortController();
  inflight.set(jobId, controller);
  const signal = controller.signal;
  const model = getModel(job.spec.modelId);
  let terminal = false;

  try {
    const settings = loadSettings();
    const stored = await getStoredKey();
    throwIfAborted(signal);
    const demo = settings.demoMode || !stored;
    const baseUrl = effectiveBaseUrl(settings);

    if (!transition(jobId, "running", { startedAt: now(), statusNote: demo ? "Rendering demo…" : "Submitting…" })) {
      terminal = true;
      return;
    }

    if (demo) {
      try {
        const refs = await resolveRefs(job, model, {
          key: stored?.key ?? null,
          baseUrl,
          demo: true,
          signal,
        });
        throwIfAborted(signal);
        const req = buildRequest(model, job.spec, refs, baseUrl);
        patch(jobId, { request: sanitizeRequest(req) });
      } catch (err) {
        if (signal.aborted) throw err;
      }
      await runDemo(job, model, signal);
      terminal = true;
      return;
    }
    if (!stored) throw new Error("No API key");

    const refs = await resolveRefs(job, model, { key: stored.key, baseUrl, demo: false, signal });
    throwIfAborted(signal);
    const req = buildRequest(model, job.spec, refs, baseUrl);
    patch(jobId, {
      request: sanitizeRequest(req),
      statusNote: "Submitting…",
    });
    throwIfAborted(signal);

    if (model.mode === "video") {
      await runVideo(job, model, req, stored.key, signal);
    } else if (model.mode === "image") {
      await runImage(job, model, req, stored.key, signal);
    } else {
      await runAudio(job, model, req, stored.key, signal);
    }
    terminal = true;
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === "AbortError") {
      const cur = getJob(jobId);
      if (cur && !isTerminalJobStatus(cur.status)) {
        transition(jobId, "canceled", { finishedAt: now(), statusNote: "Canceled" });
      }
      terminal = true;
      return;
    }
    const e = err as Error & { code?: string; hint?: string };
    console.error("[job]", jobId, e);
    const failed = transition(jobId, "failed", {
      finishedAt: now(),
      statusNote: e.code ? String(e.code) : "Failed",
      error: {
        code: e.code,
        message: e.message || "Generation failed",
        hint: e.hint,
      },
    });
    terminal = !!failed;
  } finally {
    if (inflight.get(jobId) === controller) inflight.delete(jobId);
    if (!terminal) {
      const current = getJob(jobId);
      if (current && !isTerminalJobStatus(current.status)) {
        transition(jobId, "failed", {
          finishedAt: now(),
          statusNote: "Failed",
          error: { message: "The job stopped unexpectedly." },
        });
      }
    }
  }
}

/* ----------------------------- images ----------------------------- */

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal
) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: bounded(signal, 180_000),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, text, json };
}

async function runImage(
  job: Job,
  model: ModelDef,
  req: ReturnType<typeof buildRequest>,
  key: string,
  signal: AbortSignal
) {
  let urls: string[] = [];
  let taskId = job.taskId;

  if (taskId) {
    patch(job.id, { statusNote: "Resuming task…" });
    const done = await pollTask(job.id, taskId, key, 3_000, 5 * 60_000, signal);
    urls = extractImageUrls(done);
  } else {
    throwIfAborted(signal);
    let submission = await postJson(
      req.url,
      { ...req.headers, Authorization: `Bearer ${key}` },
      req.body,
      signal
    );

    if (!submission.res.ok && /does not support synchronous calls/i.test(submission.text)) {
      const asyncReq = {
        ...req,
        headers: { ...req.headers, "X-DashScope-Async": "enable" },
      };
      patch(job.id, { request: sanitizeRequest(asyncReq), statusNote: "Retrying as an async task…" });
      throwIfAborted(signal);
      submission = await postJson(
        asyncReq.url,
        { ...asyncReq.headers, Authorization: `Bearer ${key}` },
        asyncReq.body,
        signal
      );
    }

    if (!submission.res.ok) {
      const e = parseError(submission.res.status, submission.text, submission.json);
      throw Object.assign(new Error(e.message), { code: e.code, hint: e.hint });
    }

    urls = extractImageUrls(submission.json);
    taskId = extractTaskId(submission.json);
    if (taskId) patch(job.id, { taskId });
    if (!urls.length && taskId) {
      const done = await pollTask(job.id, taskId, key, 3_000, 5 * 60_000, signal);
      urls = extractImageUrls(done);
    }
  }

  if (!urls.length) {
    throw new Error("The response contained no image. Check the Request panel for the raw payload.");
  }

  patch(job.id, { taskId, statusNote: "Downloading…" });
  const assets = [];
  const slug = slugify(job.spec.prompt);
  for (let i = 0; i < urls.length; i++) {
    throwIfAborted(signal);
    const dl = await downloadToFile(urls[i], outputDir("image"), slug, "image", signal);
    throwIfAborted(signal);
    const { assetOut } = await persistMedia({
      filePath: dl.filePath,
      name: path.basename(dl.filePath),
      mime: dl.mime,
      kind: "image",
      source: "generated",
      dir: outputDir("image"),
      slug: urls.length > 1 ? `${slug}-${i + 1}` : slug,
      prompt: job.spec.prompt,
      jobId: job.id,
      sourceUrl: urls[i],
      signal,
    });
    assets.push(assetOut);
  }

  transition(job.id, "succeeded", {
    finishedAt: now(),
    statusNote: `${assets.length} image${assets.length > 1 ? "s" : ""} saved`,
    assets,
  });
}

/* ----------------------------- video ----------------------------- */

async function runVideo(
  job: Job,
  model: ModelDef,
  req: ReturnType<typeof buildRequest>,
  key: string,
  signal: AbortSignal
) {
  let taskId = job.taskId;
  if (!taskId) {
    throwIfAborted(signal);
    const res = await fetch(req.url, {
      method: "POST",
      headers: { ...req.headers, Authorization: `Bearer ${key}` },
      body: JSON.stringify(req.body),
      signal: bounded(signal, 180_000),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const e = parseError(res.status, text, json);
      throw Object.assign(new Error(e.message), { code: e.code, hint: e.hint });
    }
    taskId = extractTaskId(json);
    if (!taskId) throw new Error("Video submission did not return a task_id");
    patch(job.id, { taskId, statusNote: "Queued at QwenCloud…" });
  }

  const done = await pollTask(job.id, taskId, key, 15_000, 20 * 60_000, signal);
  const videoUrl = extractVideoUrl(done);
  if (!videoUrl) throw new Error("Task succeeded but returned no video URL");

  patch(job.id, { statusNote: "Downloading…" });
  const slug = slugify(job.spec.prompt);
  throwIfAborted(signal);
  const dl = await downloadToFile(videoUrl, outputDir("video"), slug, "video", signal);
  throwIfAborted(signal);
  const { assetOut } = await persistMedia({
    filePath: dl.filePath,
    name: path.basename(dl.filePath),
    mime: dl.mime,
    kind: "video",
    source: "generated",
    dir: outputDir("video"),
    slug,
    prompt: job.spec.prompt,
    jobId: job.id,
    sourceUrl: videoUrl,
    signal,
  });
  transition(job.id, "succeeded", {
    finishedAt: now(),
    statusNote: "Video saved",
    assets: [assetOut],
  });
}

async function pollTask(
  jobId: string,
  taskId: string,
  key: string,
  initial: number,
  timeout: number,
  signal: AbortSignal
) {
  let interval = initial;
  let elapsed = 0;
  const started = Date.now();
  while (elapsed < timeout) {
    elapsed = Date.now() - started;
    if (elapsed >= timeout) break;
    const job = getJob(jobId);
    if (!job || isTerminalJobStatus(job.status)) throw new DOMException("Aborted", "AbortError");
    throwIfAborted(signal);
    await sleep(interval, signal);
    elapsed = Date.now() - started;
    if (elapsed >= timeout) break;
    throwIfAborted(signal);
    let res: Response;
    try {
      res = await fetch(`${effectiveBaseUrl(loadSettings())}/api/v1/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: bounded(signal, 45_000),
      });
    } catch (err) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (Date.now() - started >= timeout) throw err;
      patch(jobId, { statusNote: "Connection lost; retrying task status…" });
      interval = Math.min(Math.round(interval * 1.5), 45_000);
      continue;
    }
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (res.status === 429 || res.status === 408 || res.status >= 500) {
      if (Date.now() - started >= timeout) {
        throw new Error("The task timed out while the provider was unavailable.");
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 45_000) : interval;
      patch(jobId, { statusNote: "Provider busy; checking again shortly…" });
      await sleep(wait, signal);
      if (Date.now() - started >= timeout) break;
      interval = Math.min(Math.round(interval * 1.5), 45_000);
      continue;
    }
    if (!res.ok) {
      const e = parseError(res.status, text, json);
      throw Object.assign(new Error(e.message), { code: e.code, hint: e.hint });
    }
    const status = extractTaskStatus(json);
    const secs = Math.round((Date.now() - started) / 1000);
    if (status === "succeeded") return json;
    if (status === "failed") {
      const e = parseError(res.status, text, json);
      throw Object.assign(new Error(e.message), { code: e.code, hint: e.hint });
    }
    patch(jobId, { statusNote: `Generating… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` });
    interval = Math.min(Math.round(interval * 1.5), 45_000);
  }
  throw new Error("The task timed out. It may still finish at QwenCloud — check the task ID before retrying.");
}

/* ----------------------------- audio ----------------------------- */

async function runAudio(
  job: Job,
  model: ModelDef,
  req: ReturnType<typeof buildRequest>,
  key: string,
  signal: AbortSignal
) {
  throwIfAborted(signal);
  const res = await fetch(req.url, {
    method: "POST",
    headers: { ...req.headers, Authorization: `Bearer ${key}` },
    body: JSON.stringify(req.body),
    signal: bounded(signal, 180_000),
  });
  const ctype = res.headers.get("content-type") ?? "";
  const slug = slugify(job.spec.prompt);
  const format = job.spec.format ?? "mp3";

  if (!res.ok) {
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const e = parseError(res.status, text, json);
    throw Object.assign(new Error(e.message), { code: e.code, hint: e.hint });
  }

  if (ctype.includes("json")) {
    const json = (await res.json()) as unknown;
    const url = extractAudioUrl(json);
    if (!url) throw new Error("TTS response did not include an audio URL");
    patch(job.id, { statusNote: "Downloading…" });
    throwIfAborted(signal);
    const dl = await downloadToFile(url, outputDir("audio"), slug, "audio", signal);
    throwIfAborted(signal);
    const { assetOut } = await persistMedia({
      filePath: dl.filePath,
      name: path.basename(dl.filePath),
      mime: dl.mime,
      kind: "audio",
      source: "generated",
      dir: outputDir("audio"),
      slug,
      prompt: job.spec.prompt,
      jobId: job.id,
      sourceUrl: url,
      signal,
    });
    transition(job.id, "succeeded", { finishedAt: now(), statusNote: "Audio saved", assets: [assetOut] });
    return;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  throwIfAborted(signal);
  const { assetOut } = await persistMedia({
    buffer: buf,
    name: `${slug}.${format}`,
    mime: format === "wav" ? "audio/wav" : "audio/mpeg",
    kind: "audio",
    source: "generated",
    dir: outputDir("audio"),
    slug,
    prompt: job.spec.prompt,
    jobId: job.id,
    signal,
  });
  transition(job.id, "succeeded", { finishedAt: now(), statusNote: "Audio saved", assets: [assetOut] });
}

/* ----------------------------- demo ----------------------------- */

async function runDemo(job: Job, model: ModelDef, signal: AbortSignal) {
  const slug = slugify(job.spec.prompt);
  const started = Date.now();

  if (model.mode === "image") {
    const n = Math.max(1, job.spec.n);
    await sleep(1200 + Math.random() * 900, signal);
    const assets = [];
    for (let i = 0; i < n; i++) {
      throwIfAborted(signal);
      const buf = await mockImage(job.spec.prompt || "Untitled", job.spec.size || "1024*1024", model.label, i + 1);
      throwIfAborted(signal);
      const { assetOut } = await persistMedia({
        buffer: buf,
        name: `${slug}-${i + 1}.svg`,
        mime: "image/svg+xml",
        kind: "image",
        source: "generated",
        dir: outputDir("image"),
        slug: n > 1 ? `${slug}-${i + 1}` : slug,
        prompt: job.spec.prompt,
        jobId: job.id,
        signal,
      });
      assets.push(assetOut);
      patch(job.id, { statusNote: `Rendering ${i + 1}/${n}…` });
    }
    transition(job.id, "succeeded", {
      finishedAt: now(),
      statusNote: "Demo image saved — add a key to use the real model",
      assets,
      demo: true,
    });
    return;
  }

  if (model.mode === "video") {
    const ratio = job.spec.ratio === "adaptive" ? "16:9" : job.spec.ratio;
    const base = job.spec.resolution === "1080P" ? 1080 : job.spec.resolution === "480P" ? 480 : 720;
    const [rw, rh] = ratio.split(":").map(Number);
    const width = Math.round((base * (rw / rh)) / 2) * 2;
    const height = base;
    const dest = reserveUniquePath(outputDir("video"), `${slug}-demo`, "mp4");
    patch(job.id, { statusNote: "Rendering demo clip…" });
    let persistedId: string | undefined;
    let assetOut: JobAsset;
    try {
      await mockVideo(job.spec.prompt, width, height, job.spec.duration, dest, signal);
      throwIfAborted(signal);
      const saved = await persistMedia({
        filePath: dest,
        name: path.basename(dest),
        mime: "video/mp4",
        kind: "video",
        source: "generated",
        dir: outputDir("video"),
        slug,
        prompt: job.spec.prompt,
        jobId: job.id,
        signal,
      });
      persistedId = saved.asset.id;
      assetOut = saved.assetOut;
      throwIfAborted(signal);
    } catch (err) {
      if (persistedId) discardMediaAsset(persistedId);
      else await fsp.rm(dest, { force: true });
      throw err;
    }
    transition(job.id, "succeeded", {
      finishedAt: now(),
      statusNote: "Demo clip saved — add a key to use the real model",
      assets: [assetOut],
      demo: true,
    });
    return;
  }

  const format = job.spec.format ?? "mp3";
  const dest = reserveUniquePath(outputDir("audio"), `${slug}-demo`, format);
  patch(job.id, { statusNote: "Synthesising demo audio…" });
  let persistedId: string | undefined;
  let assetOut: JobAsset;
  try {
    await sleep(600, signal);
    await mockAudio(job.spec.prompt, dest, format, signal);
    throwIfAborted(signal);
    const saved = await persistMedia({
      filePath: dest,
      name: path.basename(dest),
      mime: format === "wav" ? "audio/wav" : "audio/mpeg",
      kind: "audio",
      source: "generated",
      dir: outputDir("audio"),
      slug,
      prompt: job.spec.prompt,
      jobId: job.id,
      signal,
    });
    persistedId = saved.asset.id;
    assetOut = saved.assetOut;
    throwIfAborted(signal);
  } catch (err) {
    if (persistedId) discardMediaAsset(persistedId);
    else await fsp.rm(dest, { force: true });
    throw err;
  }
  const secs = Math.round((Date.now() - started) / 1000);
  transition(job.id, "succeeded", {
    finishedAt: now(),
    statusNote: `Demo audio saved in ${secs}s — add a key to use the real model`,
    assets: [assetOut],
    demo: true,
  });
}
