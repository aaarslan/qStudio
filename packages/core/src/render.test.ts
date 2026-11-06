import test from "node:test";
import assert from "node:assert/strict";
import {
  canvasForAspect,
  compileFilmRenderGraph,
  filmGraphDuration,
  filmGraphSummary,
} from "./index";

test("canvas selection preserves landscape, portrait, and square aspects", () => {
  assert.deepEqual(canvasForAspect("16:9"), { width: 1280, height: 720 });
  assert.deepEqual(canvasForAspect("9:16"), { width: 720, height: 1280 });
  assert.deepEqual(canvasForAspect("1:1"), { width: 1280, height: 1280 });
  assert.deepEqual(canvasForAspect("21:9"), { width: 1280, height: 548 });
  assert.deepEqual(canvasForAspect("adaptive"), { width: 1280, height: 720 });
  assert.equal(canvasForAspect("4:3", 1000).width % 2, 0);
  assert.equal(canvasForAspect("4:3", 1000).height % 2, 0);
});

test("render graph keeps clip order and applies trims", () => {
  const graph = compileFilmRenderGraph({
    title: "Night Ferry",
    width: 1279,
    height: 719,
    clips: [
      {
        id: "clip_1",
        mediaId: "med_1",
        name: "one.mp4",
        kind: "video",
        path: "/tmp/one.mp4",
        durationSeconds: 8,
        trimIn: 2,
        trimOut: 6,
        hasAudio: true,
        audio: [],
      },
      {
        id: "clip_2",
        mediaId: "med_2",
        name: "two.png",
        kind: "image",
        path: "/tmp/two.png",
        durationSeconds: 3,
        hasAudio: false,
        audio: [{ id: "a1", name: "line.mp3", path: "/tmp/line.mp3", gain: 0.8 }],
      },
    ],
  });
  assert.equal(graph.width, 1280);
  assert.equal(graph.height, 720);
  assert.deepEqual(
    graph.clips.map((clip) => [clip.id, clip.durationSeconds]),
    [
      ["clip_1", 4],
      ["clip_2", 3],
    ]
  );
  assert.equal(filmGraphDuration(graph), 7);
  assert.deepEqual(filmGraphSummary(graph), {
    clips: 2,
    audioClips: 1,
    seconds: 7,
    resolution: "1280x720",
    fps: 24,
  });
});

test("render graph rejects impossible trims and preserves audio order", () => {
  const graph = compileFilmRenderGraph({
    title: "",
    clips: [
      {
        id: "clip",
        mediaId: "med",
        name: "clip.mp4",
        kind: "video",
        path: "/tmp/clip.mp4",
        durationSeconds: 5,
        trimIn: 3,
        trimOut: 2,
        hasAudio: false,
        audio: [
          { id: "a", name: "a.mp3", path: "/tmp/a.mp3", gain: 1 },
          { id: "b", name: "b.mp3", path: "/tmp/b.mp3", gain: 0.5 },
          { id: "c", name: "c.mp3", path: "/tmp/c.mp3", gain: 1.7 },
        ],
      },
    ],
  });
  assert.equal(graph.title, "Film preview");
  assert.equal(graph.clips[0].durationSeconds, 5);
  assert.deepEqual(graph.clips[0].audio.map((audio) => audio.id), ["a", "b", "c"]);
  assert.equal(graph.clips[0].audio[1].gain, 0.5);
  assert.equal(graph.clips[0].audio[2].gain, 1);
  assert.equal(graph.clips[0].hasAudio, false);
});
