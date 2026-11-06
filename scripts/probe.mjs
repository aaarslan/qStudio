#!/usr/bin/env node
/**
 * Q Studio — M0 capability probe.
 *
 * Verifies that a Token Plan key can reach each endpoint family, and captures
 * the real response shapes so the request builders can be trusted.
 *
 *   node scripts/probe.mjs                 # dry run, prints the plan only
 *   node scripts/probe.mjs --live          # images + edit + TTS + upload policy
 *   node scripts/probe.mjs --live --video  # also submits a short video task
 *
 * The key is read from QWEN_TOKEN_PLAN_KEY (or DASHSCOPE_API_KEY / --key=…).
 * Each live call consumes Token Plan credits. Start with --live, not --video.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const LIVE = has("--live");
const VIDEO = has("--video");
const BASE = (argValue("base") ?? process.env.QWEN_BASE_URL ?? "https://token-plan.maas.qwencloudapi.com").replace(/\/$/, "");
const KEY = argValue("key") ?? process.env.QWEN_TOKEN_PLAN_KEY ?? process.env.DASHSCOPE_API_KEY;

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

if (!KEY) {
  console.error(
    C.red("No key.") +
      "\nSet QWEN_TOKEN_PLAN_KEY, or pass --key=sk-sp-…\n" +
      "Do not paste the key into chat or commit it."
  );
  process.exit(1);
}
if (!KEY.startsWith("sk-sp-")) {
  console.warn(C.amber("Warning:") + " this does not look like a Token Plan key (sk-sp-…).");
}

const base64Reference = (() => {
  const file = path.join(ROOT, "scripts", "fixtures", "reference.png");
  const buf = fs.readFileSync(file);
  return `data:image/png;base64,${buf.toString("base64")}`;
})();

const results = [];

function record(step, ok, detail) {
  results.push({ step, ok, ...detail });
}

function printBody(json) {
  if (!json) return "";
  const s = JSON.stringify(json);
  return s.length > 900 ? s.slice(0, 900) + "…" : s;
}

function redact(body) {
  const clone = JSON.parse(JSON.stringify(body));
  const walk = (v) => {
    if (typeof v === "string" && v.startsWith("data:")) {
      const mime = v.slice(5, v.indexOf(";"));
      return `data:${mime};base64,<redacted>`;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(clone);
}

async function call(step, urlPath, body, opts = {}) {
  const url = `${BASE}${urlPath}`;
  const method = opts.method ?? "POST";
  if (!LIVE) {
    console.log(`\n${C.bold(step)}  ${C.dim(method + " " + url)}`);
    console.log(C.dim("  " + JSON.stringify(redact(body)).slice(0, 500)));
    record(step, null, { url, dry: true });
    return { skipped: true };
  }

  console.log(`\n${C.bold(step)}  ${C.dim(method + " " + url)}`);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
        ...(opts.headers ?? {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(opts.timeout ?? 180_000),
    });
  } catch (err) {
    console.log(`  ${C.red("network error")} ${err.message}`);
    record(step, false, { url, error: err.message });
    return { error: err };
  }
  const ms = Date.now() - started;
  const ctype = res.headers.get("content-type") ?? "";

  if (step === "tts" && !ctype.includes("json")) {
    const buf = Buffer.from(await res.arrayBuffer());
    const ok = res.ok && buf.length > 0;
    console.log(
      `  ${ok ? C.green("OK") : C.red("FAIL")}  ${res.status}  ${C.dim(`${ms}ms`)}  raw ${ctype || "unknown"} · ${buf.length} bytes`
    );
    record(step, ok, { url, status: res.status, ms, contentType: ctype, bytes: buf.length, shape: "binary" });
    return { res, buf };
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  const ok = res.ok;
  console.log(`  ${ok ? C.green("OK") : C.red("FAIL")}  ${res.status}  ${C.dim(`${ms}ms`)}  ${ctype}`);
  if (!ok) console.log("  " + C.red(text.slice(0, 600)));
  else console.log("  " + C.dim(printBody(json)));

  record(step, ok, {
    url,
    status: res.status,
    ms,
    requestId: json?.request_id,
    taskId: json?.output?.task_id,
    imageUrl: json?.output?.choices?.[0]?.message?.content?.find?.((x) => x?.image)?.image,
    videoUrl: json?.output?.video_url,
    audioUrl: json?.output?.audio?.url,
    usage: json?.usage,
    errorCode: json?.code ?? json?.output?.code,
  });
  return { res, json, text };
}

function baseImageBody(extraParameters = {}) {
  return {
    model: "qwen-image-3.0-pro",
    input: {
      messages: [{ role: "user", content: [{ text: "A single ripe pear on a pale linen table, soft north light, quiet still life, 50mm" }] }],
    },
    parameters: { size: "1024*1024", n: 1, watermark: false, prompt_extend: true, ...extraParameters },
  };
}

async function pollImageTask(step, taskId) {
  const started = Date.now();
  let interval = 3000;
  for (;;) {
    if (Date.now() - started > 5 * 60_000) {
      console.log("  " + C.amber("image task timed out after 5 minutes"));
      record(`${step}-poll`, false, { taskId, timeout: true });
      return;
    }
    await new Promise((r) => setTimeout(r, interval));
    const r = await fetch(`${BASE}/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${KEY}` } });
    const j = await r.json().catch(() => ({}));
    const st = j?.output?.task_status;
    console.log(`  ${C.dim(new Date().toISOString().slice(11, 19))}  ${st ?? r.status}`);
    if (st === "SUCCEEDED") {
      const urls = [];
      const content = j?.output?.choices?.[0]?.message?.content ?? [];
      for (const c of content) if (c?.image) urls.push(c.image);
      for (const c of j?.output?.results ?? []) if (c?.url) urls.push(c.url);
      console.log("  " + C.green(`${urls.length} image(s) ready`));
      record(`${step}-poll`, true, { taskId, status: st, images: urls.length, secs: Math.round((Date.now() - started) / 1000) });
      return;
    }
    if (st === "FAILED") {
      console.log("  " + C.red(JSON.stringify(j?.output ?? j).slice(0, 500)));
      record(`${step}-poll`, false, { taskId, status: st, error: j?.output?.message });
      return;
    }
    interval = Math.min(Math.round(interval * 1.5), 20_000);
  }
}

console.log(C.cyan("\nQ Studio · Token Plan probe"));
console.log(C.dim(`  host    ${BASE}`));
console.log(C.dim(`  key     ${KEY.slice(0, 7)}••••${KEY.slice(-4)} (${KEY.length} chars)`));
console.log(C.dim(`  mode    ${LIVE ? (VIDEO ? "LIVE incl. video" : "LIVE (images, TTS, upload)") : "dry run"}`));
console.log(C.dim(`  fixture scripts/fixtures/reference.png (${Math.round(base64Reference.length / 1024)} KB base64)`));

/* 1 — Qwen image, synchronous, multimodal endpoint */
await call("image-qwen-t2i", "/api/v1/services/aigc/multimodal-generation/generation", baseImageBody());

