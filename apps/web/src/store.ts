import { create } from "zustand";
import { MODELS } from "@core";
import type { Job, LocalExport } from "@core";
import { api, currentEngine, eventsUrl, initEngine, setEngine, type ApiState } from "./api";
import { isTauri, notify, onEngineState } from "./tauri";
import type { Store } from "./store/types";
import { applyTheme, draftFor, fixJob, fixMedia, modelForMode, persistDrafts, restoreDrafts, upsertExport, upsertJob } from "./store/helpers";
import { createGenerationSlice } from "./store/generation";
import { createLibrarySlice } from "./store/library";
import { createFilmSlice } from "./store/film";

export type { Draft, EngineStatus, PickerRequest, RefItem, Toast, View } from "./store/types";

let sse: EventSource | null = null;
let sseTimer: ReturnType<typeof setTimeout> | null = null;
let sseBackoff = 1000;
let engineWatchStarted = false;
let eventInstance = "";
let eventRevision = -1;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;

function acceptEventRevision(instanceId: string, revision: number): boolean {
  if (!instanceId || !Number.isFinite(revision)) return true;
  if (eventInstance !== instanceId) {
    eventInstance = instanceId;
    eventRevision = revision;
    return true;
  }
  if (revision < eventRevision) return false;
  eventRevision = revision;
  return true;
}

function scheduleRefresh(run: () => Promise<void>) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void run().catch(() => {});
  }, 100);
}

