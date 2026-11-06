import test from "node:test";
import assert from "node:assert/strict";
import {
  breakDownScript,
  compileShot,
  forecastFilm,
  normalizePalette,
  paletteDistance,
  refCoverage,
  staleReasons,
  suggestPatches,
} from "./index";
import type { Entity, Scene, Shot, World } from "./index";

const NOW = "2026-10-27T00:00:00.000Z";

function world(patch: Partial<World> = {}): World {
  return {
    id: "wld_1",
    title: "Night Ferry",
    logline: "A courier crosses a city that never dries.",
    scriptText: "",
    palette: ["#1F3A34", "#E8E2D6"],
    aspect: "16:9",
    look: "Muted teal and bone, fine film grain.",
    rules: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function scene(patch: Partial<Scene> = {}): Scene {
  return {
    id: "scn_1",
    worldId: "wld_1",
    title: "Ferry deck",
    slugline: "EXT. FERRY DECK - NIGHT",
    summary: "The lead boards with the case.",
    palette: [],
    light: "Cold deck floods, warm cabin spill.",
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function lead(patch: Partial<Entity> = {}): Entity {
  return {
    id: "ent_lead",
    worldId: "wld_1",
    kind: "character",
    name: "Lead",
    description: "A subject with cropped dark hair and a practical silhouette.",
    wardrobe: "Waxed olive jacket, black roll neck.",
    voiceId: "longanhuan_v3.6",
    negative: "different face, changed hair",
    canonicalMediaIds: ["med_front", "med_three"],
    palette: [],
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function shot(patch: Partial<Shot> = {}): Shot {
  return {
    id: "sht_1",
    worldId: "wld_1",
    sceneId: "scn_1",
    title: "Boarding",
    action: "The lead steps onto the wet deck and scans the empty benches.",
    dialogue: "",
    speakerEntityId: undefined,
    framing: "Medium shot",
    lens: "35mm",
    cameraMove: "Slow push in.",
    light: "",
    emotion: "Wary, controlled.",
    screenDirection: "left-to-right",
    durationSeconds: 5,
    entityIds: ["ent_lead"],
    order: 0,
    mode: "video",
    modelId: "wan3.0-video",
    status: "draft",
    takes: [],
    audioMediaIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

test("palette helpers normalize and measure distance", () => {
  assert.deepEqual(normalizePalette(["#1f3a34", "#1F3A34", "red", "#E8E2D6"]), ["#1F3A34", "#E8E2D6"]);
  assert.equal(paletteDistance(["#000000"], ["#000000"]), 0);
  assert.equal(paletteDistance(["#000000"], ["#FFFFFF"]), 1);
  assert.equal(paletteDistance([], []), 0);
});

test("compiler orders canonical references by cast and maps image tokens", () => {
  const compiled = compileShot({ world: world(), scene: scene(), shot: shot(), entities: [lead()] });
  assert.deepEqual(
    compiled.refs.map((r) => `${r.mediaId}:${r.role}`),
    ["med_front:reference", "med_three:reference"]
  );
  assert.match(compiled.prompt, /Lead/);
  assert.match(compiled.prompt, /\[Image 1\]/);
  assert.match(compiled.prompt, /Medium shot/);
  assert.equal(compiled.spec.modelId, "wan3.0-video");
  assert.equal(compiled.spec.duration, 5);
  assert.deepEqual(compiled.spec.refs.map((r) => r.mediaId), ["med_front", "med_three"]);
});

test("compiler respects the model reference cap", () => {
  const wide = lead({ canonicalMediaIds: ["a", "b", "c", "d", "e"] });
  const compiled = compileShot({
    world: world(),
    scene: scene(),
    shot: shot({ mode: "image", modelId: "qwen-image-3.0-pro" }),
    entities: [wide],
  });
  assert.equal(compiled.refs.length, 3);
  assert.ok(compiled.warnings.some((w) => /cap|limit|accepts/i.test(w)));
});

test("compiler routes palette to the model parameter when supported", () => {
  const compiled = compileShot({
    world: world(),
    scene: scene({ palette: ["#112233", "#DDEEFF"] }),
    shot: shot({ mode: "image", modelId: "wan2.7-image" }),
    entities: [lead()],
  });
  assert.deepEqual(compiled.spec.colorPalette, ["#112233", "#DDEEFF"]);
  assert.deepEqual(compiled.palette, ["#112233", "#DDEEFF"]);
});

test("chained wan shot uses the first frame and drops reference materials", () => {
  const compiled = compileShot({
    world: world(),
    scene: scene(),
    shot: shot({ continuesFromShotId: "sht_prev" }),
    entities: [lead()],
    chainFirstFrameMediaId: "med_last",
  });
  assert.deepEqual(compiled.refs, [{ mediaId: "med_last", role: "first_frame" }]);
  assert.ok(compiled.warnings.some((w) => /first frame/i.test(w)));
});

test("fingerprint is stable and stale reasons name the changed entity", () => {
  const base = compileShot({ world: world(), scene: scene(), shot: shot(), entities: [lead()] });
  const again = compileShot({ world: world(), scene: scene(), shot: shot(), entities: [lead()] });
  assert.equal(base.fingerprint, again.fingerprint);

  const rendered = shot({
    takes: [
      {
        id: "take_1",
        jobId: "job_1",
        label: "Take 1",
        createdAt: NOW,
        fingerprint: base.fingerprint,
        entityVersions: { ent_lead: 1 },
      },
    ],
    selectedTakeId: "take_1",
  });
  assert.deepEqual(staleReasons(world(), scene(), rendered, [lead()]), []);
  const changed = staleReasons(world(), scene(), rendered, [
    lead({ wardrobe: "Red rain shell.", version: 2 }),
  ]);
  assert.ok(changed.some((r) => /Lead/.test(r)));
});

test("coverage reports cast members without canonical references", () => {
  const ghost = lead({ id: "ent_ghost", name: "Companion", canonicalMediaIds: [] });
  const coverage = refCoverage(shot({ entityIds: ["ent_lead", "ent_ghost"] }), [lead(), ghost]);
  assert.equal(coverage.ratio, 0.5);
  assert.deepEqual(coverage.missing, ["Companion"]);
});

test("script breakdown splits sluglines and attaches dialogue", () => {
  const script = [
    "EXT. FERRY DECK - NIGHT",
    "",
    "Rain needles the empty benches. The lead boards with a steel case.",
    "",
    "LEAD",
    "Last crossing. Nobody follows tonight.",
    "",
    "INT. CABIN - NIGHT",
    "",
    "Warm light. The case clicks open under the table.",
  ].join("\n");
  const breakdown = breakDownScript(script);
  assert.equal(breakdown.scenes.length, 2);
  assert.equal(breakdown.scenes[0].slugline, "EXT. FERRY DECK - NIGHT");
  assert.ok(breakdown.scenes[0].shots.length >= 1);
  assert.equal(breakdown.scenes[0].shots[0].framing, "Wide shot");
  assert.ok(breakdown.scenes[0].shots.some((s) => /Last crossing/.test(s.dialogue)));
});

test("copilot proposes missing single coverage and stays quiet when covered", () => {
  const companion = lead({ id: "ent_companion", name: "Companion" });
  const twoShot = shot({
    id: "sht_two",
    entityIds: ["ent_lead", "ent_companion"],
    dialogue: "You came back.",
    speakerEntityId: "ent_companion",
    framing: "Two-shot",
  });
  const suggestions = suggestPatches({
    world: world(),
    scenes: [scene()],
    shots: [twoShot],
    entities: [lead(), companion],
  });
  assert.ok(suggestions.some((s) => s.kind === "coverage" && /Companion/.test(s.title + s.detail)));

  const single = shot({
    id: "sht_single",
    entityIds: ["ent_companion"],
    framing: "Close-up",
    order: 1,
  });
  const covered = suggestPatches({
    world: world(),
    scenes: [scene()],
    shots: [twoShot, single],
    entities: [lead(), companion],
  });
  assert.ok(!covered.some((s) => s.kind === "coverage"));
});

test("copilot reports a reference-less cast member once, not once per shot", () => {
  const bare = lead({ canonicalMediaIds: [] });
  const first = shot({ id: "sht_a", entityIds: ["ent_lead"] });
  const second = shot({ id: "sht_b", entityIds: ["ent_lead"], order: 1 });
  const suggestions = suggestPatches({
    world: world(),
    scenes: [scene()],
    shots: [first, second],
    entities: [bare],
  });
  assert.equal(suggestions.filter((s) => s.kind === "references").length, 1);
});

test("forecast groups compiled units by scene", () => {
  const forecast = forecastFilm(world(), [scene()], [shot()], [lead()]);
  assert.equal(forecast.scenes.length, 1);
  assert.ok(forecast.total > 0);
  assert.equal(forecast.scenes[0].units, forecast.total);
});