/* 2 — Wan image, image-generation endpoint routing.
   The Token Plan gateway requires async for this family, so the probe submits a task. */
const wan = await call(
  "image-wan-t2i",
  "/api/v1/services/aigc/image-generation/generation",
  {
    model: "wan2.7-image",
    input: { messages: [{ role: "user", content: [{ text: "A ripe pear on a pale table, soft light, still life" }] }] },
    parameters: { size: "1024*1024", n: 1, watermark: false },
  },
  { headers: { "X-DashScope-Async": "enable" } }
);
if (wan?.json?.output?.task_id) await pollImageTask("image-wan-t2i", wan.json.output.task_id);

/* 3 — Image edit with an inline base64 reference (the key local-file question) */
await call("image-edit-base64", "/api/v1/services/aigc/multimodal-generation/generation", {
  model: "qwen-image-3.0-pro",
  input: {
    messages: [
      {
        role: "user",
        content: [{ image: base64Reference }, { text: "Replace the background with a warm beige studio wall, keep the subject unchanged" }],
      },
    ],
  },
  parameters: { size: "1024*1024", n: 1, watermark: false, prompt_extend: true },
});

/* 4 — TTS: confirms JSON-url vs raw-bytes response shape */
const tts = await call("tts", "/api/v1/services/audio/tts/SpeechSynthesizer", {
  model: "qwen-audio-3.0-tts-plus",
  input: { text: "Q Studio probe. One, two, three.", voice: "longanhuan_v3.6", format: "mp3", sample_rate: 24000 },
});