export const useApp = create<Store>((set, get) => ({
  ready: false,
  engine: "online",
  usage: { monthUnits: 0, capUnits: 0, label: "relative estimate, not Token Plan billing" },
  tools: { ffmpeg: null, ffprobe: null, sips: false },
  integrity: { warnings: [], orphanedTakes: 0, missingTakeMedia: 0 },
  submitting: false,
  seedLocked: localStorage.getItem("qstudio.seedLocked") === "1",
  pendingNarrationJobId: null,
  pendingConfirm: null,
  varsByMode: { image: {}, video: {}, audio: {} },
  settings: {
    theme: "dark",
    outputRoot: "",
    demoMode: false,
    baseUrl: "",
    profile: "token-plan",
    region: "singapore",
    referenceTransport: "auto",
    concurrencyImages: 2,
    concurrencyVideo: 1,
  },
  key: { present: false, prefix: "", source: "none" },
  models: MODELS,
  jobs: [],
  media: [],
  prompts: [],
  worlds: [],
  entities: [],
  scenes: [],
  shots: [],
  exports: [],
  activeWorldId: localStorage.getItem("qstudio.worldId"),
  activeShotId: null,
  pendingFilmVoice: null,
  baseUrl: "",
  outputRoot: "",
  stats: { media: 0, jobs: 0, prompts: 0, worlds: 0, shots: 0 },

  view: "studio",
  activeMode: (() => {
    const saved = localStorage.getItem("qstudio.mode");
    return saved === "image" || saved === "video" || saved === "audio" ? saved : "image";
  })(),
  drafts: {
    image: draftFor(modelForMode("image")),
    video: draftFor(modelForMode("video")),
    audio: draftFor(modelForMode("audio")),
  },
  activeJobId: null,
  activeAssetIndex: 0,
  inspectorTab: "queue",
  inspectorOpen: window.innerWidth >= 1280,

  paletteOpen: false,
  savePromptOpen: false,
  onboardingOpen: false,
  picker: {
    open: false,
    mode: "append",
    openPicker: (mode, opts) =>
      set({
        picker: {
          open: true,
          mode: mode === "prompt" ? "prompt" : mode,
          pendingPrompt: opts?.prompt,
          role: opts?.role,
          openPicker: get().picker.openPicker,
          closePicker: get().picker.closePicker,
        },
      }),
    closePicker: () =>
      set({
        picker: {
          ...get().picker,
          open: false,
          pendingPrompt: undefined,
          role: undefined,
        },
      }),
  },

  toasts: [],

  load: async () => {
    const connectSse = () => {
      if (sse) sse.close();
      sse = new EventSource(eventsUrl());
      sse.addEventListener("snapshot", (e) => {
        try {
          const event = JSON.parse((e as MessageEvent).data) as {
            jobs?: Job[];
            revision?: number;
            instanceId?: string;
          };
          if (!event.jobs || !acceptEventRevision(event.instanceId ?? "", Number(event.revision))) return;
          if (eventInstance && event.instanceId !== eventInstance) return;
          set({ jobs: event.jobs.map(fixJob) });
        } catch {
        }
      });
      sse.addEventListener("update", (e) => {
        try {
          const ev = JSON.parse((e as MessageEvent).data) as {
            type?: string;
            job?: Job;
            localExport?: LocalExport;
            revision?: number;
            instanceId?: string;
          };
          if (!acceptEventRevision(ev.instanceId ?? "", Number(ev.revision))) return;
          if (ev.localExport) {
            const prev = get().exports.find((item) => item.id === ev.localExport!.id);
            const next = ev.localExport;
            set({ exports: upsertExport(get().exports, next) });
            if (next.status === "succeeded" && prev?.status !== "succeeded") {
              scheduleRefresh(get().refresh);
              get().toast("Film preview saved to the Library.", "ok");
            }
            if (next.status === "failed" && prev?.status !== "failed") {
              get().toast(next.error ?? "Film preview failed.", "err");
            }
          }
          if (ev.job) {
            const job = fixJob(ev.job);
            const prev = get().jobs.find((j: Job) => j.id === job.id);
            set({ jobs: upsertJob(get().jobs, job) });
            if (job.status === "succeeded" && prev?.status !== "succeeded") {
              void get().refresh();
              if (get().pendingNarrationJobId === job.id) {
                set({ pendingNarrationJobId: null });
                void get()
                  .refresh()
                  .then(() => {
                    const asset = job.assets[0]
                      ? get().media.find((m) => m.id === job.assets[0].id)
                      : undefined;
                    if (asset) {
                      if (get().activeMode !== "video") get().setMode("video");
                      get().addRefs([asset], "audio");
                      get().toast("Narration attached as the audio reference.", "ok");
                    }
                  })
                  .catch(() => {});
              }
              const ranMs =
                job.finishedAt && job.startedAt
                  ? Date.parse(job.finishedAt) - Date.parse(job.startedAt)
                  : 0;
              if (ranMs > 30_000) void notify("Q Studio", `${job.mode} finished: ${job.prompt.slice(0, 60)}`);
            }
            if (job.status === "failed" && prev?.status !== "failed") void get().refresh();
            const pendingVoice = get().pendingFilmVoice;
            if (pendingVoice && pendingVoice.jobId === job.id && job.status === "succeeded") {
              set({ pendingFilmVoice: null });
              void get()
                .refresh()
                .then(async () => {
                  const assetId = job.assets[0]?.id;
                  const target = get().shots.find((s) => s.id === pendingVoice.shotId);
                  if (assetId && target && !target.audioMediaIds.includes(assetId)) {
                    await get().patchShot(target.id, {
                      audioMediaIds: [...target.audioMediaIds, assetId],
                    });
                    get().toast("Voiced line attached to the shot.", "ok");
                  }
                })
                .catch(() => {});
            }
          }
          if (ev.type === "media" || ev.type === "film") scheduleRefresh(get().refresh);
        } catch {
        }
      });
      sse.onopen = () => {
        sseBackoff = 1000;
        if (get().engine !== "asleep") set({ engine: "online" });
        scheduleRefresh(get().refresh);
      };
      sse.onerror = () => {
        if (sse) sse.close();
        sse = null;
        if (get().engine !== "asleep") set({ engine: "reconnecting" });
        if (sseTimer) clearTimeout(sseTimer);
        sseTimer = setTimeout(() => {
          void (async () => {
            await initEngine();
            if (isTauri() && !currentEngine().running) {
              set({ engine: "asleep" });
              return;
            }
            connectSse();
            void get().refresh().catch(() => {});
          })();
        }, sseBackoff);
        sseBackoff = Math.min(sseBackoff * 2, 30_000);
      };
    };
    try {
      const info = await initEngine();
      if (!engineWatchStarted) {
        engineWatchStarted = true;
        void onEngineState((next) => {
          setEngine(next);
          if (!next.running) {
            set({ engine: "asleep" });
            if (sse) sse.close();
            sse = null;
            return;
          }
          set({ engine: "reconnecting" });
          connectSse();
          void get().refresh().catch(() => {});
        });
      }
      if (isTauri() && !info.running) {
        set({ ready: true, engine: "asleep" });
        return;
      }
      const state = await api.state();
      acceptEventRevision(state.engineInstance, state.revision);
      applyTheme(state.settings.theme);
      const fixedMedia = state.media.map(fixMedia);
      const restored = restoreDrafts(fixedMedia);
      const savedWorld = get().activeWorldId;
      const activeWorldId =
        savedWorld && state.worlds.some((w) => w.id === savedWorld)
          ? savedWorld
          : state.worlds[0]?.id ?? null;
      set({
        ...state,
        activeWorldId,
        jobs: state.jobs.map(fixJob),
        media: fixedMedia,
        drafts: { ...get().drafts, ...restored.drafts },
        varsByMode: restored.varsByMode ?? get().varsByMode,
        ready: true,
        engine: "online",
        onboardingOpen: !state.key.present && !localStorage.getItem("qstudio.onboarded"),
      });
      connectSse();
    } catch (err) {
      console.error(err);
      set({ ready: true, engine: "reconnecting" });
      get().toast("Could not reach the Q Studio engine. Retrying…", "err");
      if (sseTimer) clearTimeout(sseTimer);
      sseTimer = setTimeout(() => void get().load(), 3000);
    }
  },

  refresh: async () => {
    if (refreshInFlight) {
      refreshQueued = true;
      return refreshInFlight;
    }
    const run = async () => {
      const state: ApiState = await api.state();
      if (eventInstance !== state.engineInstance) {
        eventInstance = state.engineInstance;
        eventRevision = -1;
      }
      if (state.revision < eventRevision) return;
      eventRevision = state.revision;
      set({
        settings: state.settings,
        key: state.key,
        jobs: state.jobs.map(fixJob),
        media: state.media.map(fixMedia),
        prompts: state.prompts,
        worlds: state.worlds,
        entities: state.entities,
        scenes: state.scenes,
        shots: state.shots,
        exports: state.exports,
        baseUrl: state.baseUrl,
        outputRoot: state.outputRoot,
        stats: state.stats,
        usage: state.usage,
        tools: state.tools,
        integrity: state.integrity,
      });
    };
    refreshInFlight = run();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
      if (refreshQueued) {
        refreshQueued = false;
        scheduleRefresh(get().refresh);
      }
    }
  },

  ...createGenerationSlice(set, get),
  ...createLibrarySlice(set, get),
  ...createFilmSlice(set, get),
}));

let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
useApp.subscribe((state, prev) => {
  if (state.drafts === prev.drafts && state.varsByMode === prev.varsByMode) return;
  if (draftSaveTimer) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    const current = useApp.getState();
    persistDrafts(current.drafts, current.varsByMode);
  }, 400);
});

if (import.meta.env.DEV) {
  (window as unknown as { __qstudio: typeof useApp }).__qstudio = useApp;
}
