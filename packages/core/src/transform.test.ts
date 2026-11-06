import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, TOKEN_PLAN_BASE } from "./build";
import { defaultSpec } from "./prompt";
import { getModel } from "./models";
import {
  abSpecs,
  clampCrop,
  frameTimes,
  parseMediaInfo,
  presetCrop,
  splitScript,
  ssmlToText,
  transformFilter,
  withLockedSeed,
} from "./transform";

test("clampCrop keeps the rect inside the frame with a minimum size", () => {
  const c = clampCrop({ x: -0.5, y: 0.9, w: 2, h: 0.5 });
  assert.ok(c.x >= 0 && c.y >= 0);
  assert.ok(c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001);
  assert.ok(c.w >= 0.05 && c.h >= 0.05);
});

test("presetCrop centers the largest matching rect", () => {
  const square = presetCrop("1:1", 1600, 900);
  assert.ok(Math.abs(square.w * 1600 - square.h * 900) < 2);
  assert.ok(Math.abs(square.x - (1 - square.w) / 2) < 0.001);
  const wide = presetCrop("16:9", 900, 1600);
  assert.ok(Math.abs((wide.w * 900) / (wide.h * 1600) - 16 / 9) < 0.02);
});

test("transformFilter builds crop, rotate and flip chains", () => {
  assert.equal(transformFilter({}), "null");
  assert.match(transformFilter({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 } }), /crop=iw\*0\.5:ih\*0\.5:iw\*0\.1:ih\*0\.2/);
  assert.match(transformFilter({ rotate: 90 }), /transpose=1/);
  assert.match(transformFilter({ rotate: 270 }), /transpose=2/);
  assert.match(transformFilter({ rotate: 180, flipH: true }), /hflip/);
});

test("frameTimes spreads interior samples and survives zero duration", () => {
  assert.deepEqual(frameTimes(0, 4), [0]);
  const times = frameTimes(10, 4);
  assert.equal(times.length, 4);
  assert.ok(times[0] > 0 && times[3] < 10);
  assert.ok(times[1] - times[0] > 1.9 && times[1] - times[0] < 2.1);
});

test("splitScript trims, drops blanks and caps the count", () => {
  assert.deepEqual(splitScript(" one \n\ntwo\n  \nthree "), ["one", "two", "three"]);
  assert.equal(splitScript(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")).length, 8);
});

test("parseMediaInfo reads ffmpeg -i output", () => {
  const sample = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
    "  Duration: 00:01:03.16, start: 0.000000, bitrate: 1320 kb/s",
    "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 848x480, 1237 kb/s, 24 fps (default)",
    "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 24000 Hz, stereo, fltp, 119 kb/s (default)",
  ].join("\n");
  const info = parseMediaInfo(sample);
  assert.equal(info.width, 848);
  assert.equal(info.height, 480);
  assert.ok(Math.abs((info.durationSeconds ?? 0) - 63.16) < 0.01);
  assert.deepEqual(parseMediaInfo("no media here"), {});
});

test("withLockedSeed stamps a seed once and reuses it", () => {
  const model = getModel("qwen-image-3.0-pro");
  const spec = defaultSpec(model);
  const stamped = withLockedSeed(spec, true, () => 4242);
  assert.equal(stamped.seed, 4242);
  assert.equal(withLockedSeed(stamped, true, () => 9999).seed, 4242);
  assert.equal(withLockedSeed(spec, false, () => 4242).seed, spec.seed);
  const wan = withLockedSeed(defaultSpec(getModel("wan2.7-image")), true, () => 4242);
  assert.equal(wan.seed, defaultSpec(getModel("wan2.7-image")).seed);
});

test("ssmlToText converts a safe subset and strips everything else", () => {
  const out = ssmlToText(
    '<speak><p>Hello <emphasis level="strong">darkroom</emphasis>.</p><break time="800ms"/><prosody rate="slow">Take your time.</prosody> <script>alert(1)</script><unknown x="1">done</unknown></speak>'
  );
  assert.match(out.text, /Hello darkroom\./);
  assert.match(out.text, /Take your time\./);
  assert.ok(!out.text.includes("<"));
  assert.ok(!out.text.includes("alert"));
  assert.ok(out.hints.some((h) => /slow/i.test(h)));
  assert.ok(out.text.includes("…") || out.hints.some((h) => /pause/i.test(h)));
  const plain = ssmlToText("Just words, no markup.");
  assert.equal(plain.text, "Just words, no markup.");
});

test("tts requests convert SSML to plain text plus delivery hints", () => {
  const model = getModel("qwen-audio-3.0-tts-plus");
  const spec = {
    ...defaultSpec(model),
    ssml: true,
    prompt: '<speak><prosody rate="slow">Slow down.</prosody></speak>',
  };
  const req = buildRequest(model, spec, [], TOKEN_PLAN_BASE) as any;
  assert.equal(req.body.input.text, "Slow down.");
  assert.match(req.body.input.instruction ?? "", /slowly/i);
  const plain = buildRequest(model, { ...spec, ssml: false }, [], TOKEN_PLAN_BASE) as any;
  assert.match(plain.body.input.text, /<speak>/);
});

test("abSpecs keeps the prompt and gives each model a valid single-output spec", () => {
  const base = { ...defaultSpec(getModel("qwen-image-3.0-pro")), prompt: "a lighthouse at dawn", n: 4 };
  const specs = abSpecs(base, ["qwen-image-3.0-pro", "wan2.7-image-pro", "wan3.0-video"]);
  assert.equal(specs.length, 2);
  for (const spec of specs) {
    assert.equal(spec.prompt, "a lighthouse at dawn");
    assert.equal(spec.n, 1);
    assert.equal(spec.mode, "image");
    assert.ok(spec.size.includes("*"));
  }
});
