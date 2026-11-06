import type { Hono } from "hono";
import { breakDownScript, getModel, normalizePalette } from "@qstudio/core";
import type { Entity, Scene, World } from "@qstudio/core";
import { emit } from "../events";
import {
  addEntity,
  addScene,
  addShot,
  addWorld,
  filmState,
  getMedia,
  getScene,
  getShot,
  getWorld,
  listEntities,
  listScenes,
  listShots,
  listWorlds,
  removeEntity,
  removeScene,
  removeShot,
  removeWorld,
  uid,
  updateEntity,
  updateScene,
  updateShot,
  updateWorld,
} from "../store";
import {
  cleanShotPatch,
  createShotRecord,
  numberField,
  pickFields,
  shotPatchProblem,
  stringsField,
  textField,
} from "./shared";

export function registerFilmCrudRoutes(app: Hono) {
  app.get("/api/film/worlds", (c) => c.json({ worlds: listWorlds() }));

  app.get("/api/film/worlds/:id", (c) => {
    const state = filmState(c.req.param("id"));
    if (!state.world) return c.notFound();
    return c.json(state);
  });

  app.post("/api/film/worlds", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    const created: World = addWorld({
      id: uid("wld"),
      title: textField(body.title).trim() || "Untitled film",
      logline: textField(body.logline),
      scriptText: textField(body.scriptText),
      palette: normalizePalette(stringsField(body.palette)),
      aspect: textField(body.aspect).trim() || "16:9",
      look: textField(body.look),
      rules: textField(body.rules),
      createdAt: now,
      updatedAt: now,
    });
    emit({ type: "film" });
    return c.json({ ...filmState(created.id), world: created });
  });

  app.patch("/api/film/worlds/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "World patch must be an object." }, 400);
    }
    const patch = pickFields<World>(body, ["title", "logline", "scriptText", "palette", "aspect", "look", "rules"]);
    for (const key of ["title", "logline", "scriptText", "aspect", "look", "rules"] as const) {
      if (key in patch && typeof patch[key] !== "string") {
        return c.json({ error: `${key} must be text.` }, 400);
      }
    }
    if (patch.palette) {
      if (!Array.isArray(patch.palette) || patch.palette.some((value) => typeof value !== "string")) {
        return c.json({ error: "Palette must be a list of colours." }, 400);
      }
      patch.palette = normalizePalette(patch.palette);
    }
    const updated = updateWorld(c.req.param("id"), patch);
    if (!updated) return c.notFound();
    emit({ type: "film" });
    return c.json({ world: updated });
  });

  app.delete("/api/film/worlds/:id", (c) => {
    if (!removeWorld(c.req.param("id"))) return c.notFound();
    emit({ type: "film" });
    return c.json({ ok: true });
  });

  app.post("/api/film/worlds/:id/breakdown", async (c) => {
    const existingWorld = getWorld(c.req.param("id"));
    if (!existingWorld) return c.notFound();
    const body = (await c.req.json().catch(() => ({}))) as { scriptText?: string; replace?: boolean };
    const script = (body.scriptText ?? existingWorld.scriptText ?? "").trim();
    if (!script) return c.json({ error: "Paste a script first, then break it down." }, 400);
    const existingScenes = listScenes(existingWorld.id);
    if (existingWorld.scriptText.trim() === script && existingScenes.length > 0) {
      return c.json({
        ...filmState(existingWorld.id),
        breakdownScenes: existingScenes.length,
        unchanged: true,
      });
    }
    const breakdown = breakDownScript(script);
    if (!breakdown.scenes.length) return c.json({ error: "No scenes found. Sluglines like EXT. FERRY DECK - NIGHT help the parser." }, 400);
    if (existingScenes.length && body.replace !== true) {
      return c.json(
        {
          error: "This world already has scenes. Replacing the breakdown removes its scenes, shots, and takes; rendered media stays in the Library.",
          code: "BREAKDOWN_REPLACE_REQUIRED",
        },
        409
      );
    }
    if (existingScenes.length) {
      for (const scene of existingScenes) removeScene(scene.id);
    }
    updateWorld(existingWorld.id, { scriptText: script });
    const now = new Date().toISOString();
    const baseSceneOrder = 0;
    breakdown.scenes.forEach((bScene, sceneIndex) => {
      const createdScene: Scene = addScene({
        id: uid("scn"),
        worldId: existingWorld.id,
        title: bScene.title,
        slugline: bScene.slugline,
        summary: bScene.summary,
        palette: [],
        light: "",
        order: baseSceneOrder + sceneIndex,
        createdAt: now,
        updatedAt: now,
      });
      bScene.shots.forEach((bShot, shotIndex) => {
        let speakerId: string | undefined;
        const entityIds: string[] = [];
        if (bShot.speakerName) {
          let speaker = listEntities(existingWorld.id).find(
            (e) => e.kind === "character" && e.name.toLowerCase() === bShot.speakerName.toLowerCase()
          );
          if (!speaker) {
            speaker = addEntity({
              id: uid("ent"),
              worldId: existingWorld.id,
              kind: "character",
              name: bShot.speakerName,
              description: "",
              wardrobe: "",
              negative: "",
              canonicalMediaIds: [],
              palette: [],
              version: 1,
              createdAt: now,
              updatedAt: now,
            });
          }
          speakerId = speaker.id;
          entityIds.push(speaker.id);
        }
        addShot({
          id: uid("sht"),
          worldId: existingWorld.id,
          sceneId: createdScene.id,
          title: bShot.title,
          action: bShot.action,
          dialogue: bShot.dialogue,
          speakerEntityId: speakerId,
          framing: bShot.framing,
          lens: "",
          cameraMove: "",
          light: "",
          emotion: "",
          screenDirection: "",
          durationSeconds: bShot.durationSeconds,
          entityIds,
          order: shotIndex,
          mode: "video",
          modelId: "wan3.0-video",
          status: "draft",
          takes: [],
          audioMediaIds: [],
          createdAt: now,
          updatedAt: now,
        });
      });
    });
    emit({ type: "film" });
    return c.json({ ...filmState(existingWorld.id), breakdownScenes: breakdown.scenes.length });
  });

  app.post("/api/film/worlds/:id/entities", async (c) => {
    const owner = getWorld(c.req.param("id"));
    if (!owner) return c.notFound();
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kindRaw = textField(body.kind);
    const kind = kindRaw === "location" || kindRaw === "prop" ? kindRaw : "character";
    const canonicalMediaIds = stringsField(body.canonicalMediaIds);
    if (body.canonicalMediaIds !== undefined) {
      if (!Array.isArray(body.canonicalMediaIds) || body.canonicalMediaIds.some((value) => typeof value !== "string")) {
        return c.json({ error: "Canonical media must be a list of media IDs." }, 400);
      }
      if (canonicalMediaIds.some((id) => !getMedia(id))) {
        return c.json({ error: "A canonical media file is missing from the library." }, 400);
      }
    }
    if (body.palette !== undefined && (!Array.isArray(body.palette) || body.palette.some((value) => typeof value !== "string"))) {
      return c.json({ error: "Palette must be a list of colours." }, 400);
    }
    const now = new Date().toISOString();
    const entity: Entity = addEntity({
      id: uid("ent"),
      worldId: owner.id,
      kind,
      name: textField(body.name).trim() || "Unnamed",
      description: textField(body.description),
      wardrobe: textField(body.wardrobe),
      voiceId: textField(body.voiceId) || undefined,
      negative: textField(body.negative),
      canonicalMediaIds,
      palette: normalizePalette(stringsField(body.palette)),
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    emit({ type: "film" });
    return c.json({ entity });
  });

  app.patch("/api/film/entities/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Entity patch must be an object." }, 400);
    }
    const patch = pickFields<Entity>(body, ["kind", "name", "description", "wardrobe", "voiceId", "negative", "canonicalMediaIds", "palette"]);
    if (patch.kind && !["character", "location", "prop"].includes(patch.kind)) {
      return c.json({ error: "Entity kind must be character, location, or prop." }, 400);
    }
    for (const key of ["name", "description", "wardrobe", "voiceId", "negative"] as const) {
      if (key in patch && typeof patch[key] !== "string") {
        return c.json({ error: `${key} must be text.` }, 400);
      }
    }
    if (patch.palette) {
      if (!Array.isArray(patch.palette) || patch.palette.some((value) => typeof value !== "string")) {
        return c.json({ error: "Palette must be a list of colours." }, 400);
      }
      patch.palette = normalizePalette(patch.palette);
    }
    if (patch.canonicalMediaIds) {
      if (!Array.isArray(patch.canonicalMediaIds) || patch.canonicalMediaIds.some((value) => typeof value !== "string")) {
        return c.json({ error: "Canonical media must be a list of media IDs." }, 400);
      }
      const ids = [...new Set(patch.canonicalMediaIds)];
      const missing = ids.find((id) => !getMedia(id));
      if (missing) return c.json({ error: "A canonical media file is missing from the library." }, 400);
      patch.canonicalMediaIds = ids;
    }
    const entity = updateEntity(c.req.param("id"), patch);
    if (!entity) return c.notFound();
    emit({ type: "film" });
    return c.json({ entity });
  });

  app.delete("/api/film/entities/:id", (c) => {
    if (!removeEntity(c.req.param("id"))) return c.notFound();
    emit({ type: "film" });
    return c.json({ ok: true });
  });

  app.post("/api/film/worlds/:id/scenes", async (c) => {
    const owner = getWorld(c.req.param("id"));
    if (!owner) return c.notFound();
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    const createdScene: Scene = addScene({
      id: uid("scn"),
      worldId: owner.id,
      title: textField(body.title).trim() || "New scene",
      slugline: textField(body.slugline),
      summary: textField(body.summary),
      palette: normalizePalette(stringsField(body.palette)),
      light: textField(body.light),
      order: numberField(body.order, listScenes(owner.id).length),
      createdAt: now,
      updatedAt: now,
    });
    emit({ type: "film" });
    return c.json({ scene: createdScene });
  });

  app.patch("/api/film/scenes/:id", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Scene patch must be an object." }, 400);
    }
    const patch = pickFields<Scene>(body, ["title", "slugline", "summary", "palette", "light", "order"]);
    for (const key of ["title", "slugline", "summary", "light"] as const) {
      if (key in patch && typeof patch[key] !== "string") {
        return c.json({ error: `${key} must be text.` }, 400);
      }
    }
    if ("order" in patch && (typeof patch.order !== "number" || !Number.isFinite(patch.order))) {
      return c.json({ error: "Scene order must be a number." }, 400);
    }
    if (patch.palette) {
      if (!Array.isArray(patch.palette) || patch.palette.some((value) => typeof value !== "string")) {
        return c.json({ error: "Palette must be a list of colours." }, 400);
      }
      patch.palette = normalizePalette(patch.palette);
    }
    const updatedScene = updateScene(c.req.param("id"), patch);
    if (!updatedScene) return c.notFound();
    emit({ type: "film" });
    return c.json({ scene: updatedScene });
  });

  app.delete("/api/film/scenes/:id", (c) => {
    if (!removeScene(c.req.param("id"))) return c.notFound();
    emit({ type: "film" });
    return c.json({ ok: true });
  });

  app.post("/api/film/scenes/:id/shots", async (c) => {
    const parentScene = getScene(c.req.param("id"));
    if (!parentScene) return c.notFound();
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const cleaned = cleanShotPatch(body);
    if (cleaned.error) return c.json({ error: cleaned.error }, 400);
    if (cleaned.patch.sceneId && cleaned.patch.sceneId !== parentScene.id) {
      return c.json({ error: "A new shot must be created in its parent scene." }, 400);
    }
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
    const createdShot = createShotRecord(parentScene, cleaned.patch, "New shot");
    emit({ type: "film" });
    return c.json({ shot: createdShot });
  });

  app.patch("/api/film/shots/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const current = getShot(c.req.param("id"));
    if (!current) return c.notFound();
    const cleaned = cleanShotPatch(body);
    if (cleaned.error) return c.json({ error: cleaned.error }, 400);
    const problem = shotPatchProblem(current, cleaned.patch);
    if (problem) return c.json({ error: problem }, 400);
    const updatedShot = updateShot(current.id, cleaned.patch);
    emit({ type: "film" });
    return c.json({ shot: updatedShot });
  });

  app.delete("/api/film/shots/:id", (c) => {
    if (!removeShot(c.req.param("id"))) return c.notFound();
    emit({ type: "film" });
    return c.json({ ok: true });
  });
}
