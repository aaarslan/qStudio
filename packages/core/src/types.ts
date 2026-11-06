export type Mode = "image" | "video" | "audio";

export type RefRole = "reference" | "first_frame" | "last_frame" | "audio" | "video";

export type ProviderFamily =
  | "qwen-image"
  | "wan-image"
  | "wan-video"
  | "happyhorse-t2v"
  | "happyhorse-i2v"
  | "happyhorse-r2v"
  | "tts";

export interface ModelFeatures {
  negativePrompt: boolean;
  seed: boolean;
  watermark: boolean;
  promptExtend: boolean;
  promptExtendMode: boolean;
  thinking: boolean;
  sequential: boolean;
  colorPalette: boolean;
  audioTrack: boolean;
  smartDuration: boolean;
  instruction: boolean;
}

export interface RefLimits {
  reference: number;
  first_frame: number;
  last_frame: number;
  audio: number;
  video: number;
  required?: RefRole[];
  /** first/last frame cannot be mixed with reference_* on wan3.0 */
  exclusiveFrames?: boolean;
}

export interface ModelDef {
  id: string;
  label: string;
  mode: Mode;
  family: ProviderFamily;
  blurb: string;
  bestFor: string;
  chips: string[];
  /** Submit through the async task API even when the model docs allow sync. */
  async?: boolean;
  features: ModelFeatures;
  refs: RefLimits;
  n: { min: number; max: number; sequentialMax?: number };
  sizes?: {
    kind: "pixels" | "tiers";
    tiers?: string[];
    min?: number;
    max?: number;
    defaultTier?: string;
  };
  duration?: { min: number; max: number; default: number; smart?: boolean };
  resolutions?: string[];
  ratios?: string[];
  defaultRatio?: string;
  defaultResolution?: string;
  voices?: { id: string; label: string; note?: string }[];
  formats?: ("mp3" | "wav")[];
}

export interface JobRefInput {
  mediaId: string;
  role: RefRole;
  name?: string;
  thumb?: string;
  mime?: string;
}

export interface JobSpec {
  mode: Mode;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  n: number;
  aspect: string;
  size: string;
  tier: string;
  resolution: string;
  ratio: string;
  duration: number;
  smartDuration?: boolean;
  audioTrack?: boolean;
  seed?: number | null;
  watermark: boolean;
  promptExtend: boolean;
  promptExtendMode?: "direct" | "agent";
  thinking?: boolean;
  sequential?: boolean;
  colorPalette?: string[];
  voice?: string;
  ssml?: boolean;
  format?: "mp3" | "wav";
  sampleRate?: number;
  instruction?: string;
  refs: JobRefInput[];
}

export interface ResolvedRef {
  mediaId: string;
  role: RefRole;
  url: string;
  mime: string;
}

export interface BuiltRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: unknown;
  async: boolean;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type LocalExportStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface JobAsset {
  id: string;
  kind: "image" | "video" | "audio";
  url: string;
  sourceUrl?: string;
  filePath: string;
  thumb?: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  hasAudio?: boolean;
}

export interface JobFilmLink {
  worldId: string;
  sceneId: string;
  shotId: string;
  takeId: string;
}

export interface Job {
  id: string;
  mode: Mode;
  modelId: string;
  status: JobStatus;
  prompt: string;
  spec: JobSpec;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  taskId?: string;
  statusNote?: string;
  error?: { code?: string; message: string; hint?: string };
  request?: { url: string; headers: Record<string, string>; body: unknown };
  assets: JobAsset[];
  demo?: boolean;
  units?: number;
  film?: JobFilmLink;
}

export type EntityKind = "character" | "location" | "prop";

export type ShotStatus = "draft" | "approved" | "locked";

export interface World {
  id: string;
  title: string;
  logline: string;
  scriptText: string;
  palette: string[];
  aspect: string;
  look: string;
  rules: string;
  createdAt: string;
  updatedAt: string;
}

