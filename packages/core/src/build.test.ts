import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRequest,
  defaultSpec,
  extractAudioUrl,
  extractImageUrls,
  extractVideoUrl,
  getModel,
  parseError,
  remapTokens,
  sanitizeRequest,
  sizeFor,
  toCurl,
} from "./index";

const BASE = "https://token-plan.maas.qwencloudapi.com";

function specFor(id: string, patch: Record<string, unknown> = {}) {
  const model = getModel(id);
  return { ...defaultSpec(model), ...patch } as ReturnType<typeof defaultSpec>;
}

test("size tables: qwen and wan", () => {
  assert.equal(sizeFor(getModel("qwen-image-3.0-pro"), "16:9", "2K"), "2048*1152");
  assert.equal(sizeFor(getModel("qwen-image-3.0-pro"), "1:1", "2K"), "2048*2048");
  assert.equal(sizeFor(getModel("wan2.7-image"), "16:9", "2K"), "2688*1536");
  assert.equal(sizeFor(getModel("wan2.7-image-pro"), "1:1", "4K"), "4096*4096");
  assert.equal(sizeFor(getModel("wan2.7-image"), "9:16", "1K"), "960*1696");
});

test("qwen text-to-image builds the documented multimodal request", () => {
  const spec = specFor("qwen-image-3.0-pro", {
    prompt: "A pear on a table",
    size: "2048*1536",
    n: 2,
    negativePrompt: "blurry",
    seed: 42,
    promptExtend: true,
    thinking: true,
  });
  const req = buildRequest(getModel("qwen-image-3.0-pro"), spec, [], BASE);
  assert.equal(req.url, `${BASE}/api/v1/services/aigc/multimodal-generation/generation`);
  assert.equal(req.async, false);
  assert.equal((req.body as any).model, "qwen-image-3.0-pro");
  assert.deepEqual((req.body as any).input.messages[0].content, [{ text: "A pear on a table" }]);
  assert.equal((req.body as any).parameters.size, "2048*1536");
  assert.equal((req.body as any).parameters.n, 2);
  assert.equal((req.body as any).parameters.negative_prompt, "blurry");
  assert.equal((req.body as any).parameters.seed, 42);
  assert.equal((req.body as any).parameters.enable_thinking, true);
  assert.equal(req.headers["X-DashScope-Async"], undefined);
});

test("qwen image edit puts images first and never sends agent rewrite mode", () => {
  const spec = specFor("qwen-image-3.0-pro", {
    prompt: "Put the jacket from [Image 2] on [Image 1]",
    promptExtend: true,
    promptExtendMode: "agent",
  });
  const refs = [
    { mediaId: "m1", role: "reference" as const, url: "data:image/png;base64,AAA", mime: "image/png" },
    { mediaId: "m2", role: "reference" as const, url: "data:image/png;base64,BBB", mime: "image/png" },
  ];
  const req = buildRequest(getModel("qwen-image-3.0-pro"), spec, refs, BASE);
  const content = (req.body as any).input.messages[0].content;
  assert.deepEqual(content.map((c: any) => (c.image ? "image" : "text")), ["image", "image", "text"]);
  assert.equal((req.body as any).parameters.prompt_extend_mode, undefined);
});

test("wan 2.7 routes to the image-generation endpoint and supports sets", () => {
  const spec = specFor("wan2.7-image", {
    prompt: "Character sheet",
    sequential: true,
    n: 8,
    colorPalette: ["#111111", "#eeeeee", "#ff6b3d"],
    thinking: true,
  });
  const req = buildRequest(getModel("wan2.7-image"), spec, [], BASE);
  assert.equal(req.url, `${BASE}/api/v1/services/aigc/image-generation/generation`);
  assert.equal(req.async, true);
  assert.equal(req.headers["X-DashScope-Async"], "enable");
  assert.equal((req.body as any).parameters.enable_sequential, true);
  assert.equal((req.body as any).parameters.n, 8);
  assert.deepEqual((req.body as any).parameters.color_palette, ["#111111", "#eeeeee", "#ff6b3d"]);
  assert.equal((req.body as any).parameters.negative_prompt, undefined);
});

test("wan 3.0 builds an async media request", () => {
  const spec = specFor("wan3.0-video", {
    prompt: "A slow dolly",
    resolution: "1080P",
    ratio: "16:9",
    duration: 10,
    audioTrack: true,
    promptExtend: true,
    smartDuration: false,
  });
  const refs = [
    { mediaId: "a", role: "first_frame" as const, url: "https://x/a.png", mime: "image/png" },
    { mediaId: "b", role: "reference" as const, url: "https://x/b.png", mime: "image/png" },
  ];
  const req = buildRequest(getModel("wan3.0-video"), spec, refs, BASE);
  assert.equal(req.url, `${BASE}/api/v1/services/aigc/video-generation/video-synthesis`);
  assert.equal(req.async, true);
  assert.equal(req.headers["X-DashScope-Async"], "enable");
  assert.deepEqual((req.body as any).input.media, [
    { type: "first_frame", url: "https://x/a.png" },
    { type: "reference_image", url: "https://x/b.png" },
  ]);
  assert.equal((req.body as any).parameters.duration, 10);
  assert.equal((req.body as any).parameters.audio, true);
});

