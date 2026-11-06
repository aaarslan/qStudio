import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "qstudio-migrate-"));
process.env.QSTUDIO_HOME = home;
const dbPath = path.join(home, "data", "qstudio.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const seed = new DatabaseSync(dbPath);
seed.exec(`
  CREATE TABLE usage (id TEXT PRIMARY KEY, job_id TEXT, model TEXT, mode TEXT, units REAL, status TEXT, created TEXT, json TEXT NOT NULL);
  CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT, task_id TEXT, created TEXT, json TEXT NOT NULL);
`);
const now = new Date().toISOString();
seed.prepare("INSERT INTO usage (id, job_id, model, mode, units, status, created, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
  "use_old",
  "job_duplicate",
  "qwen-image-3.0-pro",
  "image",
  2,
  "succeeded",
  now,
  JSON.stringify({
    id: "use_old",
    jobId: "job_duplicate",
    modelId: "qwen-image-3.0-pro",
    mode: "image",
    units: 2,
    status: "succeeded",
    createdAt: now,
  })
);
seed.prepare("INSERT INTO usage (id, job_id, model, mode, units, status, created, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
  "use_new",
  "job_duplicate",
  "qwen-image-3.0-pro",
  "image",
  2,
  "succeeded",
  now,
  JSON.stringify({
    id: "use_new",
    jobId: "job_duplicate",
    modelId: "qwen-image-3.0-pro",
    mode: "image",
    units: 2,
    status: "succeeded",
    createdAt: now,
  })
);
seed.prepare("INSERT INTO jobs (id, status, task_id, created, json) VALUES (?, ?, ?, ?, ?)").run(
  "job_corrupt",
  "failed",
  null,
  now,
  "{not-json"
);
seed.close();

const store = await import("./store");

after(() => {
  store.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

test("schema migration deduplicates usage and records the version", () => {
  store.loadDb();
  const duplicate = store.listUsage(100).filter((item) => item.jobId === "job_duplicate");
  assert.equal(duplicate.length, 1);
  assert.equal(store.getJob("job_corrupt"), undefined);
  assert.ok(store.integrityReport().warnings.some((warning) => /unreadable job/i.test(warning)));
  store.closeDb();
  const check = new DatabaseSync(dbPath);
  const row = check.prepare("PRAGMA user_version").get() as { user_version: number };
  check.close();
  assert.equal(Number(row.user_version), 1);
});