export interface Entity {
  id: string;
  worldId: string;
  kind: EntityKind;
  name: string;
  description: string;
  wardrobe: string;
  voiceId?: string;
  negative: string;
  canonicalMediaIds: string[];
  palette: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Scene {
  id: string;
  worldId: string;
  title: string;
  slugline: string;
  summary: string;
  palette: string[];
  light: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface DriftReport {
  score: number;
  paletteDistance?: number;
  averageColor?: string;
  refCoverage: number;
  warnings: string[];
  checkedAt: string;
}

export interface ShotTake {
  id: string;
  jobId: string;
  mediaIds?: string[];
  label: string;
  createdAt: string;
  fingerprint: string;
  entityVersions: Record<string, number>;
  verdict?: "accepted" | "rejected" | null;
  drift?: DriftReport;
}

export interface Shot {
  id: string;
  worldId: string;
  sceneId: string;
  title: string;
  action: string;
  dialogue: string;
  speakerEntityId?: string;
  framing: string;
  lens: string;
  cameraMove: string;
  light: string;
  emotion: string;
  screenDirection: string;
  durationSeconds: number;
  entityIds: string[];
  order: number;
  mode: "image" | "video";
  modelId: string;
  status: ShotStatus;
  continuesFromShotId?: string;
  trimIn?: number;
  trimOut?: number;
  takes: ShotTake[];
  selectedTakeId?: string;
  audioMediaIds: string[];
  audioGain?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PatchSuggestion {
  id: string;
  kind: string;
  title: string;
  detail: string;
  shotId?: string;
  sceneId?: string;
  patch?: Partial<Shot>;
  draftShot?: Partial<Shot>;
}

export interface UsageRecord {
  id: string;
  jobId: string;
  modelId: string;
  mode: Mode;
  units: number;
  status: JobStatus;
  createdAt: string;
  filePath?: string;
}

export interface MediaAsset {
  parentMediaIds?: string[];
  qualityLabels?: ("best-likeness" | "best-motion")[];
  referenceStatus?: "candidate" | "approved";
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  filePath: string;
  url?: string;
  sourceUrl?: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  hash: string;
  thumb?: string;
  hasAudio?: boolean;
  source: "upload" | "generated";
  jobId?: string;
  prompt?: string;
  tags: string[];
  favorite: boolean;
  collection?: string;
  createdAt: string;
  useCount: number;
}

export interface PromptVersion {
  recipe?: PromptRecipe;
  title: string;
  text: string;
  params: Partial<JobSpec>;
  editedAt: string;
}

export interface PromptRecipe {
  identity: string;
  wardrobe: string;
  pose: string;
  expression: string;
  lighting: string;
  background: string;
  camera: string;
  preserveFace: boolean;
  preserveProportions: boolean;
  preserveOutfit: boolean;
}

export interface PromptRecord {
  recipe?: PromptRecipe;
  exampleMediaIds?: string[];
  id: string;
  title: string;
  text: string;
  mode: Mode;
  modelId: string;
  params: Partial<JobSpec>;
  tags: string[];
  favorite: boolean;
  useCount: number;
  lastUsedAt?: string;
  createdAt: string;
  coverMediaId?: string;
  notes?: string;
  history?: PromptVersion[];
}

export interface Settings {
  theme: "dark" | "light";
  outputRoot: string;
  demoMode: boolean;
  baseUrl: string;
  profile: "token-plan" | "payg";
  region: string;
  referenceTransport: "auto" | "base64" | "oss";
  concurrencyImages: number;
  concurrencyVideo: number;
  monthlyCapUnits?: number;
}

export interface KeyStatus {
  present: boolean;
  prefix: string;
  source: "keychain" | "env" | "file" | "none";
  kind?: "token-plan" | "payg" | "unknown";
}

export interface AppState {
  settings: Settings;
  key: KeyStatus;
  models: ModelDef[];
  jobs: Job[];
  media: MediaAsset[];
  prompts: PromptRecord[];
  worlds: World[];
  entities: Entity[];
  scenes: Scene[];
  shots: Shot[];
}
