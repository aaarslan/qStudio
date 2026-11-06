import { MODELS, abSpecs, defaultSpec, estimateUnits, expandVariables, getModel, modelsForMode, sizeFor, splitScript, titleFromPrompt } from "@core";
import type { JobSpec, Mode } from "@core";
import type { Draft, RefItem } from "./types";
import { api } from "../api";
import type { Store } from "./types";
import { applyTheme, askConfirmDialog, fixJob, fixMedia, modelForMode, pruneRefs, upsertJob, type StoreSet } from "./helpers";

export function createLibrarySlice(set: StoreSet, get: () => Store): Pick<Store, "applyPrompt" | "savePrompt" | "deletePrompt" | "togglePromptFavorite" | "toggleMediaFavorite" | "patchMedia" | "transformMedia" | "grabFrame" | "setSeedLocked" | "editPrompt" | "narrateForVideo" | "extendClip" | "previewVoice" | "generateScriptLines" | "generateAB" | "deleteMedia" | "saveSettings" | "setTheme" | "saveKey" | "deleteKey" | "toast" | "setPalette" | "setSavePrompt" | "dismissOnboarding" | "useAsReference"> {
  return {
  applyPrompt: (p, opts) => {
    const model = getModel(p.modelId);
    const targetModel = model.mode === p.mode ? model : modelForMode(p.mode);
    const targetMode = targetModel.mode;
    const base = defaultSpec(targetModel);
    const spec: JobSpec = {
      ...base,
      ...p.params,
      mode: targetMode,
      modelId: targetModel.id,
      prompt: p.text,
      refs: [],
    };
    if (targetModel.sizes) {
      const tiers = targetModel.sizes.tiers ?? [];
      if (!tiers.includes(spec.tier)) spec.tier = tiers[0] ?? spec.tier;
      if (!spec.aspect) spec.aspect = "1:1";
      spec.size = sizeFor(targetModel, spec.aspect, spec.tier);
    }
    spec.n = Math.min(Math.max(1, spec.n || 1), targetModel.n.max);
    if (targetModel.mode === "video" && targetModel.duration) {
      spec.duration = Math.min(
        Math.max(targetModel.duration.min, spec.duration || targetModel.duration.default),
        targetModel.duration.max
      );
      if (!targetModel.resolutions?.includes(spec.resolution))
        spec.resolution = targetModel.defaultResolution ?? spec.resolution;
      if (!targetModel.ratios?.includes(spec.ratio)) spec.ratio = targetModel.defaultRatio ?? spec.ratio;
    }
    const refs = opts?.refAssets?.length
      ? []
      : opts?.keepRefs
        ? pruneRefs(get().drafts[targetMode].refs, targetModel)
        : pruneRefs(
            (p.params.refs ?? [])
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
              .filter(Boolean) as RefItem[],
            targetModel
          );
    set({
      activeMode: targetMode,
      view: "studio",
      drafts: {
        ...get().drafts,
        [targetMode]: { spec, refs, appliedPromptId: p.id },
      },
    });
    localStorage.setItem("qstudio.mode", targetMode);
    if (opts?.refAssets?.length) get().addRefs(opts.refAssets);
    get().toast(`Loaded “${p.title}”.`, "ok");
  },

  savePrompt: async (meta) => {
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    if (!draft.spec.prompt.trim()) return get().toast("Nothing to save yet.", "err");
    const { prompt, refs: _specRefs, ...rest } = draft.spec;
    const params = {
      ...rest,
      refs: draft.refs.map((r) => ({
        mediaId: r.mediaId,
        role: r.role,
      })),
    };
    const latestAsset = get().jobs.find((j) => j.mode === mode && j.assets[0])?.assets[0];
    try {
      const { prompt: saved } = await api.savePrompt({
        title: meta.title || titleFromPrompt(prompt),
        text: prompt,
        mode,
        modelId: draft.spec.modelId,
        params,
        tags: meta.tags,
        favorite: meta.favorite,
        notes: meta.notes,
        coverMediaId: latestAsset?.id,
      });
      set({ prompts: [saved, ...get().prompts], savePromptOpen: false });
      get().toast("Prompt saved.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  deletePrompt: async (id) => {
    const target = get().prompts.find((prompt) => prompt.id === id);
    const ok = await askConfirmDialog(
      set,
      "Delete this prompt?",
      `“${target?.title ?? "This prompt"}” and its version history will be removed. This cannot be undone.`
    );
    if (!ok) return;
    try {
      await api.deletePrompt(id);
      set({ prompts: get().prompts.filter((p) => p.id !== id) });
      get().toast("Prompt deleted.");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  togglePromptFavorite: async (p) => {
    const { prompt } = await api.patchPrompt(p.id, { favorite: !p.favorite });
    set({ prompts: get().prompts.map((x) => (x.id === p.id ? prompt : x)) });
  },

  toggleMediaFavorite: async (m) => {
    const { media } = await api.patchMedia(m.id, { favorite: !m.favorite });
    set({ media: get().media.map((x) => (x.id === m.id ? fixMedia(media) : x)) });
  },

  patchMedia: async (id, patch) => {
    try {
      const { media } = await api.patchMedia(id, patch);
      set({ media: get().media.map((x) => (x.id === id ? fixMedia(media) : x)) });
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  transformMedia: async (m, body) => {
    try {
      const { media } = await api.transformMedia(m.id, body);
      const fixed = fixMedia(media);
      set({ media: [fixed, ...get().media] });
      get().toast("Edited copy saved to references.", "ok");
      return fixed;
    } catch (err) {
      get().toast((err as Error).message, "err");
      return null;
    }
  },

  grabFrame: async (m, at, role) => {
    try {
      const { media } = await api.grabFrame(m.id, at);
      const fixed = fixMedia(media);
      if (!get().media.some((x) => x.id === fixed.id)) {
        set({ media: [fixed, ...get().media] });
      }
      if (role) {
        if (get().activeMode !== "video" && (role === "first_frame" || role === "last_frame")) {
          get().setMode("video");
        }
        get().addRefs([fixed], role);
        set({ view: "studio" });
      } else {
        get().toast("Frame saved to references.", "ok");
      }
      return fixed;
    } catch (err) {
      get().toast((err as Error).message, "err");
      return null;
    }
  },

  setSeedLocked: (locked) => {
    localStorage.setItem("qstudio.seedLocked", locked ? "1" : "0");
    set({ seedLocked: locked });
  },

  editPrompt: async (id, patch) => {
    try {
      const { prompt } = await api.patchPrompt(id, patch);
      set({ prompts: get().prompts.map((p) => (p.id === id ? prompt : p)) });
      return prompt;
    } catch (err) {
      get().toast((err as Error).message, "err");
      return null;
    }
  },

  narrateForVideo: async (text, voiceId) => {
    const trimmed = text.trim();
    if (!trimmed) return get().toast("Write the narration line first.", "err");
    const model = MODELS.find((m) => m.mode === "audio");
    if (!model) return;
    const spec: JobSpec = { ...defaultSpec(model), voice: voiceId, prompt: trimmed };
    try {
      const { job } = await api.createJob(spec);
      set({
        jobs: upsertJob(get().jobs, fixJob(job)),
        pendingNarrationJobId: job.id,
      });
      get().toast("Narration queued. It attaches itself when ready.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  extendClip: (m) => {
    get().setMode("video");
    const draft = get().drafts.video;
    const model = getModel(draft.spec.modelId);
    if (model.refs.video === 0) {
      get().switchModel("wan3.0-video");
    }
    const current = get().drafts.video;
    get().addRefs([m], "video");
    if (!current.spec.prompt.trim()) {
      get().patchSpec({ prompt: "Continue the previous shot seamlessly, same camera, same light. " });
    }
    set({ view: "studio" });
    get().toast("Clip loaded as the video to extend. Describe what happens next.", "ok");
  },

  previewVoice: async (voiceId) => {
    const model = MODELS.find((m) => m.mode === "audio");
    if (!model) return;
    const voice = model.voices?.find((v) => v.id === voiceId);
    const spec: JobSpec = {
      ...defaultSpec(model),
      voice: voiceId,
      prompt: `Hello, this is ${voice?.label ?? "a Q Studio voice"}. The darkroom is ready when you are.`,
    };
    try {
      const { job } = await api.createJob(spec);
      set({ jobs: upsertJob(get().jobs, fixJob(job)), activeJobId: job.id });
      get().toast("Voice preview queued as a normal TTS job.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  generateScriptLines: async () => {
    if (get().submitting) return;
    const mode = get().activeMode;
    if (mode !== "audio") return;
    const draft = get().drafts[mode];
    const lines = splitScript(draft.spec.prompt);
    if (lines.length < 2) return get().toast("Write at least two lines, one per job.", "err");
    const model = getModel(draft.spec.modelId);
    const total = lines.reduce((sum, line) => sum + estimateUnits({ ...draft.spec, prompt: line }, model), 0);
    const ok = await askConfirmDialog(
      set,
      `${lines.length} TTS jobs`,
      `Queue one job per line (${lines.length} jobs, ~${Math.round(total * 10) / 10} units total, ${get().usage.label})? They run in the capped local queue like any other click.`
    );
    if (!ok) return;
    set({ submitting: true });
    try {
      for (const line of lines) {
        const spec: JobSpec = { ...draft.spec, prompt: line, refs: [] };
        const { job } = await api.createJob(spec, draft.appliedPromptId, true);
        set({ jobs: upsertJob(get().jobs, fixJob(job)), activeJobId: job.id });
      }
      get().toast(`${lines.length} lines queued.`, "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    } finally {
      set({ submitting: false });
    }
  },

  generateAB: async () => {
    if (get().submitting) return;
    const mode = get().activeMode;
    const draft = get().drafts[mode];
    if (!draft.spec.prompt.trim()) return get().toast("Write a prompt to compare models.", "err");
    const vars = get().varsByMode[mode];
    const base: JobSpec = {
      ...draft.spec,
      prompt: expandVariables(draft.spec.prompt, vars),
      refs: draft.refs.map((r) => ({ mediaId: r.mediaId, role: r.role })),
    };
    const specs = abSpecs(base, modelsForMode(mode).map((m) => m.id)).slice(0, 3);
    if (specs.length < 2) return get().toast("This mode has only one model to run.", "err");
    const total = specs.reduce((sum, s) => sum + estimateUnits(s), 0);
    const labels = specs.map((s) => getModel(s.modelId).label).join(", ");
    const ok = await askConfirmDialog(
      set,
      "Compare models",
      `Run the same prompt once on each model (${labels}; ~${Math.round(total * 10) / 10} units total, ${get().usage.label})?`
    );
    if (!ok) return;
    set({ submitting: true });
    try {
      for (const spec of specs) {
        const { job } = await api.createJob(spec, draft.appliedPromptId, true);
        set({ jobs: upsertJob(get().jobs, fixJob(job)), activeJobId: job.id, inspectorTab: "queue", view: "studio" });
      }
      get().toast("Comparison queued. Watch the Queue tab.", "ok");
    } catch (err) {
      get().toast((err as Error).message, "err");
    } finally {
      set({ submitting: false });
    }
  },

  deleteMedia: async (m) => {
    const ok = await askConfirmDialog(
      set,
      "Delete this media?",
      `“${m.name}” will be removed from the library and disk. Items still used by the Film view are protected.`
    );
    if (!ok) return;
    try {
      await api.deleteMedia(m.id);
      set({ media: get().media.filter((x) => x.id !== m.id) });
      get().toast("Deleted.");
    } catch (err) {
      get().toast((err as Error).message, "err");
    }
  },

  saveSettings: async (patch) => {
    const previous = get().settings;
    const previousTheme = document.documentElement.dataset.theme;
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    applyTheme(next.theme);
    try {
      await api.saveSettings(patch);
      await get().refresh();
      return true;
    } catch (err) {
      set({ settings: previous });
      if (previousTheme) document.documentElement.dataset.theme = previousTheme;
      get().toast((err as Error).message, "err");
      return false;
    }
  },

  setTheme: (theme) => {
    applyTheme(theme);
    set({ settings: { ...get().settings, theme } });
    void api.saveSettings({ theme });
  },

  saveKey: async (key, remember) => {
    try {
      const res = await api.saveKey(key, remember);
      set({ key: res.key, onboardingOpen: false });
      localStorage.setItem("qstudio.onboarded", "1");
      get().toast("Key saved.", "ok");
      return true;
    } catch (err) {
      get().toast((err as Error).message, "err");
      return false;
    }
  },

  deleteKey: async () => {
    const res = await api.deleteKey();
    set({ key: res.key });
    get().toast("Key removed.");
  },

  toast: (message, kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 4600);
  },

  setPalette: (open) => set({ paletteOpen: open }),
  setSavePrompt: (open) => set({ savePromptOpen: open }),
  dismissOnboarding: () => {
    localStorage.setItem("qstudio.onboarded", "1");
    set({ onboardingOpen: false });
  },

  useAsReference: (asset, role) => {
    get().addRefs([asset], role);
    set({ view: "studio" });
  },
  };
}
