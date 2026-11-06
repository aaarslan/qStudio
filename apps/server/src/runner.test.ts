import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultSpec, getModel } from "@qstudio/core";
import type { Job, MediaAsset } from "@qstudio/core";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "qstudio-runner-test-"));
process.env.QSTUDIO_HOME = home;
process.env.QSTUDIO_KEYCHAIN_SERVICE = `Q Studio Runner Test ${process.pid}`;
process.env.QSTUDIO_KEYCHAIN_ACCOUNT = "runner-regression";

const store = await import("./store");
const config = await import("./config");
const { resolveRefs } = await import("./runner");

const model = getModel("wan3.0-video");
const media: MediaAsset = {
  id: "med_remote_source",
  kind: "video",
  name: "source.mp4",
  filePath: path.join(home, "source-is-not-local.mp4"),
  sourceUrl: "https://example.com/source.mp4",
  mime: "video/mp4",
  bytes: 128,
  hash: "remote-source-hash",
  source: "generated",
  tags: [],
  favorite: false,
  createdAt: new Date().toISOString(),
  useCount: 0,
};

before(() => {
  store.loadDb();
  config.saveSettings({ ...config.DEFAULT_SETTINGS, outputRoot: path.join(home, "output") });
  store.addMedia(media);
});

after(() => {
  store.removeMedia(media.id);
  store.closeDb();
  fs.rmSync(home, { recursive: true, force: true });
});

test("reuses hosted video references without reading the local asset", async () => {
  const spec = defaultSpec(model);
  spec.refs = [{ mediaId: media.id, role: "video" }];
  const refs = await resolveRefs(
    { spec } as Job,
    model,
    { key: null, baseUrl: "", demo: false, signal: new AbortController().signal }
  );
  assert.deepEqual(refs, [{ mediaId: media.id, role: "video", url: media.sourceUrl, mime: media.mime }]);
});