test("wan 3.0 smart duration sends -1", () => {
  const spec = specFor("wan3.0-video", { prompt: "x", smartDuration: true });
  const req = buildRequest(getModel("wan3.0-video"), spec, [], BASE);
  assert.equal((req.body as any).parameters.duration, -1);
});

test("happyhorse i2v omits ratio and requires a first frame", () => {
  const model = getModel("happyhorse-1.1-i2v");
  const spec = specFor("happyhorse-1.1-i2v", { prompt: "Animate", duration: 5 });
  const refs = [{ mediaId: "a", role: "first_frame" as const, url: "https://x/a.png", mime: "image/png" }];
  const req = buildRequest(model, spec, refs, BASE);
  assert.deepEqual((req.body as any).input.media, [{ type: "first_frame", url: "https://x/a.png" }]);
  assert.equal((req.body as any).parameters.ratio, undefined);
  assert.equal((req.body as any).parameters.duration, 5);
});

test("oss references add the resolve header", () => {
  const spec = specFor("happyhorse-1.1-r2v", { prompt: "x" });
  const refs = [{ mediaId: "a", role: "reference" as const, url: "oss://bucket/a.png", mime: "image/png" }];
  const req = buildRequest(getModel("happyhorse-1.1-r2v"), spec, refs, BASE);
  assert.equal(req.headers["X-DashScope-OssResourceResolve"], "enable");
  assert.deepEqual((req.body as any).input.media, [{ type: "reference_image", url: "oss://bucket/a.png" }]);
});

test("tts builds the SpeechSynthesizer body", () => {
  const spec = specFor("qwen-audio-3.0-tts-plus", {
    prompt: "Hello world",
    voice: "longanhuan_v3.6",
    format: "mp3",
    sampleRate: 24000,
    instruction: "Speak slowly",
  });
  const req = buildRequest(getModel("qwen-audio-3.0-tts-plus"), spec, [], BASE);
  assert.equal(req.url, `${BASE}/api/v1/services/audio/tts/SpeechSynthesizer`);
  assert.deepEqual((req.body as any).input, {
    text: "Hello world",
    voice: "longanhuan_v3.6",
    format: "mp3",
    sample_rate: 24000,
    instruction: "Speak slowly",
  });
});

test("removing a reference remaps later tokens", () => {
  assert.equal(remapTokens("[Image 1] and [Image 2]", { 1: null, 2: 1 }), "[Image 1] and [Image 1]");
  assert.equal(remapTokens("[Image 1] and [Image 2]", { 1: 2, 2: 1 }), "[Image 2] and [Image 1]");
});

test("response parsers cover the documented shapes", () => {
  assert.deepEqual(
    extractImageUrls({ output: { choices: [{ message: { content: [{ image: "u1" }, { image: "u2" }] } }] } }),
    ["u1", "u2"]
  );
  assert.equal(extractVideoUrl({ output: { video_url: "v" } }), "v");
  assert.equal(extractAudioUrl({ output: { audio: { url: "a" } } }), "a");
});

test("errors carry a actionable hint", () => {
  const e = parseError(400, "", { code: "DataInspectionFailed", message: "blocked" });
  assert.equal(e.code, "DataInspectionFailed");
  assert.match(e.hint ?? "", /moderation/i);

  const sync = parseError(403, "", {
    code: "AccessDenied",
    message: "current user api does not support synchronous calls",
  });
  assert.match(sync.hint ?? "", /async/i);
});

test("stored requests redact inline media but keep the structure", () => {
  const req = buildRequest(
    getModel("qwen-image-3.0-pro"),
    specFor("qwen-image-3.0-pro", { prompt: "x" }),
    [{ mediaId: "a", role: "reference" as const, url: "data:image/png;base64,AAAA", mime: "image/png" }],
    BASE
  );
  const clean = sanitizeRequest(req);
  const content = (clean.body as any).input.messages[0].content;
  assert.equal(content[0].image, "data:image/png;base64,<…>");
});

test("curl export survives apostrophes and shell quoting", () => {
  const req = buildRequest(
    getModel("qwen-image-3.0-pro"),
    specFor("qwen-image-3.0-pro", { prompt: "the woman's coat" }),
    [],
    BASE
  );
  const curl = toCurl(req);
  assert.match(curl, /the woman'\\''s coat/);
  assert.match(curl, /-d '/);
  assert.match(curl, /-H 'Content-Type: application\/json'/);
});
