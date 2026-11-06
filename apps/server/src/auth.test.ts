import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "qstudio-auth-"));
process.env.QSTUDIO_HOME = home;
process.env.QSTUDIO_TOKEN = "test-token-1234567890";
delete process.env.QWEN_TOKEN_PLAN_KEY;
delete process.env.DASHSCOPE_API_KEY;

const { app, initializeServer } = await import("./index");
const store = await import("./store");

before(() => initializeServer());
after(() => {
  store.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

async function request(pathname: string, init: RequestInit = {}, host = "127.0.0.1:5180") {
  return app.request(pathname, {
    ...init,
    headers: { Host: host, ...(init.headers ?? {}) },
  });
}

test("engine API requires the bearer token except for health", async () => {
  assert.equal((await request("/api/state")).status, 401);
  assert.equal((await request("/api/state", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.equal(
    (await request("/api/state", { headers: { Authorization: "Bearer test-token-1234567890" } })).status,
    200
  );
  assert.equal((await request("/api/health")).status, 200);
});

test("query tokens are not accepted by normal API routes", async () => {
  assert.equal((await request("/api/state?token=test-token-1234567890")).status, 401);
});

test("origins must match the serving host and remote hosts are rejected", async () => {
  const token = { Authorization: "Bearer test-token-1234567890" };
  assert.equal(
    (
      await request("/api/state", {
        headers: { ...token, Origin: "http://127.0.0.1:5180" },
      })
    ).status,
    200
  );
  assert.equal(
    (
      await request("/api/state", {
        headers: { ...token, Origin: "http://localhost:3000" },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await request(
        "/api/state",
        { headers: { ...token, Origin: "tauri://localhost" } },
        "127.0.0.1:63000"
      )
    ).status,
    200
  );
  assert.equal((await request("/api/health", {}, "example.com")).status, 403);
});
