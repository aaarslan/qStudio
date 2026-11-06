import type { PatchSuggestion, Scene, Shot, World } from "@core";
import { api } from "../api";
import type { Store } from "./types";
import { askConfirmDialog, fixJob, upsertExport, upsertJob, withCapRetry, type StoreSet } from "./helpers";

const renderInFlight = new Set<string>();
const voiceInFlight = new Set<string>();
const previewInFlight = new Set<string>();

export function createFilmSlice(set: StoreSet, get: () => Store): Pick<Store, "setActiveWorld" | "setActiveShot" | "openFilmShot" | "createWorld" | "patchWorld" | "deleteWorld" | "breakdownWorld" | "createEntity" | "patchEntity" | "deleteEntity" | "createScene" | "patchScene" | "deleteScene" | "createShot" | "patchShot" | "deleteShot" | "renderShot" | "verdictTake" | "checkDrift" | "voiceShot" | "previewFilm" | "cancelExport" | "applySuggestion"> {
  return {
  setActiveWorld: (id) => {
    if (id) localStorage.setItem("qstudio.worldId", id);
    else localStorage.removeItem("qstudio.worldId");
    set({ activeWorldId: id, activeShotId: null });
  },

  setActiveShot: (id) => set({ activeShotId: id }),

  openFilmShot: (worldId, shotId) => {
    localStorage.setItem("qstudio.worldId", worldId);
    set({ activeWorldId: worldId, activeShotId: shotId, view: "film" });
  },

  createWorld: async (title) => {
    try {
      const res = await api.createWorld({ title: title.trim() || "Untitled film" });
      await get().refresh();
      get().setActiveWorld(res.world.id);
      get().toast(`World “${res.world.title}” created.`, "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  patchWorld: async (id, patch) => {
    try {
      const { world } = await api.patchWorld(id, patch);
      set({ worlds: get().worlds.map((w) => (w.id === id ? world : w)) });
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  deleteWorld: async (id) => {
    const target = get().worlds.find((world) => world.id === id);
    const ok = await askConfirmDialog(
      set,
      "Delete this world?",
      `“${target?.title ?? "This world"}”, its Bible, scenes, shots and takes will be removed. Rendered media stays in the library.`
    );
    if (!ok) return;
    try {
      await api.deleteWorld(id);
      await get().refresh();
      if (get().activeWorldId === id) get().setActiveWorld(get().worlds[0]?.id ?? null);
      get().toast("World deleted. Its rendered media stays in the library.");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  breakdownWorld: async (worldId, scriptText) => {
    try {
      try {
        await api.breakdown(worldId, scriptText);
      } catch (err) {
        if ((err as Error & { code?: string }).code !== "BREAKDOWN_REPLACE_REQUIRED") throw err;
        const ok = await askConfirmDialog(
          set,
          "Replace this breakdown?",
          "Existing scenes, shots, and takes will be removed from this world. Rendered media stays in the Library.",
          "Replace scenes",
          "Keep existing"
        );
        if (!ok) return;
        await api.breakdown(worldId, scriptText, true);
      }
      await get().refresh();
      get().toast("Script broken into scenes and shots. Nothing was rendered.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  createEntity: async (worldId, body) => {
    try {
      await api.createEntity(worldId, body);
      await get().refresh();
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  patchEntity: async (id, patch) => {
    try {
      const { entity } = await api.patchEntity(id, patch);
      set({ entities: get().entities.map((e) => (e.id === id ? entity : e)) });
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  deleteEntity: async (id) => {
    const target = get().entities.find((entity) => entity.id === id);
    const ok = await askConfirmDialog(
      set,
      "Remove this Bible entry?",
      `“${target?.name ?? "This entry"}” will be removed from every shot's cast and speaker fields.`
    );
    if (!ok) return;
    try {
      await api.deleteEntity(id);
      await get().refresh();
      get().toast("Removed from the World Bible.");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  createScene: async (worldId, body) => {
    try {
      await api.createScene(worldId, body);
      await get().refresh();
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  patchScene: async (id, patch) => {
    try {
      const { scene } = await api.patchScene(id, patch);
      set({ scenes: get().scenes.map((s) => (s.id === id ? scene : s)) });
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  deleteScene: async (id) => {
    const target = get().scenes.find((scene) => scene.id === id);
    const ok = await askConfirmDialog(
      set,
      "Delete this scene?",
      `“${target?.title ?? "This scene"}” and all ${get().shots.filter((shot) => shot.sceneId === id).length} shot(s) inside it will be removed. Rendered media stays in the library.`
    );
    if (!ok) return;
    try {
      await api.deleteScene(id);
      await get().refresh();
      get().toast("Scene and its shots deleted.");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  createShot: async (sceneId, body) => {
    try {
      const { shot } = await api.createShot(sceneId, body ?? {});
      await get().refresh();
      set({ activeShotId: shot.id });
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  patchShot: async (id, patch) => {
    try {
      const { shot } = await api.patchShot(id, patch);
      set({ shots: get().shots.map((s) => (s.id === id ? shot : s)) });
      return true;
    } catch (err) {
      get().toast((err as Error).message, "err");
      return false;
    }
  },

  deleteShot: async (id) => {
    const target = get().shots.find((shot) => shot.id === id);
    const ok = await askConfirmDialog(
      set,
      "Delete this shot?",
      `“${target?.title ?? "This shot"}”, its takes and rendered attachments will be removed from the film. Media stays in the library.`
    );
    if (!ok) return;
    try {
      await api.deleteShot(id);
      await get().refresh();
      if (get().activeShotId === id) set({ activeShotId: null });
      get().toast("Shot deleted.");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  renderShot: async (id) => {
    if (get().engine === "asleep") {
      return get().toast("The engine is asleep. Wake it from the banner or the tray.", "err");
    }
    if (renderInFlight.has(id)) return;
    const target = get().shots.find((s) => s.id === id);
    if (target?.status === "locked") {
      return get().toast("This shot is locked. Set it back to approved to render again.", "err");
    }
    renderInFlight.add(id);
    try {
      const result = await withCapRetry(set, (force) => api.renderShot(id, force), "Render");
      if (!result) return;
      set({
        jobs: upsertJob(get().jobs, fixJob(result.job)),
        shots: get().shots.map((s) => (s.id === id ? result.shot : s)),
      });
      for (const warning of result.warnings.slice(0, 2)) get().toast(warning);
      get().toast("Take queued. It lands on the shot when done.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    } finally {
      renderInFlight.delete(id);
    }
  },

  verdictTake: async (shotId, takeId, verdict) => {
    try {
      const { shot } = await api.verdictTake(shotId, takeId, verdict);
      set({ shots: get().shots.map((s) => (s.id === shotId ? shot : s)) });
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  checkDrift: async (shotId) => {
    try {
      const { shot, drift } = await api.checkDrift(shotId);
      set({ shots: get().shots.map((s) => (s.id === shotId ? shot : s)) });
      get().toast(`Drift score ${drift.score}. See the take card for detail.`, "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  voiceShot: async (shotId) => {
    if (voiceInFlight.has(shotId)) return;
    voiceInFlight.add(shotId);
    try {
      const result = await withCapRetry(set, (force) => api.voiceShot(shotId, force), "Voice the line");
      if (!result) return;
      set({
        jobs: upsertJob(get().jobs, fixJob(result.job)),
        pendingFilmVoice: { jobId: result.job.id, shotId },
      });
      get().toast("Line queued. It attaches to the shot when ready.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    } finally {
      voiceInFlight.delete(shotId);
    }
  },

  previewFilm: async (worldId) => {
    if (previewInFlight.has(worldId)) return;
    previewInFlight.add(worldId);
    try {
      const { localExport, skipped } = await api.previewFilm(worldId);
      set({ exports: upsertExport(get().exports, localExport) });
      if (skipped.length) get().toast(`Skipped shots without a usable take: ${skipped.join(", ")}`, "err");
      get().toast("Preview queued locally. This spends no credits.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    } finally {
      previewInFlight.delete(worldId);
    }
  },

  cancelExport: async (id) => {
    try {
      const { export: item } = await api.cancelExport(id);
      set({ exports: upsertExport(get().exports, item) });
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  applySuggestion: async (suggestion) => {
    try {
      const { shot } = await api.applySuggestion(suggestion);
      await get().refresh();
      set({ activeShotId: shot.id });
      get().toast("Suggestion applied. Nothing was rendered.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },
  };
}