/* 5 — Temporary upload policy: decides whether local audio/video refs can work */
await call("upload-policy", "/api/v1/uploads?action=getPolicy&model=qwen-image-3.0-pro", null, { method: "GET" });

/* 6 — Video task lifecycle (opt-in) */
if (VIDEO) {
  const sub = await call("video-submit", "/api/v1/services/aigc/video-generation/video-synthesis", {
    model: "happyhorse-1.1-t2v",
    input: { prompt: "A paper boat drifting across a shallow puddle, morning light, macro, gentle motion" },
    parameters: { resolution: "480P", ratio: "16:9", duration: 3 },
  }, { headers: { "X-DashScope-Async": "enable" } });

  const taskId = sub?.json?.output?.task_id;
  if (taskId) {
    console.log(C.dim(`\n  polling ${taskId} …`));
    const started = Date.now();
    let interval = 5000;
    for (;;) {
      if (Date.now() - started > 5 * 60_000) {
        console.log("  " + C.amber("timed out after 5 minutes; the task may still finish."));
        record("video-poll", false, { taskId, timeout: true });
        break;
      }
      await new Promise((r) => setTimeout(r, interval));
      const r = await fetch(`${BASE}/api/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${KEY}` } });
      const j = await r.json().catch(() => ({}));
      const st = j?.output?.task_status;
      console.log(`  ${C.dim(new Date().toISOString().slice(11, 19))}  ${st ?? r.status}`);
      if (st === "SUCCEEDED") {
        console.log("  " + C.green("video ready: ") + (j?.output?.video_url ?? "(no url)"));
        record("video-poll", true, { taskId, status: st, videoUrl: j?.output?.video_url, secs: Math.round((Date.now() - started) / 1000) });
        break;
      }
      if (st === "FAILED") {
        console.log("  " + C.red(JSON.stringify(j?.output ?? j).slice(0, 500)));
        record("video-poll", false, { taskId, status: st, error: j?.output?.message });
        break;
      }
      interval = Math.min(Math.round(interval * 1.5), 20_000);
    }
  }
}

/* Summary */
const passed = results.filter((r) => r.ok === true).length;
const failed = results.filter((r) => r.ok === false).length;
const dry = results.filter((r) => r.ok === null).length;
console.log("\n" + C.bold("Summary"));
for (const r of results) {
  const mark = r.ok === true ? C.green("PASS") : r.ok === false ? C.red("FAIL") : C.dim("DRY ");
  console.log(`  ${mark}  ${r.step.padEnd(22)} ${r.status ?? ""} ${r.ms ? `${r.ms}ms` : ""} ${r.errorCode ?? r.error ?? ""}`);
}
console.log(
  `\n  ${passed} passed · ${failed} failed · ${dry} dry` +
    (LIVE ? C.dim("  (these calls consumed Token Plan credits)") : C.dim("  (nothing was sent)"))
);

if (LIVE) {
  const dir = path.join(ROOT, "probes", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(results, null, 2));
  console.log(C.dim(`\n  fixtures → ${path.relative(ROOT, dir)}/summary.json`));
}

if (failed > 0) process.exitCode = 2;
