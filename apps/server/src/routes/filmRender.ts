import type { Hono } from "hono";
import {
  compileShot,
  defaultSpec,
  driftScore,
  effectivePalette,
  estimateUnits,
  forecastFilm,
  getModel,
  paletteDistance,
  refCoverage,
  staleReasons,
  suggestPatches,
} from "@qstudio/core";
import type { PatchSuggestion, ShotTake } from "@qstudio/core";
import { emit } from "../events";
import { averageColorHex } from "../media";
import { cancelLocalExport, getLocalExport, listLocalExports, startLocalExport } from "../render-exports";
import {
  getEntity,
  getMedia,
  getScene,
  getShot,
  getWorld,
  listEntities,
  listScenes,
  listShots,
  searchFilm,
  uid,
  updateShot,
} from "../store";
import {
  apiErrorBody,
  buildWorldRenderGraph,
  cleanShotPatch,
  createShotRecord,
  resolveChainFrame,
  selectedTake,
  shotsRendering,
  shotPatchProblem,
  submitSpec,
  takeMedia,
} from "./shared";

export function registerFilmRenderRoutes(app: Hono) {
  app.get("/api/film/shots/:id/compile", async (c) => {
    const targetShot = getShot(c.req.param("id"));
    if (!targetShot) return c.notFound();
    const ownerWorld = getWorld(targetShot.worldId);
    const ownerScene = getScene(targetShot.sceneId);
    if (!ownerWorld || !ownerScene) return c.notFound();
    const entities = listEntities(targetShot.worldId);
    const chainFirstFrameMediaId = await resolveChainFrame(targetShot);
    const compiled = compileShot({
      world: ownerWorld,
      scene: ownerScene,
      shot: targetShot,
      entities,
      chainFirstFrameMediaId,
    });
    return c.json({
      prompt: compiled.prompt,
      spec: compiled.spec,
      refs: compiled.refs.map((r) => ({ ...r, name: getMedia(r.mediaId)?.name ?? r.mediaId })),
      palette: compiled.palette,
      fingerprint: compiled.fingerprint,
      warnings: compiled.warnings,
      stale: staleReasons(ownerWorld, ownerScene, targetShot, entities, chainFirstFrameMediaId),
      units: estimateUnits(compiled.spec),
      coverage: refCoverage(targetShot, entities),
    });
  });

  app.post("/api/film/shots/:id/render", async (c) => {
    const targetShot = getShot(c.req.param("id"));
    if (!targetShot) return c.notFound();
    if (targetShot.status === "locked") {
      return c.json({ error: "This shot is locked for picture lock. Set it back to approved to render again." }, 400);
    }
    const ownerWorld = getWorld(targetShot.worldId);
    const ownerScene = getScene(targetShot.sceneId);
    if (!ownerWorld || !ownerScene) return c.notFound();
    const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
    const entities = listEntities(targetShot.worldId);
    const chainFirstFrameMediaId = await resolveChainFrame(targetShot);
    const compiled = compileShot({ world: ownerWorld, scene: ownerScene, shot: targetShot, entities, chainFirstFrameMediaId });
    if (!compiled.spec.prompt.trim() && !compiled.refs.length) {
      return c.json({ error: "This shot compiles to an empty prompt. Add action or cast first." }, 400);
    }
    if (shotsRendering.has(targetShot.id)) {
      return c.json({ error: "This shot is already being submitted.", code: "DUPLICATE" }, 409);
    }
    shotsRendering.add(targetShot.id);
    const jobId = uid("job");
    const takeId = uid("take");
    const take: ShotTake = {
      id: takeId,
      jobId,
      label: `Take ${targetShot.takes.length + 1}`,
      createdAt: new Date().toISOString(),
      fingerprint: compiled.fingerprint,
      entityVersions: compiled.entityVersions,
      verdict: null,
    };
    updateShot(targetShot.id, { takes: [...targetShot.takes, take] });
    try {
      const job = submitSpec(compiled.spec, {
        force: body.force,
        jobId,
        film: { worldId: ownerWorld.id, sceneId: ownerScene.id, shotId: targetShot.id, takeId },
      });
      emit({ type: "film" });
      return c.json({ job, shot: getShot(targetShot.id), warnings: compiled.warnings });
    } catch (err) {
      const current = getShot(targetShot.id);
      if (current) updateShot(current.id, { takes: current.takes.filter((t) => t.id !== takeId) });
      const { status, body: payload } = apiErrorBody(err);
      return c.json(payload, status);
    } finally {
      shotsRendering.delete(targetShot.id);
    }
  });

  app.post("/api/film/shots/:id/verdict", async (c) => {
    const targetShot = getShot(c.req.param("id"));
    if (!targetShot) return c.notFound();
    const body = (await c.req.json()) as { takeId?: string; verdict?: string | null };
    const verdict: "accepted" | "rejected" | null =
      body.verdict === "accepted" || body.verdict === "rejected" ? body.verdict : null;
    const takes = targetShot.takes.map((t) => (t.id === body.takeId ? { ...t, verdict } : t));
    if (!takes.some((t) => t.id === body.takeId)) return c.json({ error: "Take not found." }, 400);
    const updatedShot = updateShot(targetShot.id, { takes });
    emit({ type: "film" });
    return c.json({ shot: updatedShot });
  });

  app.post("/api/film/shots/:id/drift", async (c) => {
    const targetShot = getShot(c.req.param("id"));
    if (!targetShot) return c.notFound();
    const ownerWorld = getWorld(targetShot.worldId);
    const ownerScene = getScene(targetShot.sceneId);
    if (!ownerWorld || !ownerScene) return c.notFound();
    const take = selectedTake(targetShot);
    if (!take) return c.json({ error: "Render a take before checking drift." }, 400);
    const media = takeMedia(take);
    const entities = listEntities(targetShot.worldId);
    const coverage = refCoverage(targetShot, entities);
    const palette = effectivePalette(ownerWorld, ownerScene);
    const average = media ? await averageColorHex(media) : null;
    const distance = average && palette.length ? paletteDistance([average], palette) : undefined;
    const warnings: string[] = [];
    if (!media) warnings.push("The take file is missing, so palette drift was not measured.");
    else if (!average) warnings.push("Average color is unavailable for this file, so palette drift was not measured.");
    else if (!palette.length) warnings.push("No scene or film palette is set, so there is nothing to drift from.");
    else if (distance !== undefined && distance > 0.35) warnings.push(`Palette distance ${distance} from the color script.`);
    else if (distance !== undefined) warnings.push(`Palette distance ${distance}, inside the color script.`);
    for (const name of coverage.missing) warnings.push(`${name} rendered without a canonical reference.`);
    warnings.push("Identity and eyeline checks need a local vision model and were not measured.");
    const drift = {
      score: driftScore(distance, coverage.ratio),
      paletteDistance: distance,
      averageColor: average ?? undefined,
      refCoverage: coverage.ratio,
      warnings,
      checkedAt: new Date().toISOString(),
    };
    const takes = targetShot.takes.map((t) => (t.id === take.id ? { ...t, drift } : t));
    const updatedShot = updateShot(targetShot.id, { takes });
    emit({ type: "film" });
    return c.json({ shot: updatedShot, drift });
  });

  app.post("/api/film/shots/:id/voice", async (c) => {
    const targetShot = getShot(c.req.param("id"));
    if (!targetShot) return c.notFound();
    if (!targetShot.dialogue.trim()) return c.json({ error: "This shot has no dialogue line to voice." }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { voiceId?: string; force?: boolean };
    const speaker = targetShot.speakerEntityId ? getEntity(targetShot.speakerEntityId) : undefined;
    const ttsModel = getModel("qwen-audio-3.0-tts-plus");
    const spec = defaultSpec(ttsModel);
    spec.prompt = targetShot.dialogue.trim();
    spec.voice = body.voiceId || speaker?.voiceId || spec.voice;
    try {
      const job = submitSpec(spec, { force: body.force });
      return c.json({ job, voiceId: spec.voice });
    } catch (err) {
      const { status, body: payload } = apiErrorBody(err);
      return c.json(payload, status);
    }
  });

  app.get("/api/film/worlds/:id/render-graph", async (c) => {
    const built = await buildWorldRenderGraph(c.req.param("id"));
    if (!built) return c.notFound();
    return c.json({ graph: built.graph, skipped: built.skipped });
  });

  app.post("/api/film/worlds/:id/preview", async (c) => {
    const built = await buildWorldRenderGraph(c.req.param("id"));
    if (!built) return c.notFound();
    if (!built.graph.clips.length) return c.json({ error: "No selected image or video takes to preview yet." }, 400);
    const activeForWorld = listLocalExports().find(
      (item) => item.worldId === built.world.id && (item.status === "queued" || item.status === "running")
    );
    if (activeForWorld) {
      return c.json({ error: "This film already has a preview export queued or running.", code: "DUPLICATE" }, 409);
    }
    const activeCount = listLocalExports().filter(
      (item) => item.status === "queued" || item.status === "running"
    ).length;
    if (activeCount >= 8) {
      return c.json({ error: "The local export queue is full. Wait for a cut to finish or cancel one." }, 429);
    }
    const localExport = startLocalExport(built.world.id, built.world.title, built.graph);
    return c.json({ localExport, skipped: built.skipped });
  });

  app.get("/api/exports", (c) => c.json({ exports: listLocalExports() }));

  app.get("/api/exports/:id", (c) => {
    const item = getLocalExport(c.req.param("id"));
    if (!item) return c.notFound();
    return c.json({ export: item });
  });

  app.post("/api/exports/:id/cancel", (c) => {
    const item = cancelLocalExport(c.req.param("id"));
    if (!item) return c.notFound();
    return c.json({ export: item });
  });

  app.get("/api/film/worlds/:id/forecast", (c) => {
    const ownerWorld = getWorld(c.req.param("id"));
    if (!ownerWorld) return c.notFound();
    return c.json(forecastFilm(ownerWorld, listScenes(ownerWorld.id), listShots(ownerWorld.id), listEntities(ownerWorld.id)));
  });

  app.get("/api/film/worlds/:id/suggestions", (c) => {
    const ownerWorld = getWorld(c.req.param("id"));
    if (!ownerWorld) return c.notFound();
    const suggestions = suggestPatches({
      world: ownerWorld,
      scenes: listScenes(ownerWorld.id),
      shots: listShots(ownerWorld.id),
      entities: listEntities(ownerWorld.id),
    });
    return c.json({ suggestions });
  });

  app.post("/api/film/suggestions/apply", async (c) => {
    const body = (await c.req.json()) as { suggestion?: PatchSuggestion };
    const suggestion = body.suggestion;
    if (!suggestion) return c.json({ error: "No suggestion given." }, 400);
    if (suggestion.patch && suggestion.shotId) {
      const current = getShot(suggestion.shotId);
      if (!current) return c.notFound();
      const cleaned = cleanShotPatch(suggestion.patch as unknown as Record<string, unknown>);
      if (cleaned.error) return c.json({ error: cleaned.error }, 400);
      const problem = shotPatchProblem(current, cleaned.patch);
      if (problem) return c.json({ error: problem }, 400);
      const updatedShot = updateShot(current.id, cleaned.patch);
      emit({ type: "film" });
      return c.json({ shot: updatedShot });
    }
    if (suggestion.draftShot && suggestion.sceneId) {
      const parentScene = getScene(suggestion.sceneId);
      if (!parentScene) return c.notFound();
      const cleaned = cleanShotPatch(suggestion.draftShot as unknown as Record<string, unknown>);
      if (cleaned.error) return c.json({ error: cleaned.error }, 400);
      const problem = shotPatchProblem(
        {
          id: "new_shot",
          worldId: parentScene.worldId,
          takes: [],
          mode: cleaned.patch.mode ?? "video",
          modelId: cleaned.patch.modelId ?? "wan3.0-video",
        },
        cleaned.patch
      );
      if (problem) return c.json({ error: problem }, 400);
      const createdShot = createShotRecord(parentScene, cleaned.patch, "Suggested shot");
      emit({ type: "film" });
      return c.json({ shot: createdShot });
    }
    return c.json({ error: "This suggestion is a note. There is nothing to apply." }, 400);
  });

  app.get("/api/film/search", (c) => c.json(searchFilm(c.req.query("q") ?? "")));
}
