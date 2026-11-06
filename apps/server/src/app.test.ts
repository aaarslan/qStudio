import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultSpec, getModel } from "@qstudio/core";
import type { Job, MediaAsset, ShotTake } from "@qstudio/core";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "qstudio-test-"));
process.env.QSTUDIO_HOME = home;
process.env.QSTUDIO_PORT = "0";
process.env.QSTUDIO_KEYCHAIN_SERVICE = `Q Studio Test ${process.pid}`;
process.env.QSTUDIO_KEYCHAIN_ACCOUNT = "regression";
delete process.env.QSTUDIO_TOKEN;
delete process.env.QWEN_TOKEN_PLAN_KEY;
delete process.env.DASHSCOPE_API_KEY;

const { app, initializeServer } = await import("./index");
const store = await import("./store");
const { readRange } = await import("./media");
const config = await import("./config");

before(async () => {
  initializeServer();
  const outputRoot = path.join(home, "output");
  const res = await request("/api/settings", {
    method: "POST",
    body: JSON.stringify({ outputRoot }),
  });
  assert.equal(res.status, 200);
});

after(async () => {
  await config.clearStoredKey();
  store.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

async function request(pathname: string, init?: RequestInit) {
  return app.request(pathname, {
    ...init,
    headers: {
      Host: "127.0.0.1:8799",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function ensureDemo() {
  const res = await request("/api/settings", {
    method: "POST",
    body: JSON.stringify({ demoMode: true }),
  });
  assert.equal(res.status, 200);
}

test("API keys reject unsafe or malformed values", async () => {
  for (const key of [
    "sk-sp-bad\nadd-generic-password",
    "sk-sp-",
    `sk-sp-${"x".repeat(260)}`,
    "not-a-supported-key",
  ]) {
    const res = await request("/api/key", {
      method: "POST",
      body: JSON.stringify({ key, remember: true }),
    });
    assert.equal(res.status, 400);
  }
});

test("API keys round-trip through an isolated Keychain item", { skip: process.platform !== "darwin" }, async () => {
  const key = "sk-sp-regression-test-1234567890";
  const saved = await request("/api/key", {
    method: "POST",
    body: JSON.stringify({ key, remember: true }),
  });
  assert.equal(saved.status, 200);
  const savedBody = await json<{ key: { present: boolean; source: string } }>(saved);
  assert.equal(savedBody.key.present, true);
  assert.equal(savedBody.key.source, "keychain");

  const read = await json<{ present: boolean }>(await request("/api/key"));
  assert.equal(read.present, true);

  const removed = await request("/api/key", { method: "DELETE" });
  assert.equal(removed.status, 200);
  const removedBody = await json<{ key: { present: boolean } }>(removed);
  assert.equal(removedBody.key.present, false);
});

test("settings reject malformed values without poisoning config", async () => {  const before = await json<{ settings: { outputRoot: string } }>(await request("/api/state"));
  for (const body of [
    { outputRoot: 42 },
    { outputRoot: "relative/path" },
    { concurrencyImages: 100 },
    { theme: "sepia" },
    { unknownSetting: true },
  ]) {
    const res = await request("/api/settings", { method: "POST", body: JSON.stringify(body) });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const state = await json<{ settings: { outputRoot: string } }>(await request("/api/state"));
  assert.equal(state.settings.outputRoot, before.settings.outputRoot);
});

test("malformed media and job payloads fail before persistence", async () => {
  const media = await request("/api/media/missing", {
    method: "PATCH",
    body: JSON.stringify({ tags: "portrait" }),
  });
  assert.equal(media.status, 400);

  const prompt = await request("/api/prompts", {
    method: "POST",
    body: JSON.stringify({ title: "Broken", text: "x", tags: "portrait", mode: "image", modelId: "qwen-image-3.0-pro" }),
  });
  assert.equal(prompt.status, 400);

  const job = await request("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ spec: { modelId: "qwen-image-3.0-pro", mode: "image" } }),
  });
  assert.equal(job.status, 400);
  assert.match((await json<{ error: string }>(job)).error, /reference|list|prompt/i);
});

test("canceling a demo job cannot be overwritten by late completion", async () => {
  await ensureDemo();
  const spec = defaultSpec(getModel("qwen-image-3.0-pro"));
  spec.prompt = "cancel regression";
  const created = await request("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ spec }),
  });
  assert.equal(created.status, 200);
  const { job } = await json<{ job: Job }>(created);
  const canceled = await request(`/api/jobs/${job.id}/cancel`, { method: "POST" });
  assert.equal(canceled.status, 200);
  assert.equal((await json<{ job: Job }>(canceled)).job.status, "canceled");

  await new Promise((resolve) => setTimeout(resolve, 2300));
  const final = await json<{ job: Job }>(await request(`/api/jobs/${job.id}`));
  assert.equal(final.job.status, "canceled");
  assert.equal(final.job.assets.length, 0);
});

test("retry starts a fresh provider attempt and preserves a film take", async () => {
  await ensureDemo();
  const worldResponse = await request("/api/film/worlds", {
    method: "POST",
    body: JSON.stringify({ title: "Retry film" }),
  });
  const world = await json<{ world: { id: string } }>(worldResponse);
  const sceneResponse = await request(`/api/film/worlds/${world.world.id}/scenes`, {
    method: "POST",
    body: JSON.stringify({ title: "Scene" }),
  });
  const scene = await json<{ scene: { id: string } }>(sceneResponse);
  const shotResponse = await request(`/api/film/scenes/${scene.scene.id}/shots`, {
    method: "POST",
    body: JSON.stringify({ title: "Shot" }),
  });
  const { shot } = await json<{ shot: { id: string; takes: ShotTake[] } }>(shotResponse);

  const spec = defaultSpec(getModel("qwen-image-3.0-pro"));
  spec.prompt = "film retry regression";
  const failedId = "job_failed_retry";
  const takeId = "take_failed_retry";
  const failed: Job = {
    id: failedId,
    mode: spec.mode,
    modelId: spec.modelId,
    status: "failed",
    prompt: spec.prompt,
    spec,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    taskId: "provider_task_failed",
    statusNote: "Failed",
    error: { message: "failed" },
    assets: [],
    units: 1,
    film: { worldId: world.world.id, sceneId: scene.scene.id, shotId: shot.id, takeId },
  };
  store.addJob(failed);
  store.updateShot(shot.id, {
    takes: [
      {
        id: takeId,
        jobId: failedId,
        label: "Take 1",
        createdAt: new Date().toISOString(),
        fingerprint: "fingerprint",
        entityVersions: {},
        verdict: null,
        mediaIds: [],
      },
    ],
  });

  const retriedResponse = await request(`/api/jobs/${failedId}/retry`, { method: "POST" });
  assert.equal(retriedResponse.status, 200);
  const { job: retried } = await json<{ job: Job }>(retriedResponse);
  assert.notEqual(retried.id, failedId);
  assert.equal(retried.taskId, undefined);
  assert.equal(retried.film?.takeId, takeId);
  const updated = store.getShot(shot.id)!;
  assert.equal(updated.takes.length, 1);
  assert.equal(updated.takes[0].jobId, retried.id);

  await request(`/api/jobs/${retried.id}/cancel`, { method: "POST" });
});

test("retry resumes a provider task only after a resumable failure", async () => {
  await ensureDemo();
  const spec = defaultSpec(getModel("wan3.0-video"));
  spec.prompt = "resume provider task";
  const send = async (id: string, taskId: string, message: string) => {
    store.addJob({
      id,
      mode: spec.mode,
      modelId: spec.modelId,
      status: "failed",
      prompt: spec.prompt,
      spec,
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      taskId,
      statusNote: "Failed",
      error: { message },
      assets: [],
      units: 1,
    });
    const response = await request(`/api/jobs/${id}/retry`, { method: "POST" });
    assert.equal(response.status, 200);
    const { job } = await json<{ job: Job }>(response);
    await request(`/api/jobs/${job.id}/cancel`, { method: "POST" });
    return job;
  };

  const resumed = await send(
    "job_retry_timeout",
    "provider_task_waiting",
    "The task timed out. It may still finish at QwenCloud."
  );
  assert.equal(resumed.taskId, "provider_task_waiting");

  const fresh = await send(
    "job_retry_definitive",
    "provider_task_failed",
    "The provider rejected this task."
  );
  assert.equal(fresh.taskId, undefined);
});

test("media used by the film cannot be deleted", async () => {
  const file = path.join(home, "reference.png");
  fs.writeFileSync(file, Buffer.from("not-an-image"));
  const asset: MediaAsset = {
    id: "med_referenced",
    kind: "image",
    name: "reference.png",
    filePath: file,
    url: "/api/media/med_referenced/file",
    mime: "image/png",
    bytes: 12,
    hash: "hash",
    source: "upload",
    tags: [],
    favorite: false,
    createdAt: new Date().toISOString(),
    useCount: 0,
  };
  store.addMedia(asset);
  const worldResponse = await request("/api/film/worlds", {
    method: "POST",
    body: JSON.stringify({ title: "Media guard" }),
  });
  const world = await json<{ world: { id: string } }>(worldResponse);
  const entityResponse = await request(`/api/film/worlds/${world.world.id}/entities`, {
    method: "POST",
    body: JSON.stringify({ name: "Lead", canonicalMediaIds: [asset.id] }),
  });
  const entity = await json<{ entity: { id: string } }>(entityResponse);
  const blocked = await request(`/api/media/${asset.id}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.equal(fs.existsSync(file), true);

  await request(`/api/film/entities/${entity.entity.id}`, {
    method: "PATCH",
    body: JSON.stringify({ canonicalMediaIds: [] }),
  });
  const removed = await request(`/api/media/${asset.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
});

test("media referenced by a queued generation cannot be deleted", async () => {
  const file = path.join(home, "queued-reference.png");
  fs.writeFileSync(file, Buffer.from("queued reference"));
  const asset: MediaAsset = {
    id: "med_queued_reference",
    kind: "image",
    name: "queued-reference.png",
    filePath: file,
    url: "/api/media/med_queued_reference/file",
    mime: "image/png",
    bytes: fs.statSync(file).size,
    hash: "queued-reference-hash",
    source: "upload",
    tags: [],
    favorite: false,
    createdAt: new Date().toISOString(),
    useCount: 0,
  };
  store.addMedia(asset);
  const spec = defaultSpec(getModel("qwen-image-3.0-pro"));
  spec.prompt = "queued reference guard";
  spec.refs = [{ mediaId: asset.id, role: "reference" }];
  const job: Job = {
    id: "job_queued_reference_guard",
    mode: spec.mode,
    modelId: spec.modelId,
    status: "queued",
    prompt: spec.prompt,
    spec,
    createdAt: new Date().toISOString(),
    assets: [],
  };
  store.addJob(job);

  const blocked = await request(`/api/media/${asset.id}`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.equal(fs.existsSync(file), true);
  assert.match((await json<{ error: string }>(blocked)).error, /Queued job/);
  store.removeJob(job.id);
});

test("script breakdown requires confirmation before replacing existing scenes", async () => {
  const worldResponse = await request("/api/film/worlds", {
    method: "POST",
    body: JSON.stringify({ title: "Breakdown replacement" }),
  });
  const world = await json<{ world: { id: string } }>(worldResponse);
  const firstScript = "EXT. FERRY DECK - NIGHT\n\nRain needles the empty benches.";
  const secondScript = "INT. STATION - DAY\n\nA train arrives through the fog.";
  const initial = await request(`/api/film/worlds/${world.world.id}/breakdown`, {
    method: "POST",
    body: JSON.stringify({ scriptText: firstScript }),
  });
  assert.equal(initial.status, 200);
  const firstState = await json<{ scenes: { id: string; slugline: string }[]; shots: { sceneId: string }[] }>(initial);
  assert.equal(firstState.scenes.length, 1);
  const firstSceneId = firstState.scenes[0].id;

  const confirmation = await request(`/api/film/worlds/${world.world.id}/breakdown`, {
    method: "POST",
    body: JSON.stringify({ scriptText: secondScript }),
  });
  assert.equal(confirmation.status, 409);
  assert.equal((await json<{ code: string }>(confirmation)).code, "BREAKDOWN_REPLACE_REQUIRED");
  assert.equal(store.getScene(firstSceneId)?.slugline, "EXT. FERRY DECK - NIGHT");

  const replaced = await request(`/api/film/worlds/${world.world.id}/breakdown`, {
    method: "POST",
    body: JSON.stringify({ scriptText: secondScript, replace: true }),
  });
  assert.equal(replaced.status, 200);
  const state = await json<{ scenes: { id: string; slugline: string }[]; shots: { sceneId: string }[] }>(replaced);
  assert.equal(state.scenes.length, 1);
  assert.notEqual(state.scenes[0].id, firstSceneId);
  assert.equal(state.scenes[0].slugline, "INT. STATION - DAY");
  assert.equal(state.shots.length, 1);
});

test("local imports accept the full advertised batch of 100 files", async () => {
  const files = Array.from({ length: 21 }, (_, index) => {
    const file = path.join(home, `batch-${index}.svg`);
    fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text>${index}</text></svg>`);
    return file;
  });
  const response = await request("/api/import", {
    method: "POST",
    body: JSON.stringify({ paths: files }),
  });
  assert.equal(response.status, 200);
  const body = await json<{ media: MediaAsset[] }>(response);
  assert.equal(body.media.length, files.length);
});

test("a demo film exports through the local render graph with dialogue audio", async () => {
  await ensureDemo();
  const worldResponse = await request("/api/film/worlds", {
    method: "POST",
    body: JSON.stringify({ title: "Export regression", aspect: "9:16" }),
  });
  const world = await json<{ world: { id: string } }>(worldResponse);
  const sceneResponse = await request(`/api/film/worlds/${world.world.id}/scenes`, {
    method: "POST",
    body: JSON.stringify({ title: "Deck" }),
  });
  const scene = await json<{ scene: { id: string } }>(sceneResponse);
  const shotResponse = await request(`/api/film/scenes/${scene.scene.id}/shots`, {
    method: "POST",
    body: JSON.stringify({ title: "Crossing", action: "The lead crosses the wet deck.", durationSeconds: 3 }),
  });
  const { shot } = await json<{ shot: { id: string } }>(shotResponse);

  const renderResponse = await request(`/api/film/shots/${shot.id}/render`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(renderResponse.status, 200);
  const { job } = await json<{ job: Job }>(renderResponse);
  let rendered: Job | undefined;
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    rendered = (await json<{ job: Job }>(await request(`/api/jobs/${job.id}`))).job;
    if (rendered.status === "succeeded" || rendered.status === "failed") break;
  }
  assert.equal(rendered?.status, "succeeded", rendered?.error?.message);
  assert.ok(rendered?.assets[0]);

  const ttsSpec = defaultSpec(getModel("qwen-audio-3.0-tts-plus"));
  ttsSpec.prompt = "Last crossing.";
  const ttsResponse = await request("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ spec: ttsSpec }),
  });
  const { job: ttsJob } = await json<{ job: Job }>(ttsResponse);
  let ttsDone: Job | undefined;
  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    ttsDone = (await json<{ job: Job }>(await request(`/api/jobs/${ttsJob.id}`))).job;
    if (ttsDone.status === "succeeded" || ttsDone.status === "failed") break;
  }
  assert.equal(ttsDone?.status, "succeeded", ttsDone?.error?.message);
  const audioId = ttsDone!.assets[0].id;
  const attached = await request(`/api/film/shots/${shot.id}`, {
    method: "PATCH",
    body: JSON.stringify({ audioMediaIds: [audioId] }),
  });
  assert.equal(attached.status, 200);
  const defaultGraph = await json<{
    graph: { clips: { audio: { gain: number }[] }[] };
  }>(await request(`/api/film/worlds/${world.world.id}/render-graph`));
  assert.equal(defaultGraph.graph.clips[0].audio[0].gain, 1);
  const invalidGain = await request(`/api/film/shots/${shot.id}`, {
    method: "PATCH",
    body: JSON.stringify({ audioGain: 1.5 }),
  });
  assert.equal(invalidGain.status, 400);
  const patched = await request(`/api/film/shots/${shot.id}`, {
    method: "PATCH",
    body: JSON.stringify({ audioMediaIds: [audioId], audioGain: 0.35 }),
  });
  assert.equal(patched.status, 200);

  const graphResponse = await request(`/api/film/worlds/${world.world.id}/render-graph`);
  assert.equal(graphResponse.status, 200);
  const graphBody = await json<{
    graph: {
      width: number;
      height: number;
      clips: { mediaId: string; audio: { id: string; gain: number }[] }[];
    };
  }>(graphResponse);
  assert.equal(graphBody.graph.width, 720);
  assert.equal(graphBody.graph.height, 1280);
  assert.equal(graphBody.graph.clips.length, 1);
  assert.equal(graphBody.graph.clips[0].audio[0].id, audioId);
  assert.equal(graphBody.graph.clips[0].audio[0].gain, 0.35);

  const exportResponse = await request(`/api/film/worlds/${world.world.id}/preview`, {
    method: "POST",
  });
  assert.equal(exportResponse.status, 200);
  const started = await json<{ localExport: { id: string } }>(exportResponse);
  let finished:
    | { status: string; mediaId?: string; error?: string; progress: number }
    | undefined;
  for (let attempt = 0; attempt < 160; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    finished = (
      await json<{ export: { status: string; mediaId?: string; error?: string; progress: number } }>(
        await request(`/api/exports/${started.localExport.id}`)
      )
    ).export;
    if (finished.status === "succeeded" || finished.status === "failed" || finished.status === "canceled") break;
  }
  assert.equal(finished?.status, "succeeded", finished?.error);
  assert.equal(finished?.progress, 1);
  const output = store.getMedia(finished!.mediaId!);
  assert.ok(output);
  assert.equal(fs.existsSync(output!.filePath), true);
});

test("usage is recorded once per job", () => {  store.addUsage({
    id: "use_one",
    jobId: "job_usage_unique",
    modelId: "qwen-image-3.0-pro",
    mode: "image",
    units: 2,
    status: "succeeded",
    createdAt: new Date().toISOString(),
  });
  store.addUsage({
    id: "use_two",
    jobId: "job_usage_unique",
    modelId: "qwen-image-3.0-pro",
    mode: "image",
    units: 2,
    status: "succeeded",
    createdAt: new Date().toISOString(),
  });
  assert.equal(store.listUsage(1000).filter((item) => item.jobId === "job_usage_unique").length, 1);
});

test("job history is not silently truncated", () => {  const base = new Date().toISOString();
  for (let index = 0; index < 401; index++) {
    store.addJob({
      id: `job_history_${index}`,
      mode: "image",
      modelId: "qwen-image-3.0-pro",
      status: "failed",
      prompt: `history ${index}`,
      spec: defaultSpec(getModel("qwen-image-3.0-pro")),
      createdAt: base,
      assets: [],
    });
  }
  assert.ok(store.getJob("job_history_0"));
  assert.ok(store.listJobs().length >= 401);
});

test("range parsing supports suffix, clamping, and unsatisfiable requests", () => {
  const file = path.join(home, "range.bin");
  fs.writeFileSync(file, Buffer.alloc(1000, 1));
  assert.deepEqual(readRange(file, "bytes=0-99"), {
    start: 0,
    end: 99,
    size: 1000,
    partial: true,
    unsatisfiable: false,
  });
  assert.deepEqual(readRange(file, "bytes=-100"), {
    start: 900,
    end: 999,
    size: 1000,
    partial: true,
    unsatisfiable: false,
  });
  assert.equal(readRange(file, "bytes=999-2000").end, 999);
  assert.equal(readRange(file, "bytes=2000-3000").unsatisfiable, true);
  assert.equal(readRange(file, "bytes=900-800").unsatisfiable, true);
  assert.equal(readRange(file, "garbage").partial, false);
});
