import test from "node:test";
import assert from "node:assert/strict";
import { buildRequest, defaultSpec, getModel, reusableRemoteUrl } from "./index";

const NOW = Date.UTC(2026, 9, 27, 17, 35, 0);

test("reusableRemoteUrl accepts a signed URL that is still fresh", () => {
  const url = `https://dashscope-463f.oss-accelerate.aliyuncs.com/x/clip.mp4?Expires=${Math.floor(NOW / 1000) + 3600}&OSSAccessKeyId=k&Signature=s`;
  assert.equal(reusableRemoteUrl(url, NOW), url);
});

test("reusableRemoteUrl rejects an expired signed URL", () => {
  const url = `https://example.com/clip.mp4?Expires=${Math.floor(NOW / 1000) - 3600}`;
  assert.equal(reusableRemoteUrl(url, NOW), undefined);
});

test("reusableRemoteUrl rejects a signed URL expiring inside the safety buffer", () => {
  const url = `https://example.com/clip.mp4?Expires=${Math.floor(NOW / 1000) + 30}`;
  assert.equal(reusableRemoteUrl(url, NOW), undefined);
});

test("reusableRemoteUrl accepts an unsigned http URL and rejects non-remote values", () => {
  assert.equal(reusableRemoteUrl("https://example.com/clip.mp4", NOW), "https://example.com/clip.mp4");
  assert.equal(reusableRemoteUrl(undefined, NOW), undefined);
  assert.equal(reusableRemoteUrl("", NOW), undefined);
  assert.equal(reusableRemoteUrl("data:video/mp4;base64,AAAA", NOW), undefined);
  assert.equal(reusableRemoteUrl("oss://tmp/clip.mp4", NOW), undefined);
  assert.equal(reusableRemoteUrl("/api/media/med_1/file", NOW), undefined);
});

test("wan video request carries an https reference_video unchanged", () => {
  const model = getModel("wan3.0-video");
  const spec = { ...defaultSpec(model), prompt: "Continue the shot" };
  const hosted = "https://dashscope-463f.oss-accelerate.aliyuncs.com/x/clip.mp4?Expires=1793208010";
  const req = buildRequest(
    model,
    spec,
    [{ mediaId: "med_1", role: "video", url: hosted, mime: "video/mp4" }],
    "https://token-plan.maas.qwencloudapi.com"
  );
  assert.deepEqual((req.body as any).input.media, [{ type: "reference_video", url: hosted }]);
  assert.equal(req.headers["X-DashScope-OssResourceResolve"], undefined);
});
