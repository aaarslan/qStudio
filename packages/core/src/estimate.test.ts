import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSpec } from "./prompt";
import { getModel } from "./models";
import {
  compileStoryboard,
  doctorLite,
  estimateUnits,
  expandVariables,
  moderationRisks,
  needsConfirm,
  promptVariables,
  storyboardDuration,
} from "./estimate";

test("image units scale with tier and n", () => {
  const model = getModel("wan2.7-image-pro");
  const base = defaultSpec(model);
  const one = estimateUnits({ ...base, tier: "1K", n: 1, thinking: false }, model);
  const big = estimateUnits({ ...base, tier: "4K", n: 4 }, model);
  assert.equal(one, 1);
  assert.ok(big > one * 10);
});

test("video units scale with duration and resolution; smart duration is 5s", () => {
  const model = getModel("wan3.0-video");
  const base = defaultSpec(model);
  const smart = estimateUnits({ ...base, smartDuration: true, duration: 30, resolution: "720P" }, model);
  const long = estimateUnits({ ...base, smartDuration: false, duration: 30, resolution: "720P" }, model);
  assert.ok(long > smart * 4);
});

test("audio units grow with script length and never drop to zero", () => {
  const model = getModel("qwen-audio-3.0-tts-plus");
  const base = defaultSpec(model);
  assert.ok(estimateUnits({ ...base, prompt: "hi" }, model) >= 0.5);
  assert.ok(estimateUnits({ ...base, prompt: "x".repeat(2000) }, model) > 5);
});

test("confirm gates fire for 4K, n>4 and long video only", () => {
  const img = getModel("wan2.7-image-pro");
  const imgBase = defaultSpec(img);
  assert.ok(needsConfirm({ ...imgBase, tier: "4K" }, img));
  assert.ok(needsConfirm({ ...imgBase, tier: "2K", n: 6 }, img));
  assert.equal(needsConfirm({ ...imgBase, tier: "2K", n: 2 }, img), null);
  const vid = getModel("wan3.0-video");
  const vidBase = defaultSpec(vid);
  assert.ok(needsConfirm({ ...vidBase, smartDuration: false, duration: 30 }, vid));
  assert.equal(needsConfirm({ ...vidBase, smartDuration: false, duration: 5 }, vid), null);
});

test("variables are listed in order and expanded; unknown vars stay literal", () => {
  const text = "{{subject}} in {{ place }}, again {{subject}}";
  assert.deepEqual(promptVariables(text), ["subject", "place"]);
  assert.equal(expandVariables(text, { subject: "A fox" }), "A fox in {{ place }}, again A fox");
});

test("doctor flags missing light and framing, and stays quiet on a full prompt", () => {
  const thin = doctorLite("a cat", "image");
  assert.ok(thin.length >= 3);
  const full = doctorLite(
    "Editorial portrait at golden hour, soft backlight, 85mm shallow depth of field, warm film grain, no text.",
    "image"
  );
  assert.equal(full.length, 0);
});

test("moderation scan flags a sustained viewer-directed intimacy build as high risk", () => {
  const text =
    "An adult stage performer, filmed in POV, photorealistic. She leans toward the camera until her face fills the frame, glossy lips curving into a smirk, and speaks in a sultry whisper, commanding the viewer to worship her and kneel at her feet while she stays in complete control of the scene.";
  const risks = moderationRisks(text, { promptExtend: true });
  const intimacy = risks.find((r) => r.id === "intimacy");
  assert.ok(intimacy);
  assert.equal(intimacy.level, "high");
  assert.ok(intimacy.matches.length >= 3);
  assert.ok(risks.some((r) => r.id === "prompt-extend"));
});

test("moderation scan stays quiet on ordinary prompts and single weak signals", () => {
  assert.deepEqual(moderationRisks("A ripe pear on a pale linen table, soft north light, quiet still life, 50mm."), []);
  assert.deepEqual(
    moderationRisks("A woman walks toward the camera in a bright office, smiles and waves, daylight, wide shot."),
    []
  );
  assert.deepEqual(moderationRisks("Warm narration, read slowly with a soft whisper at the end."), []);
});

test("moderation scan ignores the negative prompt section", () => {
  const text =
    "A knight crosses a misty field at dawn, wide shot.\n\nNegative prompt list: no gore, no blood, no corpse, no violence.";
  assert.deepEqual(moderationRisks(text), []);
});

test("moderation scan flags youth wording, gore, and likeness wording with reasons", () => {
  const youth = moderationRisks("Photorealistic portrait of a school girl in a school uniform, close-up.");
  assert.ok(youth.some((r) => r.id === "minor"));
  const gore = moderationRisks("A bloody corpse after a massacre, gore everywhere, photorealistic.");
  assert.equal(gore.find((r) => r.id === "violence")?.level, "high");
  const fake = moderationRisks("A deepfake of a celebrity giving a speech.");
  assert.equal(fake.find((r) => r.id === "impersonation")?.level, "high");
  assert.ok(moderationRisks("A 12-year-old boy rides a bicycle.").some((r) => r.id === "minor"));
  assert.deepEqual(moderationRisks("A 24-year-old woman rides a bicycle, daylight."), []);
});

test("storyboard compiles to timed shots matching the multi-shot format", () => {
  const shots = [
    { title: "", prompt: "Wide shot of a street.", seconds: 3 },
    { title: "Detail", prompt: "Close-up of a wheel.", seconds: 4 },
  ];
  assert.equal(storyboardDuration(shots), 7);
  assert.equal(
    compileStoryboard(shots),
    "Shot 1 [0-3s]: Wide shot of a street. Shot 2 [3-7s]: Detail. Close-up of a wheel."
  );
});
