import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Job, PromptRecord } from "@qstudio/core";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "qstudio-resume-"));
process.env.QSTUDIO_HOME = home;
const dbPath = path.join(home, "data", "qstudio.db");

const store = await import("./store");

after(() => {
  store.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("a running job survives a restart without flush and reloads resumable", async () => {
  store.loadDb();

  const prompt: PromptRecord = {
    id: "prm_resume_probe",
    title: "restart resume probe",
    text: "restart resume probezz quixotic badger",
    mode: "image",
    modelId: "qwen-image-3.0-pro",
    params: {},
    tags: [],
    favorite: false,
    useCount: 0,
    createdAt: new Date().toISOString(),
  };
  store.addPrompt(prompt);
  await sleep(350);

  const job: Job = {
    id: "job_resume_probe",
    mode: "image",
    modelId: "qwen-image-3.0-pro",
    status: "queued",
    prompt: "resume probe",
    spec: {
      mode: "image",
      modelId: "qwen-image-3.0-pro",
      prompt: "resume probe",
      n: 1,
      aspect: "1:1",
      size: "1024*1024",
      tier: "1K",
      resolution: "1024*1024",
      ratio: "1:1",
      duration: 0,
      watermark: false,
      promptExtend: false,
      refs: [],
    },
    createdAt: new Date().toISOString(),
    assets: [],
  };
  store.addJob(job);
  assert.equal(store.updateJob(job.id, { status: "running", statusNote: "Rendering demo..." })?.status, "running");

  const probe = new DatabaseSync(dbPath);
  try {
    const row = probe.prepare("SELECT json FROM jobs WHERE id = ?").get(job.id) as { json: string } | undefined;
    assert.ok(row, "job row reaches SQLite synchronously, before any flush");
    assert.equal((JSON.parse(row.json) as Job).status, "running");
  } finally {
    probe.close();
  }

  store.loadDb();

  const reloaded = store.getJob(job.id);
  assert.ok(reloaded, "job survives the restart");
  assert.equal(reloaded.status, "queued");
  assert.match(reloaded.statusNote ?? "", /restart|resume|interrupt/i);
  assert.equal(store.jobCanAdvance(job.id), true);

  const found = store.searchAll("quixotic badger");
  assert.ok(found.prompts.some((p) => p.id === prompt.id), "prompt written in the same window stays searchable");
});
