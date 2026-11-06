import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "qstudio-media-preview-"));
process.env.QSTUDIO_HOME = home;
process.env.QSTUDIO_TOKEN = "test-token-1234567890";
delete process.env.QWEN_TOKEN_PLAN_KEY;
delete process.env.DASHSCOPE_API_KEY;

const { app, initializeServer } = await import("./index");
const store = await import("./store");
const media = await import("./media");

before(() => initializeServer());
after(() => {
  store.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

async function request(pathname: string, init: RequestInit = {}) {
  return app.request(pathname, {
    ...init,
    headers: { Host: "127.0.0.1:5182", ...(init.headers ?? {}) },
  });
}

const query = "?token=test-token-1234567890";

test("media preview asset GETs accept the query token used by <img>/<video> src", async () => {
  for (const pathname of [
    `/api/media/missing/file${query}`,
    `/api/media/missing/download${query}`,
    `/api/media/missing/thumb${query}`,
    `/api/media/missing/frame${query}`,
  ]) {
    const res = await request(pathname);
    assert.notEqual(res.status, 401, `${pathname} should not be 401`);
    assert.equal(res.status, 404);
  }
});

test("media asset GETs accept the Bearer [REDACTED] and reject a wrong query token", async () => {
  const authed = await request("/api/media/missing/file", {
    headers: { Authorization: "Bearer test-token-1234567890" },
  });
  assert.equal(authed.status, 404);
  assert.equal((await request("/api/media/missing/file?token=wrong-token")).status, 401);
});

test("non-asset routes still reject query tokens", async () => {
  assert.equal((await request(`/api/state${query}`)).status, 401);
});

test("unique output reservations do not collide for concurrent names", () => {
  const dir = path.join(home, "reservations");
  fs.mkdirSync(dir);
  const first = media.reserveUniquePath(dir, "same-name", "mp4");
  const second = media.reserveUniquePath(dir, "same-name", "mp4");
  assert.notEqual(first, second);
  assert.equal(fs.existsSync(first), true);
  assert.equal(fs.existsSync(second), true);
});

test("generic download MIME uses the requested media kind", async () => {
  const dir = path.join(home, "downloads");
  fs.mkdirSync(dir);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("video bytes", {
    headers: { "content-type": "application/octet-stream" },
  });
  try {
    const result = await media.downloadToFile("https://assets.test/clip", dir, "clip", "video");
    assert.equal(result.kind, "video");
    assert.equal(result.mime, "video/mp4");
    assert.equal(result.ext, "mp4");
    assert.equal(path.extname(result.filePath), ".mp4");
    assert.equal(fs.readFileSync(result.filePath, "utf8"), "video bytes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("canceling media persistence removes its reserved output", async () => {
  const dir = path.join(home, "canceled");
  fs.mkdirSync(dir);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    media.persistMedia({
      buffer: Buffer.from("cancel me"),
      name: "cancel.svg",
      mime: "image/svg+xml",
      kind: "image",
      source: "generated",
      dir,
      slug: "cancel",
      signal: controller.signal,
    }),
    (err: Error) => err.name === "AbortError"
  );
  assert.deepEqual(fs.readdirSync(dir), []);
});
