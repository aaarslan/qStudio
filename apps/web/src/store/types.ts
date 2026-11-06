import type { Entity, Job, JobSpec, KeyStatus, LocalExport, MediaAsset, Mode, ModelDef, PatchSuggestion, PromptRecord, RefRole, Scene, Settings, Shot, World } from "@core";

export type EngineStatus = "online" | "reconnecting" | "asleep";

export type View = "studio" | "film" | "prompts" | "references" | "library" | "settings";

export interface RefItem {
  mediaId: string;
  role: RefRole;
  name: string;
  mime: string;
  kind: "image" | "video" | "audio";
  thumb?: string;
  width?: number;
  height?: number;
}

export interface Draft {
  spec: JobSpec;
  refs: RefItem[];
  appliedPromptId?: string;
}

export interface Toast {
  id: string;
  message: string;
  kind: "info" | "ok" | "err";
}

export interface PickerRequest {
  open: boolean;
  openPicker: (mode: "append" | "replace" | "prompt", opts?: { prompt?: PromptRecord; role?: RefRole }) => void;
  closePicker: () => void;
  mode: "append" | "replace" | "prompt";
  role?: RefRole;
  pendingPrompt?: PromptRecord;
}

export interface Store {
  ready: boolean;
  engine: EngineStatus;
  usage: { monthUnits: number; capUnits: number; label: string };
  tools: { ffmpeg: string | null; ffprobe: string | null; sips: boolean };
  integrity: { warnings: string[]; orphanedTakes: number; missingTakeMedia: number };
  submitting: boolean;
  seedLocked: boolean;
  pendingNarrationJobId: string | null;
  pendingConfirm: { title: string; body: string; confirmLabel: string; cancelLabel: string } | null;
  varsByMode: Record<Mode, Record<string, string>>;
  settings: Settings;
  key: KeyStatus & { kind?: string };
  models: ModelDef[];
  jobs: Job[];
  media: MediaAsset[];
  prompts: PromptRecord[];
  worlds: World[];
  entities: Entity[];
  scenes: Scene[];
  shots: Shot[];
  exports: LocalExport[];
  activeWorldId: string | null;
  activeShotId: string | null;
  pendingFilmVoice: { jobId: string; shotId: string } | null;
  baseUrl: string;
  outputRoot: string;
  stats: { media: number; jobs: number; prompts: number; worlds: number; shots: number };

  view: View;
  activeMode: Mode;
  drafts: Record<Mode, Draft>;
  activeJobId: string | null;
  activeAssetIndex: number;
  inspectorTab: "queue" | "request" | "details";
  inspectorOpen: boolean;

  paletteOpen: boolean;
  savePromptOpen: boolean;
  onboardingOpen: boolean;
  picker: PickerRequest;

  toasts: Toast[];

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setView: (v: View) => void;
  setMode: (m: Mode) => void;
  patchSpec: (patch: Partial<JobSpec>) => void;
  switchModel: (id: string) => void;
  addRefs: (assets: MediaAsset[], role?: RefRole) => void;
  removeRef: (index: number) => void;
  setRefRole: (index: number, role: RefRole) => void;
  moveRef: (from: number, to: number) => void;
  clearRefs: () => void;
  generate: () => Promise<void>;
  confirmGenerate: (ok: boolean) => void;
  setVar: (name: string, value: string) => void;
  retryJob: (id: string) => Promise<void>;
  importPaths: (paths: string[]) => Promise<void>;
  resumeEngine: () => Promise<void>;
  restartEngine: () => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  setActiveJob: (id: string) => void;
  setActiveAsset: (i: number) => void;
  replayJob: (job: Job) => void;
  setInspectorTab: (t: "queue" | "request" | "details") => void;
  toggleInspector: () => void;

  applyPrompt: (p: PromptRecord, opts?: { keepRefs?: boolean; refAssets?: MediaAsset[] }) => void;
  savePrompt: (meta: { title: string; tags: string[]; favorite: boolean; notes?: string }) => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;
  togglePromptFavorite: (p: PromptRecord) => Promise<void>;

  toggleMediaFavorite: (m: MediaAsset) => Promise<void>;
  patchMedia: (id: string, patch: Partial<MediaAsset>) => Promise<void>;
  transformMedia: (
    m: MediaAsset,
    body: { preset?: string; rotate?: 0 | 90 | 180 | 270; flipH?: boolean; crop?: { x: number; y: number; w: number; h: number } }
  ) => Promise<MediaAsset | null>;
  grabFrame: (m: MediaAsset, at: number | "last", role?: RefRole) => Promise<MediaAsset | null>;
  setSeedLocked: (locked: boolean) => void;
  editPrompt: (id: string, patch: Partial<PromptRecord>) => Promise<PromptRecord | null>;
  narrateForVideo: (text: string, voiceId: string) => Promise<void>;
  extendClip: (m: MediaAsset) => void;
  previewVoice: (voiceId: string) => Promise<void>;
  generateScriptLines: () => Promise<void>;
  generateAB: () => Promise<void>;
  deleteMedia: (m: MediaAsset) => Promise<void>;

  setActiveWorld: (id: string | null) => void;
  setActiveShot: (id: string | null) => void;
  createWorld: (title: string) => Promise<void>;
  patchWorld: (id: string, patch: Partial<World>) => Promise<void>;
  deleteWorld: (id: string) => Promise<void>;
  breakdownWorld: (worldId: string, scriptText: string) => Promise<void>;
  createEntity: (worldId: string, body: Partial<Entity>) => Promise<void>;
  patchEntity: (id: string, patch: Partial<Entity>) => Promise<void>;
  deleteEntity: (id: string) => Promise<void>;
  createScene: (worldId: string, body: Partial<Scene>) => Promise<void>;
  patchScene: (id: string, patch: Partial<Scene>) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  createShot: (sceneId: string, body?: Partial<Shot>) => Promise<void>;
  patchShot: (id: string, patch: Partial<Shot>) => Promise<boolean>;
  deleteShot: (id: string) => Promise<void>;
  renderShot: (id: string) => Promise<void>;
  verdictTake: (shotId: string, takeId: string, verdict: "accepted" | "rejected" | null) => Promise<void>;
  checkDrift: (shotId: string) => Promise<void>;
  voiceShot: (shotId: string) => Promise<void>;
  previewFilm: (worldId: string) => Promise<void>;
  cancelExport: (id: string) => Promise<void>;
  applySuggestion: (suggestion: PatchSuggestion) => Promise<void>;
  openFilmShot: (worldId: string, shotId: string) => void;

  saveSettings: (patch: Partial<Settings>) => Promise<boolean>;
  setTheme: (theme: "dark" | "light") => void;
  saveKey: (key: string, remember: boolean) => Promise<boolean>;
  deleteKey: () => Promise<void>;

  toast: (message: string, kind?: Toast["kind"]) => void;
  setPalette: (open: boolean) => void;
  setSavePrompt: (open: boolean) => void;
  dismissOnboarding: () => void;
  useAsReference: (asset: MediaAsset, role?: RefRole) => void;
}
