import { defaultSpec, estimateUnits, expandVariables, getModel, needsConfirm, promptVariables, sizeFor, withLockedSeed } from "@core";
import type { Job, JobSpec, RefRole } from "@core";
import type { RefItem } from "./types";
import { api } from "../api";
import { engineCommand } from "../tauri";
import type { Store } from "./types";
import { askConfirmDialog, confirmQueue, fixJob, fixMedia, pruneRefs, remapForRemoval, upsertJob, withCapRetry, type StoreSet } from "./helpers";

let lastSubmitAt = 0;
let lastSubmitFingerprint = "";

export function createGenerationSlice(set: StoreSet, get: () => Store): Pick<Store, "setView" | "setMode" | "patchSpec" | "switchModel" | "addRefs" | "removeRef" | "setRefRole" | "moveRef" | "clearRefs" | "generate" | "confirmGenerate" | "setVar" | "retryJob" | "importPaths" | "resumeEngine" | "restartEngine" | "cancelJob" | "setActiveJob" | "setActiveAsset" | "replayJob" | "setInspectorTab" | "toggleInspector"> {
  return {
  setView: (view) => set({ view }),

  setMode: (mode) => {
    localStorage.setItem("qstudio.mode", mode);
    set({ activeMode: mode });
  },

  patchSpec: (patch) => {
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    const spec = { ...draft.spec, ...patch };
    if (patch.aspect || patch.tier) {
      const model = getModel(spec.modelId);
      if (model.sizes) spec.size = sizeFor(model, spec.aspect, spec.tier);
    }
    set({ drafts: { ...get().drafts, [mode]: { ...draft, spec } } });
  },

  switchModel: (id) => {
    const model = getModel(id);
    const draft = get().drafts[model.mode];
    const base = defaultSpec(model);
    const spec: JobSpec = {
      ...base,
      prompt: draft.spec.prompt,
      negativePrompt: draft.spec.negativePrompt,
      n: Math.min(Math.max(1, draft.spec.n), model.n.max),
      duration: model.duration
        ? Math.min(Math.max(model.duration.min, draft.spec.duration), model.duration.max)
        : draft.spec.duration,
    };
    if (model.mode === "image") {
      spec.aspect = draft.spec.aspect;
      const tiers = model.sizes?.tiers ?? [];
      spec.tier = tiers.includes(draft.spec.tier) ? draft.spec.tier : tiers[0] ?? spec.tier;
      spec.size = sizeFor(model, spec.aspect, spec.tier);
    }
    if (model.mode === "video") {
      spec.resolution = (model.resolutions ?? []).includes(draft.spec.resolution)
        ? draft.spec.resolution
        : model.defaultResolution ?? spec.resolution;
      spec.ratio = (model.ratios ?? []).includes(draft.spec.ratio)
        ? draft.spec.ratio
        : model.defaultRatio ?? spec.ratio;
    }
    if (model.mode === "audio") {
      spec.voice = model.voices?.some((v) => v.id === draft.spec.voice)
        ? draft.spec.voice
        : model.voices?.[0]?.id;
      spec.format = draft.spec.format;
      spec.sampleRate = draft.spec.sampleRate;
      spec.instruction = draft.spec.instruction;
    }
    const refs = pruneRefs(draft.refs, model);
    set({
      activeMode: model.mode,
      drafts: { ...get().drafts, [model.mode]: { spec, refs, appliedPromptId: undefined } },
    });
    localStorage.setItem("qstudio.mode", model.mode);
  },

  addRefs: (rawAssets, explicitRole) => {
    const assets = rawAssets.map(fixMedia);
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    const model = getModel(draft.spec.modelId);
    const refs = draft.refs.slice();
    let added = 0;
    const counts = () => {
      const c: Record<string, number> = {};
      for (const r of refs) c[r.role] = (c[r.role] ?? 0) + 1;
      return c;
    };
    for (const asset of assets) {
      if (refs.some((r) => r.mediaId === asset.id)) continue;
      let role: RefRole | null = explicitRole ?? null;
      if (!role) {
        if (model.family === "happyhorse-i2v" && !refs.some((r) => r.role === "first_frame")) {
          role = "first_frame";
        } else if (asset.kind === "audio") {
          role = "audio";
        } else if (asset.kind === "video") {
          role = "video";
        } else {
          role = "reference";
        }
      }
      if (role === "audio" && asset.kind !== "audio") {
        get().toast("That role needs an audio file.", "err");
        continue;
      }
      if (role === "video" && asset.kind !== "video") {
        get().toast("That role needs a video file.", "err");
        continue;
      }
      if ((role === "reference" || role === "first_frame" || role === "last_frame") && asset.kind !== "image") {
        get().toast("Image roles need an image.", "err");
        continue;
      }
      const max =
        role === "reference" ? model.refs.reference : role === "audio" ? model.refs.audio : role === "video" ? model.refs.video : 1;
      if ((counts()[role] ?? 0) >= max) {
        get().toast(
          role === "reference"
            ? `${model.label} accepts ${max} reference image${max === 1 ? "" : "s"}.`
            : `This model accepts ${max} ${role.replace("_", " ")} file${max === 1 ? "" : "s"}.`,
          "err"
        );
        continue;
      }
      if (model.refs.exclusiveFrames && (role === "first_frame" || role === "last_frame")) {
        if (refs.some((r) => r.role === "reference")) {
          get().toast("Wan 3.0 can't mix first/last frames with reference images.", "err");
          continue;
        }
      }
      if (model.refs.exclusiveFrames && role === "reference" && refs.some((r) => r.role === "first_frame" || r.role === "last_frame")) {
        get().toast("Remove the first/last frame before adding references.", "err");
        continue;
      }
      refs.push({
        mediaId: asset.id,
        role,
        name: asset.name,
        mime: asset.mime,
        kind: asset.kind,
        thumb: asset.thumb,
        width: asset.width,
        height: asset.height,
      });
      added++;
    }
    if (added) {
      set({ drafts: { ...get().drafts, [mode]: { ...draft, refs } } });
      get().toast(`${added} reference${added > 1 ? "s" : ""} added.`, "ok");
    }
  },

  removeRef: (index) => {
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    const before = draft.refs;
    const after = before.filter((_, i) => i !== index);
    const prompt = remapForRemoval(draft.spec.prompt, before, after);
    set({
      drafts: {
        ...get().drafts,
        [mode]: { ...draft, refs: after, spec: { ...draft.spec, prompt } },
      },
    });
  },

  setRefRole: (index, role) => {
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    const model = getModel(draft.spec.modelId);
    const refs = draft.refs.slice();
    const ref = refs[index];
    if (!ref) return;
    if (role === "audio" && ref.kind !== "audio") return get().toast("That role needs an audio file.", "err");
    if (role === "video" && ref.kind !== "video") return get().toast("That role needs a video file.", "err");
    if ((role === "reference" || role === "first_frame" || role === "last_frame") && ref.kind !== "image")
      return get().toast("That role needs an image.", "err");
    const counts: Record<string, number> = {};
    for (const r of refs) if (r !== ref) counts[r.role] = (counts[r.role] ?? 0) + 1;
    const max =
      role === "reference" ? model.refs.reference : role === "audio" ? model.refs.audio : role === "video" ? model.refs.video : 1;
    if ((counts[role] ?? 0) >= max) return get().toast("That role is already full.", "err");
    refs[index] = { ...ref, role };
    set({ drafts: { ...get().drafts, [mode]: { ...draft, refs } } });
  },

  moveRef: (from, to) => {
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    if (from === to) return;
    const refs = draft.refs.slice();
    const [item] = refs.splice(from, 1);
    refs.splice(to, 0, item);
    const prompt = remapForRemoval(draft.spec.prompt, draft.refs, refs);
    set({
      drafts: {
        ...get().drafts,
        [mode]: { ...draft, refs, spec: { ...draft.spec, prompt } },
      },
    });
  },

  clearRefs: () => {
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    set({
      drafts: {
        ...get().drafts,
        [mode]: { ...draft, refs: [], spec: { ...draft.spec, prompt: remapForRemoval(draft.spec.prompt, draft.refs, []) } },
      },
    });
  },

  generate: async () => {
    if (get().submitting) return;
    if (get().engine === "asleep") {
      return get().toast("The engine is asleep. Wake it from the banner or the tray.", "err");
    }
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    const model = getModel(draft.spec.modelId);
    if (!draft.spec.prompt.trim() && !draft.refs.length) {
      return get().toast("Write a prompt, add a reference, or both.", "err");
    }
    for (const req of model.refs.required ?? []) {
      if (!draft.refs.some((r) => r.role === req)) {
        return get().toast(`${model.label} needs a ${req.replace("_", " ")}.`, "err");
      }
    }
    const vars = get().varsByMode[mode];
    const missing = promptVariables(draft.spec.prompt).filter((name) => !vars[name]?.trim());
    if (missing.length) {
      return get().toast(`Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} under the prompt first.`, "err");
    }
    const rawSpec: JobSpec = {
      ...draft.spec,
      prompt: expandVariables(draft.spec.prompt, vars),
      refs: draft.refs.map((r) => ({
        mediaId: r.mediaId,
        role: r.role,
      })),
    };
    const spec = withLockedSeed(rawSpec, get().seedLocked, () => Math.floor(Math.random() * 2 ** 31));
    if (spec.seed != null && spec.seed !== draft.spec.seed) {
      set({
        drafts: {
          ...get().drafts,
          [mode]: { ...get().drafts[mode], spec: { ...get().drafts[mode].spec, seed: spec.seed } },
        },
      });
    }
    const fingerprint = JSON.stringify(spec);
    if (fingerprint === lastSubmitFingerprint && Date.now() - lastSubmitAt < 3000) {
      return get().toast("That exact job was just submitted.", "err");
    }
    const reason = needsConfirm(spec, model);
    const units = estimateUnits(spec, model);
    if (reason) {
      const ok = await askConfirmDialog(
        set,
        "Expensive job",
        `${reason} (~${units} units, ${get().usage.label}). Generate anyway?`
      );
      if (!ok) return;
    }
    set({ submitting: true });
    lastSubmitFingerprint = fingerprint;
    lastSubmitAt = Date.now();
    try {
      const result = await withCapRetry(
        set,
        (force) => api.createJob(spec, draft.appliedPromptId, force),
        "Submit"
      );
      if (!result) return;
      const job = fixJob(result.job);
      set({
        jobs: upsertJob(get().jobs, job),
        activeJobId: job.id,
        activeAssetIndex: 0,
        inspectorTab: "queue",
        view: "studio",
      });
      get().toast("Queued.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    } finally {
      set({ submitting: false });
    }
  },

  confirmGenerate: (ok) => {
    const current = confirmQueue.shift();
    const next = confirmQueue[0];
    set({
      pendingConfirm: next
        ? {
            title: next.title,
            body: next.body,
            confirmLabel: next.confirmLabel,
            cancelLabel: next.cancelLabel,
          }
        : null,
    });
    current?.resolve(ok);
  },

  setVar: (name, value) => {
    const mode = get().activeMode;
    set({ varsByMode: { ...get().varsByMode, [mode]: { ...get().varsByMode[mode], [name]: value } } });
  },

  retryJob: async (id) => {
    try {
      const result = await withCapRetry(set, (force) => api.retryJob(id, force), "Retry");
      if (!result) return;
      const fixed = fixJob(result.job);
      set({ jobs: upsertJob(get().jobs, fixed), activeJobId: fixed.id, activeAssetIndex: 0 });
      get().toast("Queued again.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  importPaths: async (paths) => {
    try {
      const { media } = await api.importPaths(paths);
      const fixed = media.map(fixMedia);
      const known = new Set(get().media.map((m) => m.id));
      set({ media: [...fixed.filter((m) => !known.has(m.id)), ...get().media] });
      get().addRefs(fixed);
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  resumeEngine: async () => {
    set({ engine: "reconnecting" });
    await engineCommand("start_engine");
    await get().load();
  },

  restartEngine: async () => {
    set({ engine: "reconnecting" });
    await engineCommand("restart_engine");
    await get().load();
  },

  cancelJob: async (id) => {
    try {
      await api.cancelJob(id);
      get().toast("Canceled.");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  setActiveJob: (id) => set({ activeJobId: id, activeAssetIndex: 0 }),
  setActiveAsset: (i) => set({ activeAssetIndex: i }),
  replayJob: (job) => {
    const refs = job.spec.refs
      .map((r) => {
        const m = get().media.find((x) => x.id === r.mediaId);
        if (!m) return null;
        return {
          mediaId: m.id,
          role: r.role,
          name: m.name,
          mime: m.mime,
          kind: m.kind,
          thumb: m.thumb,
          width: m.width,
          height: m.height,
        } as RefItem;
      })
      .filter(Boolean) as RefItem[];
    set({
      activeMode: job.mode,
      view: "studio",
      activeJobId: job.id,
      drafts: {
        ...get().drafts,
        [job.mode]: {
          spec: { ...job.spec, prompt: job.prompt, refs: [] },
          refs,
          appliedPromptId: undefined,
        },
      },
    });
    localStorage.setItem("qstudio.mode", job.mode);
    get().toast("Job restored to the composer.", "ok");
  },
  setInspectorTab: (t) => set({ inspectorTab: t, inspectorOpen: true }),
  toggleInspector: () => set({ inspectorOpen: !get().inspectorOpen }),
  };
}
