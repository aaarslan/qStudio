import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canTransitionJobStatus, isTerminalJobStatus } from "@qstudio/core";
import { DATA_DIR } from "./config";
import type {
  Entity,
  Job,
  MediaAsset,
  PromptRecord,
  Scene,
  Shot,
  UsageRecord,
  World,
} from "@qstudio/core";

interface Database {
  version: number;
  media: MediaAsset[];
  jobs: Job[];
  prompts: PromptRecord[];
  worlds: World[];
  entities: Entity[];
  scenes: Scene[];
  shots: Shot[];
}

const DB_FILE = path.join(DATA_DIR, "qstudio.db");
const LEGACY_FILE = path.join(DATA_DIR, "qstudio.db.json");

const EMPTY_DB: Database = {
  version: 1,
  media: [],
  jobs: [],
  prompts: [],
  worlds: [],
  entities: [],
  scenes: [],
  shots: [],
};

let db: Database = { ...EMPTY_DB };
let writeTimer: NodeJS.Timeout | null = null;
let sql: DatabaseSync | null = null;
let loadWarnings: string[] = [];

function migrateSchema(conn: DatabaseSync) {
  const row = conn.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const version = Number(row?.user_version ?? 0);
  if (version > 1) throw new Error(`This Q Studio database is newer than this app (schema ${version}).`);
  if (version < 1) {
    conn.exec("DELETE FROM usage WHERE rowid NOT IN (SELECT MAX(rowid) FROM usage GROUP BY job_id);");
    conn.exec("CREATE UNIQUE INDEX IF NOT EXISTS usage_job ON usage(job_id);");
    conn.exec("PRAGMA user_version = 1;");
  }
}

function openSql() {
  if (sql) return sql;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sql = new DatabaseSync(DB_FILE);
  sql.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, kind TEXT, source TEXT, favorite INTEGER, hash TEXT, created TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS media_hash ON media(hash);
    CREATE INDEX IF NOT EXISTS media_kind ON media(kind, source);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT, task_id TEXT, created TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
    CREATE TABLE IF NOT EXISTS prompts (id TEXT PRIMARY KEY, created TEXT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, job_id TEXT, model TEXT, mode TEXT, units REAL, status TEXT, created TEXT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, created TEXT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, world_id TEXT, kind TEXT, created TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS entities_world ON entities(world_id);
    CREATE TABLE IF NOT EXISTS scenes (id TEXT PRIMARY KEY, world_id TEXT, ord REAL, created TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS scenes_world ON scenes(world_id);
    CREATE TABLE IF NOT EXISTS shots (id TEXT PRIMARY KEY, world_id TEXT, scene_id TEXT, ord REAL, created TEXT, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS shots_scene ON shots(scene_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(id, title, text, tags);
    CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(id, name, prompt, tags);
    CREATE VIRTUAL TABLE IF NOT EXISTS film_fts USING fts5(id, name, text);
  `);
  migrateSchema(sql);
  sql.exec("CREATE TABLE IF NOT EXISTS content_packs (id TEXT PRIMARY KEY)");
  return sql;
}

export function uid(prefix = ""): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return prefix ? `${prefix}_${id}` : id;
}

export function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const SEED_PROMPTS: Omit<PromptRecord, "id" | "createdAt">[] = [
  {
    title: "Editorial portrait, late light",
    text: "Editorial portrait of a subject in relaxed layered clothing on a rooftop at golden hour, soft backlight across the frame, warm film grain, 85mm, shallow depth of field, muted apricot and olive palette, natural texture, no text.",
    mode: "image",
    modelId: "qwen-image-3.0-pro",
    params: { aspect: "3:4", size: "1536*2048", tier: "2K", n: 2, negativePrompt: "plastic skin, over-smoothing, extra fingers, watermark" },
    tags: ["portrait", "editorial", "film"],
    favorite: true,
    useCount: 0,
  },
  {
    title: "Product hero on wet stone",
    text: "A matte glass skincare bottle standing on wet black slate, single hard side light, fine mist, droplets catching the light, deep charcoal background, commercial product photography, crisp label, negative space at the top, 100mm macro.",
    mode: "image",
    modelId: "qwen-image-3.0-pro",
    params: { aspect: "4:3", size: "2048*1536", tier: "2K", n: 1 },
    tags: ["product", "commercial", "lighting"],
    favorite: false,
    useCount: 0,
  },
  {
    title: "Swiss poster, oversized type",
    text: "A Swiss international style poster for a winter jazz festival. Enormous condensed sans-serif headline reading WINTER JAZZ, a single cobalt circle, off-white paper, precise grid, letterpress texture, 1960s influence, generous margins.",
    mode: "image",
    modelId: "qwen-image-3.0-pro",
    params: { aspect: "2:3", size: "1365*2048", tier: "2K", n: 1 },
    tags: ["poster", "typography", "graphic design"],
    favorite: true,
    useCount: 0,
  },
  {
    title: "Reference sheet, four views",
    text: "Reference sheet of a subject in layered outerwear, shown front, three-quarter, profile and back on a neutral warm grey background, consistent proportions and colours, flat studio lighting, concept art, no text.",
    mode: "image",
    modelId: "wan2.7-image",
    params: { aspect: "16:9", size: "2688*1536", tier: "2K", n: 4, sequential: true },
    tags: ["concept art", "sheet", "reference"],
    favorite: false,
    useCount: 0,
  },
  {
    title: "Brand palette campaign",
    text: "Minimal campaign image of a ceramic lamp on a plaster plinth, sculptural shadows, exact brand colours, calm and premium, soft gradient backdrop, generous negative space.",
    mode: "image",
    modelId: "wan2.7-image-pro",
    params: {
      aspect: "4:3",
      size: "4096*3072",
      tier: "4K",
      n: 2,
      colorPalette: ["#1F3A34", "#E8E2D6", "#C8A24A", "#8C5A3C", "#2B2B2B", "#F4F1EA"],
    },
    tags: ["brand", "4k", "campaign"],
    favorite: false,
    useCount: 0,
  },
  {
    title: "Six-beat storyboard",
    text: "A six-panel storyboard for a 15 second spot: a rider leaves a rainy street, the camera tracks the wheel, a close-up of wet brakes, a wide shot of the city opening up, a low angle of the rider smiling, the bike parked against a sunlit wall. Consistent subject and wardrobe, cinematic frames, no dialogue.",
    mode: "image",
    modelId: "wan2.7-image-pro",
    params: { aspect: "16:9", size: "4096*2304", tier: "4K", n: 6, sequential: true },
    tags: ["storyboard", "video prep", "cinematic"],
    favorite: false,
    useCount: 0,
  },
  {
    title: "Outfit swap, two references",
    text: "The subject in [Image 1] wears the outer layer from [Image 2]. Keep the pose, hair and expression from [Image 1] unchanged. Match the original lighting and camera angle. Editorial fashion photography, natural fabric folds.",
    mode: "image",
    modelId: "qwen-image-3.0-pro",
    params: { aspect: "3:4", size: "1536*2048", tier: "2K", n: 2 },
    tags: ["edit", "fashion", "reference"],
    favorite: true,
    useCount: 0,
  },
  {
    title: "Subject in a new scene",
    text: "Place the subject from [Image 1] into a quiet concrete apartment at dusk, sitting by a tall window. Preserve identity and proportions exactly. Soft blue window light, warm practical lamp, film still, 35mm.",
    mode: "image",
    modelId: "wan2.7-image",
    params: { aspect: "16:9", size: "2688*1536", tier: "2K", n: 1 },
    tags: ["edit", "reference", "cinematic"],
    favorite: false,
    useCount: 0,
  },
  {
    title: "Three-shot cinematic sequence",
    text: "A restrained, cinematic sequence. Shot 1 [0-3s]: Wide shot of a rain-soaked street at night, a lone rider under a streetlamp, neon reflected in puddles. Shot 2 [3-6s]: Close-up of the front wheel cutting through water, slow motion. Shot 3 [6-10s]: The camera rises to reveal the city skyline as the rain stops. Natural sound, no dialogue.",
    mode: "video",
    modelId: "wan3.0-video",
    params: { aspect: "16:9", resolution: "1080P", ratio: "16:9", duration: 10, audioTrack: true, promptExtend: true },
    tags: ["cinematic", "multi-shot", "narrative"],
    favorite: true,
    useCount: 0,
  },
  {
    title: "Product turntable",
    text: "A slow, single-take turntable shot of a matte aluminium water bottle on a seamless warm grey set. Studio softbox from the left, gentle rim light, subtle reflection on the surface, no cuts, no text, premium commercial.",
    mode: "video",
    modelId: "happyhorse-1.1-t2v",
    params: { aspect: "16:9", resolution: "1080P", ratio: "16:9", duration: 5 },
    tags: ["product", "commercial", "turntable"],
    favorite: false,
    useCount: 0,
  },
  {
    title: "Subject walk-on from reference",
    text: "[Image 1] enters from the left of frame into a sunlit studio, turns to camera and smiles. Keep the face, hair and outfit from [Image 1] exactly. Slow dolly in, natural movement, no cuts.",
    mode: "video",
    modelId: "happyhorse-1.1-r2v",
    params: { aspect: "16:9", resolution: "720P", ratio: "16:9", duration: 5 },
    tags: ["reference", "portrait", "motion"],
    favorite: false,
    useCount: 0,
  },
  {
    title: "Narration bed, warm and close",
    text: "There is a particular quiet that arrives after the rain. The street keeps its lights on, as if waiting for someone to notice.",
    mode: "audio",
    modelId: "qwen-audio-3.0-tts-plus",
    params: {
      voice: "longanhuan_v3.6",
      format: "mp3",
      sampleRate: 24000,
      instruction: "Read slowly and warmly, close to the microphone, with a reflective pause after the first sentence.",
    },
    tags: ["narration", "warm", "voiceover"],
    favorite: true,
    useCount: 0,
  },
  {
    title: "Whispered ASMR line",
    text: "[whispers] You're safe here. [serious] Just breathe out, slowly. [asmr] Let the day go.",
    mode: "audio",
    modelId: "qwen-audio-3.0-tts-plus",
    params: { voice: "longanlingxin", format: "wav", sampleRate: 48000, instruction: "Very close, soft, unhurried." },
    tags: ["asmr", "emotion tags"],
    favorite: false,
    useCount: 0,
  },
];

function seed() {
  const now = Date.now();
  db.prompts = SEED_PROMPTS.map((p, i) => ({
    ...p,
    id: uid("prm"),
    createdAt: new Date(now - i * 86_400_000).toISOString(),
  }));
}

function parseRows<T>(rows: { json: string }[], kind: string): T[] {
  const out: T[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.json) as T;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      out.push(parsed);
    } catch {
      loadWarnings.push(`Skipped one unreadable ${kind} record.`);
    }
  }
  return out;
}

export function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  loadWarnings = [];
  const conn = openSql();
  const mediaRows = conn.prepare("SELECT json FROM media ORDER BY rowid DESC").all() as { json: string }[];
  const jobRows = conn.prepare("SELECT json FROM jobs ORDER BY rowid DESC").all() as { json: string }[];
  const promptRows = conn.prepare("SELECT json FROM prompts ORDER BY rowid DESC").all() as { json: string }[];
  const worldRows = conn.prepare("SELECT json FROM worlds ORDER BY rowid DESC").all() as { json: string }[];
  const entityRows = conn.prepare("SELECT json FROM entities ORDER BY rowid ASC").all() as { json: string }[];
  const sceneRows = conn.prepare("SELECT json FROM scenes ORDER BY ord ASC, rowid ASC").all() as { json: string }[];
  const shotRows = conn.prepare("SELECT json FROM shots ORDER BY ord ASC, rowid ASC").all() as { json: string }[];
  if (mediaRows.length || jobRows.length || promptRows.length || worldRows.length) {
    db = {
      version: 1,
      media: parseRows<MediaAsset>(mediaRows, "media"),
      jobs: parseRows<Job>(jobRows, "job"),
      prompts: parseRows<PromptRecord>(promptRows, "prompt"),
      worlds: parseRows<World>(worldRows, "world"),
      entities: parseRows<Entity>(entityRows, "entity"),
      scenes: parseRows<Scene>(sceneRows, "scene"),
      shots: parseRows<Shot>(shotRows, "shot"),
    };
    clearPendingWrites();
  } else if (fs.existsSync(LEGACY_FILE)) {
    try {
      fs.copyFileSync(LEGACY_FILE, `${LEGACY_FILE}.backup`);
      const raw = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8")) as Partial<Database>;
      db = {
        ...EMPTY_DB,
        version: 1,
        media: raw.media ?? [],
        jobs: raw.jobs ?? [],
        prompts: raw.prompts ?? [],
        worlds: raw.worlds ?? [],
        entities: raw.entities ?? [],
        scenes: raw.scenes ?? [],
        shots: raw.shots ?? [],
      };
      fullSyncNeeded = true;
      flushNow();
      fs.renameSync(LEGACY_FILE, `${LEGACY_FILE}.migrated`);
    } catch (err) {
      loadWarnings.push(`The legacy database could not be migrated: ${(err as Error).message}`);
      db = { ...EMPTY_DB };
    }
  }
  for (const job of db.jobs) {
    if (job.status === "running") {
      job.status = "queued";
      job.statusNote = "Interrupted by restart. Queued to resume.";
      writeJobRow(job);
    }
  }
  if (!db.prompts.length) {
    seed();
    fullSyncNeeded = true;
    flushNow();
  }

  let backfilled = false;
  for (const shot of db.shots) {
    for (const take of shot.takes ?? []) {
      if (take.mediaIds?.length) continue;
      const job = db.jobs.find((item) => item.id === take.jobId);
      const ids = job?.assets.map((asset) => asset.id) ?? [];
      if (ids.length) {
        take.mediaIds = ids;
        backfilled = true;
      }
    }
  }
  if (backfilled) {
    fullSyncNeeded = true;
    flushNow();
  }
}

export function integrityReport() {
  let orphanedTakes = 0;
  let missingTakeMedia = 0;
  for (const shot of db.shots) {
    for (const take of shot.takes ?? []) {
      const jobExists = db.jobs.some((job) => job.id === take.jobId);
      if (!jobExists && !take.mediaIds?.length) orphanedTakes++;
      if (take.mediaIds?.length && take.mediaIds.every((id) => !db.media.some((media) => media.id === id))) {
        missingTakeMedia++;
      }
    }
  }
  return {
    warnings: [...loadWarnings, ...(orphanedTakes ? [`${orphanedTakes} take(s) lost their job and have no saved media link.`] : [])],
    orphanedTakes,
    missingTakeMedia,
  };
}

type TableKind = "media" | "jobs" | "prompts" | "worlds" | "entities" | "scenes" | "shots";

const TABLE_KINDS: TableKind[] = ["media", "jobs", "prompts", "worlds", "entities", "scenes", "shots"];

const dirtyIds: Record<TableKind, Set<string>> = {
  media: new Set(),
  jobs: new Set(),
  prompts: new Set(),
  worlds: new Set(),
  entities: new Set(),
  scenes: new Set(),
  shots: new Set(),
};

const deletedIds: Record<TableKind, Set<string>> = {
  media: new Set(),
  jobs: new Set(),
  prompts: new Set(),
  worlds: new Set(),
  entities: new Set(),
  scenes: new Set(),
  shots: new Set(),
};

let fullSyncNeeded = true;

function markDirty(kind: TableKind, id: string) {
  deletedIds[kind].delete(id);
  dirtyIds[kind].add(id);
  persist();
}

function markDeleted(kind: TableKind, id: string) {
  dirtyIds[kind].delete(id);
  deletedIds[kind].add(id);
  persist();
}

function hasPendingWrites(): boolean {
  if (fullSyncNeeded) return true;
  return TABLE_KINDS.some((k) => dirtyIds[k].size > 0 || deletedIds[k].size > 0);
}

function clearPendingWrites() {
  for (const k of TABLE_KINDS) {
    dirtyIds[k].clear();
    deletedIds[k].clear();
  }
  fullSyncNeeded = false;
}

export function flushNow() {
  if (!hasPendingWrites()) return;
  const conn = openSql();
  conn.exec("BEGIN");
  try {
    if (fullSyncNeeded) syncAll(conn);
    else syncDirty(conn);
    conn.exec("COMMIT");
    clearPendingWrites();
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

function syncDirty(conn: DatabaseSync) {
  const byId = {
    media: new Map(db.media.map((x) => [x.id, x])),
    jobs: new Map(db.jobs.map((x) => [x.id, x])),
    prompts: new Map(db.prompts.map((x) => [x.id, x])),
    worlds: new Map(db.worlds.map((x) => [x.id, x])),
    entities: new Map(db.entities.map((x) => [x.id, x])),
    scenes: new Map(db.scenes.map((x) => [x.id, x])),
    shots: new Map(db.shots.map((x) => [x.id, x])),
  };
  const del = {
    media: conn.prepare("DELETE FROM media WHERE id = ?"),
    jobs: conn.prepare("DELETE FROM jobs WHERE id = ?"),
    prompts: conn.prepare("DELETE FROM prompts WHERE id = ?"),
    worlds: conn.prepare("DELETE FROM worlds WHERE id = ?"),
    entities: conn.prepare("DELETE FROM entities WHERE id = ?"),
    scenes: conn.prepare("DELETE FROM scenes WHERE id = ?"),
    shots: conn.prepare("DELETE FROM shots WHERE id = ?"),
  };
  const delPromptFts = conn.prepare("DELETE FROM prompts_fts WHERE id = ?");
  const delMediaFts = conn.prepare("DELETE FROM media_fts WHERE id = ?");
  const delFilmFts = conn.prepare("DELETE FROM film_fts WHERE id = ?");
  for (const kind of TABLE_KINDS) {
    for (const id of deletedIds[kind]) {
      del[kind].run(id);
      if (kind === "prompts") delPromptFts.run(id);
      if (kind === "media") delMediaFts.run(id);
      if (kind === "entities" || kind === "scenes" || kind === "shots") delFilmFts.run(id);
    }
  }
  const upMedia = conn.prepare(
    "INSERT INTO media (id, kind, source, favorite, hash, created, json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, source = excluded.source, favorite = excluded.favorite, hash = excluded.hash, created = excluded.created, json = excluded.json"
  );
  const upMediaFts = conn.prepare("INSERT INTO media_fts (id, name, prompt, tags) VALUES (?, ?, ?, ?)");
  for (const id of dirtyIds.media) {
    const m = byId.media.get(id);
    if (!m) continue;
    upMedia.run(m.id, m.kind, m.source, m.favorite ? 1 : 0, m.hash, m.createdAt, JSON.stringify(m));
    delMediaFts.run(m.id);
    upMediaFts.run(m.id, m.name, m.prompt ?? "", m.tags.join(" "));
  }
  const upJob = conn.prepare(
    "INSERT INTO jobs (id, status, task_id, created, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, task_id = excluded.task_id, created = excluded.created, json = excluded.json"
  );
  for (const id of dirtyIds.jobs) {
    const j = byId.jobs.get(id);
    if (j) upJob.run(j.id, j.status, j.taskId ?? null, j.createdAt, JSON.stringify(j));
  }
  const upPrompt = conn.prepare(
    "INSERT INTO prompts (id, created, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET created = excluded.created, json = excluded.json"
  );
  const upPromptFts = conn.prepare("INSERT INTO prompts_fts (id, title, text, tags) VALUES (?, ?, ?, ?)");
  for (const id of dirtyIds.prompts) {
    const p = byId.prompts.get(id);
    if (!p) continue;
    upPrompt.run(p.id, p.createdAt, JSON.stringify(p));
    delPromptFts.run(p.id);
    upPromptFts.run(p.id, p.title, p.text, p.tags.join(" "));
  }
  const upWorld = conn.prepare(
    "INSERT INTO worlds (id, created, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET created = excluded.created, json = excluded.json"
  );
  for (const id of dirtyIds.worlds) {
    const w = byId.worlds.get(id);
    if (w) upWorld.run(w.id, w.createdAt, JSON.stringify(w));
  }
  const upEntity = conn.prepare(
    "INSERT INTO entities (id, world_id, kind, created, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET world_id = excluded.world_id, kind = excluded.kind, created = excluded.created, json = excluded.json"
  );
  const upScene = conn.prepare(
    "INSERT INTO scenes (id, world_id, ord, created, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET world_id = excluded.world_id, ord = excluded.ord, created = excluded.created, json = excluded.json"
  );
  const upShot = conn.prepare(
    "INSERT INTO shots (id, world_id, scene_id, ord, created, json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET world_id = excluded.world_id, scene_id = excluded.scene_id, ord = excluded.ord, created = excluded.created, json = excluded.json"
  );
  const upFilmFts = conn.prepare("INSERT INTO film_fts (id, name, text) VALUES (?, ?, ?)");
  for (const id of dirtyIds.entities) {
    const e = byId.entities.get(id);
    if (!e) continue;
    upEntity.run(e.id, e.worldId, e.kind, e.createdAt, JSON.stringify(e));
    delFilmFts.run(e.id);
    upFilmFts.run(e.id, e.name, `${e.description} ${e.wardrobe}`.trim());
  }
  for (const id of dirtyIds.scenes) {
    const s = byId.scenes.get(id);
    if (!s) continue;
    upScene.run(s.id, s.worldId, s.order, s.createdAt, JSON.stringify(s));
    delFilmFts.run(s.id);
    upFilmFts.run(s.id, s.title, `${s.slugline} ${s.summary}`.trim());
  }
  for (const id of dirtyIds.shots) {
    const s = byId.shots.get(id);
    if (!s) continue;
    upShot.run(s.id, s.worldId, s.sceneId, s.order, s.createdAt, JSON.stringify(s));
    delFilmFts.run(s.id);
    upFilmFts.run(s.id, s.title, `${s.action} ${s.dialogue} ${s.framing}`.trim());
  }
}

function syncAll(conn: DatabaseSync) {
    conn.exec(
      "DELETE FROM media; DELETE FROM jobs; DELETE FROM prompts; DELETE FROM worlds; DELETE FROM entities; DELETE FROM scenes; DELETE FROM shots; DELETE FROM prompts_fts; DELETE FROM media_fts; DELETE FROM film_fts;"
    );
    const insMedia = conn.prepare("INSERT INTO media (id, kind, source, favorite, hash, created, json) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const m of [...db.media].reverse()) {
      insMedia.run(m.id, m.kind, m.source, m.favorite ? 1 : 0, m.hash, m.createdAt, JSON.stringify(m));
    }
    const insJob = conn.prepare("INSERT INTO jobs (id, status, task_id, created, json) VALUES (?, ?, ?, ?, ?)");
    for (const j of [...db.jobs].reverse()) {
      insJob.run(j.id, j.status, j.taskId ?? null, j.createdAt, JSON.stringify(j));
    }
    const insPrompt = conn.prepare("INSERT INTO prompts (id, created, json) VALUES (?, ?, ?)");
    for (const p of [...db.prompts].reverse()) {
      insPrompt.run(p.id, p.createdAt, JSON.stringify(p));
    }
    const insPromptFts = conn.prepare("INSERT INTO prompts_fts (id, title, text, tags) VALUES (?, ?, ?, ?)");
    for (const p of db.prompts) insPromptFts.run(p.id, p.title, p.text, p.tags.join(" "));
    const insMediaFts = conn.prepare("INSERT INTO media_fts (id, name, prompt, tags) VALUES (?, ?, ?, ?)");
    for (const m of db.media) insMediaFts.run(m.id, m.name, m.prompt ?? "", m.tags.join(" "));
    const insWorld = conn.prepare("INSERT INTO worlds (id, created, json) VALUES (?, ?, ?)");
    for (const w of [...db.worlds].reverse()) insWorld.run(w.id, w.createdAt, JSON.stringify(w));
    const insEntity = conn.prepare("INSERT INTO entities (id, world_id, kind, created, json) VALUES (?, ?, ?, ?, ?)");
    for (const e of db.entities) insEntity.run(e.id, e.worldId, e.kind, e.createdAt, JSON.stringify(e));
    const insScene = conn.prepare("INSERT INTO scenes (id, world_id, ord, created, json) VALUES (?, ?, ?, ?, ?)");
    for (const s of db.scenes) insScene.run(s.id, s.worldId, s.order, s.createdAt, JSON.stringify(s));
    const insShot = conn.prepare("INSERT INTO shots (id, world_id, scene_id, ord, created, json) VALUES (?, ?, ?, ?, ?, ?)");
    for (const s of db.shots) insShot.run(s.id, s.worldId, s.sceneId, s.order, s.createdAt, JSON.stringify(s));
    const insFilmFts = conn.prepare("INSERT INTO film_fts (id, name, text) VALUES (?, ?, ?)");
    for (const e of db.entities) insFilmFts.run(e.id, e.name, `${e.description} ${e.wardrobe}`.trim());
    for (const s of db.scenes) insFilmFts.run(s.id, s.title, `${s.slugline} ${s.summary}`.trim());
    for (const s of db.shots) insFilmFts.run(s.id, s.title, `${s.action} ${s.dialogue} ${s.framing}`.trim());
}

export function closeDb() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    flushNow();
  } catch {
  }
  if (sql) {
    try {
      sql.close();
    } catch {
    }
    sql = null;
  }
}

export function searchAll(q: string) {
  const needle = q.trim();
  if (!needle) return { prompts: [] as PromptRecord[], media: [] as MediaAsset[] };
  const conn = openSql();
  const match = needle.split(/\s+/).map((w) => `"${w.replaceAll('"', "")}"`).join(" ");
  try {
    const promptIds = conn
      .prepare("SELECT id FROM prompts_fts WHERE prompts_fts MATCH ? LIMIT 50")
      .all(match) as { id: string }[];
    const mediaIds = conn
      .prepare("SELECT id FROM media_fts WHERE media_fts MATCH ? LIMIT 50")
      .all(match) as { id: string }[];
    const pSet = new Set(promptIds.map((r) => r.id));
    const mSet = new Set(mediaIds.map((r) => r.id));
    return {
      prompts: db.prompts.filter((p) => pSet.has(p.id)),
      media: db.media.filter((m) => mSet.has(m.id)),
    };
  } catch {
    return { prompts: [] as PromptRecord[], media: [] as MediaAsset[] };
  }
}

export function addUsage(entry: UsageRecord) {
  const conn = openSql();
  const existing = conn.prepare("SELECT json FROM usage WHERE job_id = ?").get(entry.jobId) as
    | { json: string }
    | undefined;
  if (existing) return JSON.parse(existing.json) as UsageRecord;
  conn
    .prepare("INSERT INTO usage (id, job_id, model, mode, units, status, created, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(entry.id, entry.jobId, entry.modelId, entry.mode, entry.units, entry.status, entry.createdAt, JSON.stringify(entry));
  return entry;
}

export function listUsage(limit = 200): UsageRecord[] {
  const conn = openSql();
  const rows = conn
    .prepare("SELECT json FROM usage ORDER BY created DESC LIMIT ?")
    .all(limit) as { json: string }[];
  return rows.map((r) => JSON.parse(r.json) as UsageRecord);
}

export function monthUnits(): number {
  const conn = openSql();
  const prefix = new Date().toISOString().slice(0, 7);
  const row = conn
    .prepare("SELECT COALESCE(SUM(units), 0) AS total FROM usage WHERE created LIKE ? AND status != 'failed' AND status != 'canceled'")
    .get(`${prefix}%`) as { total: number };
  return Math.round(Number(row.total) * 10) / 10;
}

export function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      flushNow();
    } catch (err) {
      console.error("[store] write failed", err);
    }
  }, 120);
}

/* ------------------------------- media ------------------------------- */

export function addMedia(asset: MediaAsset) {
  db.media.unshift(asset);
  markDirty("media", asset.id);
  return asset;
}

export function getMedia(id: string) {
  return db.media.find((m) => m.id === id);
}

export function findMediaByHash(hash: string) {
  return db.media.find((m) => m.hash === hash);
}

export function listMedia(filter?: { kind?: string; source?: string; favorite?: boolean }) {
  let out = db.media;
  if (filter?.kind) out = out.filter((m) => m.kind === filter.kind);
  if (filter?.source) out = out.filter((m) => m.source === filter.source);
  if (filter?.favorite) out = out.filter((m) => m.favorite);
  return out;
}

export function updateMedia(id: string, patch: Partial<MediaAsset>) {
  const item = db.media.find((m) => m.id === id);
  if (!item) return undefined;
  Object.assign(item, patch);
  markDirty("media", id);
  return item;
}

export function removeMedia(id: string) {
  const i = db.media.findIndex((m) => m.id === id);
  if (i === -1) return undefined;
  const [item] = db.media.splice(i, 1);
  for (const job of db.jobs) {
    const assets = job.assets.filter((asset) => asset.id !== id);
    if (assets.length !== job.assets.length) {
      job.assets = assets;
      markDirty("jobs", job.id);
    }
  }
  markDeleted("media", id);
  return item;
}

export function mediaReferences(id: string): string[] {
  const refs: string[] = [];
  for (const job of db.jobs) {
    if ((job.status === "queued" || job.status === "running") && job.spec.refs.some((ref) => ref.mediaId === id)) {
      refs.push(`${job.status === "queued" ? "Queued" : "Running"} job: ${job.prompt.slice(0, 48) || job.id}`);
    }
  }
  for (const entity of db.entities) {
    if (entity.canonicalMediaIds.includes(id)) refs.push(`World Bible: ${entity.name}`);
  }
  for (const shot of db.shots) {
    if (shot.audioMediaIds.includes(id)) refs.push(`Shot audio: ${shot.title}`);
    if (shot.takes.some((take) => take.mediaIds?.includes(id))) refs.push(`Selected takes: ${shot.title}`);
  }
  for (const prompt of db.prompts) {
    if (prompt.coverMediaId === id) refs.push(`Prompt cover: ${prompt.title}`);
    if (prompt.exampleMediaIds?.includes(id)) refs.push(`Prompt example: ${prompt.title}`);
  }
  return refs;
}

export function decorateMedia(m: MediaAsset): MediaAsset {
  return { ...m, url: `/api/media/${m.id}/file`, thumb: `/api/media/${m.id}/thumb` };
}

/* -------------------------------- jobs ------------------------------- */

function writeJobRow(job: Job) {
  openSql()
    .prepare(
      "INSERT INTO jobs (id, status, task_id, created, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, task_id = excluded.task_id, created = excluded.created, json = excluded.json"
    )
    .run(job.id, job.status, job.taskId ?? null, job.createdAt, JSON.stringify(job));
}

function deleteJobRow(id: string) {
  openSql().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

export function addJob(job: Job) {
  db.jobs.unshift(job);
  markDirty("jobs", job.id);
  writeJobRow(job);
  return job;
}

export function getJob(id: string) {
  return db.jobs.find((j) => j.id === id);
}

export function listJobs() {
  return db.jobs;
}

export function updateJob(id: string, patch: Partial<Job>) {
  const job = db.jobs.find((j) => j.id === id);
  if (!job) return undefined;
  if (patch.status && !canTransitionJobStatus(job.status, patch.status)) return undefined;
  Object.assign(job, patch);
  markDirty("jobs", id);
  writeJobRow(job);
  return job;
}

export function jobCanAdvance(id: string): boolean {
  const job = getJob(id);
  return !!job && !isTerminalJobStatus(job.status);
}

export function removeJob(id: string) {
  const i = db.jobs.findIndex((j) => j.id === id);
  if (i === -1) return undefined;
  const [job] = db.jobs.splice(i, 1);
  markDeleted("jobs", id);
  deleteJobRow(id);
  return job;
}

export function jobReferences(id: string): string[] {
  const refs: string[] = [];
  for (const shot of db.shots) {
    if (shot.takes.some((take) => take.jobId === id)) refs.push(`Film take: ${shot.title}`);
  }
  return refs;
}

/* ------------------------------- prompts ----------------------------- */

export function addPrompt(p: PromptRecord) {
  db.prompts.unshift(p);
  markDirty("prompts", p.id);
  return p;
}

export function listPrompts() {
  return db.prompts;
}

export function updatePrompt(id: string, patch: Partial<PromptRecord>) {
  const p = db.prompts.find((x) => x.id === id);
  if (!p) return undefined;
  Object.assign(p, patch);
  markDirty("prompts", id);
  return p;
}

export function removePrompt(id: string) {
  const i = db.prompts.findIndex((x) => x.id === id);
  if (i === -1) return undefined;
  const [p] = db.prompts.splice(i, 1);
  markDeleted("prompts", id);
  return p;
}

/* --------------------------------- film ------------------------------ */

export function addWorld(w: World) {
  db.worlds.unshift(w);
  markDirty("worlds", w.id);
  return w;
}

export function getWorld(id: string) {
  return db.worlds.find((w) => w.id === id);
}

export function listWorlds() {
  return db.worlds;
}

export function updateWorld(id: string, patch: Partial<World>) {
  const w = db.worlds.find((x) => x.id === id);
  if (!w) return undefined;
  Object.assign(w, patch, { id: w.id, createdAt: w.createdAt, updatedAt: new Date().toISOString() });
  markDirty("worlds", id);
  return w;
}

export function removeWorld(id: string) {
  const i = db.worlds.findIndex((w) => w.id === id);
  if (i === -1) return undefined;
  const [w] = db.worlds.splice(i, 1);
  const goneEntities = db.entities.filter((e) => e.worldId === id);
  const goneScenes = db.scenes.filter((s) => s.worldId === id);
  const goneShots = db.shots.filter((s) => s.worldId === id);
  db.entities = db.entities.filter((e) => e.worldId !== id);
  db.scenes = db.scenes.filter((s) => s.worldId !== id);
  db.shots = db.shots.filter((s) => s.worldId !== id);
  for (const e of goneEntities) markDeleted("entities", e.id);
  for (const s of goneScenes) markDeleted("scenes", s.id);
  for (const s of goneShots) markDeleted("shots", s.id);
  markDeleted("worlds", id);
  return w;
}

export function addEntity(e: Entity) {
  db.entities.push(e);
  markDirty("entities", e.id);
  return e;
}

export function getEntity(id: string) {
  return db.entities.find((e) => e.id === id);
}

export function listEntities(worldId?: string) {
  return worldId ? db.entities.filter((e) => e.worldId === worldId) : db.entities;
}

const ENTITY_CONTINUITY_KEYS = ["name", "kind", "description", "wardrobe", "negative", "canonicalMediaIds", "palette"] as const;

export function updateEntity(id: string, patch: Partial<Entity>) {
  const e = db.entities.find((x) => x.id === id);
  if (!e) return undefined;
  const before = ENTITY_CONTINUITY_KEYS.map((k) => JSON.stringify(e[k])).join("|");
  Object.assign(e, patch, { id: e.id, worldId: e.worldId, createdAt: e.createdAt });
  const after = ENTITY_CONTINUITY_KEYS.map((k) => JSON.stringify(e[k])).join("|");
  if (before !== after) e.version += 1;
  e.updatedAt = new Date().toISOString();
  markDirty("entities", id);
  return e;
}

export function removeEntity(id: string) {
  const i = db.entities.findIndex((e) => e.id === id);
  if (i === -1) return undefined;
  const [e] = db.entities.splice(i, 1);
  for (const s of db.shots) {
    const hadSpeaker = s.speakerEntityId === id;
    const hadCast = s.entityIds.includes(id);
    s.entityIds = s.entityIds.filter((x) => x !== id);
    if (hadSpeaker) s.speakerEntityId = undefined;
    if (hadCast || hadSpeaker) markDirty("shots", s.id);
  }
  markDeleted("entities", id);
  return e;
}

export function addScene(s: Scene) {
  db.scenes.push(s);
  markDirty("scenes", s.id);
  return s;
}

export function getScene(id: string) {
  return db.scenes.find((s) => s.id === id);
}

export function listScenes(worldId?: string) {
  const out = worldId ? db.scenes.filter((s) => s.worldId === worldId) : db.scenes;
  return [...out].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function updateScene(id: string, patch: Partial<Scene>) {
  const s = db.scenes.find((x) => x.id === id);
  if (!s) return undefined;
  Object.assign(s, patch, { id: s.id, worldId: s.worldId, createdAt: s.createdAt, updatedAt: new Date().toISOString() });
  markDirty("scenes", id);
  return s;
}

export function removeScene(id: string) {
  const i = db.scenes.findIndex((s) => s.id === id);
  if (i === -1) return undefined;
  const [s] = db.scenes.splice(i, 1);
  const goneShots = db.shots.filter((x) => x.sceneId === id);
  db.shots = db.shots.filter((x) => x.sceneId !== id);
  for (const x of goneShots) markDeleted("shots", x.id);
  markDeleted("scenes", id);
  return s;
}

export function addShot(s: Shot) {
  db.shots.push(s);
  markDirty("shots", s.id);
  return s;
}

export function getShot(id: string) {
  return db.shots.find((s) => s.id === id);
}

export function listShots(worldId?: string) {
  const out = worldId ? db.shots.filter((s) => s.worldId === worldId) : db.shots;
  return [...out].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function updateShot(id: string, patch: Partial<Shot>) {
  const s = db.shots.find((x) => x.id === id);
  if (!s) return undefined;
  Object.assign(s, patch, { id: s.id, worldId: s.worldId, createdAt: s.createdAt, updatedAt: new Date().toISOString() });
  markDirty("shots", id);
  return s;
}

export function removeShot(id: string) {
  const i = db.shots.findIndex((s) => s.id === id);
  if (i === -1) return undefined;
  const [s] = db.shots.splice(i, 1);
  for (const x of db.shots) {
    if (x.continuesFromShotId === id) {
      x.continuesFromShotId = undefined;
      markDirty("shots", x.id);
    }
  }
  markDeleted("shots", id);
  return s;
}

export function filmState(worldId: string) {
  return {
    world: getWorld(worldId),
    entities: listEntities(worldId),
    scenes: listScenes(worldId),
    shots: listShots(worldId),
  };
}

export function attachTakeResult(job: Job) {
  if (!job.film) return undefined;
  const shot = getShot(job.film.shotId);
  if (!shot) return undefined;
  const take = shot.takes.find((t) => t.id === job.film!.takeId);
  if (!take) return undefined;
  if (job.status === "succeeded") {
    take.mediaIds = job.assets.map((asset) => asset.id);
    if (!shot.selectedTakeId) shot.selectedTakeId = take.id;
    shot.updatedAt = new Date().toISOString();
    markDirty("shots", shot.id);
  }
  return shot;
}

export function searchFilm(q: string) {
  const needle = q.trim();
  if (!needle) return { entities: [] as Entity[], scenes: [] as Scene[], shots: [] as Shot[] };
  const conn = openSql();
  const match = needle.split(/\s+/).map((w) => `"${w.replaceAll('"', "")}"`).join(" ");
  try {
    const ids = conn
      .prepare("SELECT id FROM film_fts WHERE film_fts MATCH ? LIMIT 80")
      .all(match) as { id: string }[];
    const set = new Set(ids.map((r) => r.id));
    return {
      entities: db.entities.filter((e) => set.has(e.id)),
      scenes: db.scenes.filter((s) => set.has(s.id)),
      shots: db.shots.filter((s) => set.has(s.id)),
    };
  } catch {
    return { entities: [] as Entity[], scenes: [] as Scene[], shots: [] as Shot[] };
  }
}

export function stats() {
  return {
    media: db.media.length,
    jobs: db.jobs.length,
    prompts: db.prompts.length,
    worlds: db.worlds.length,
    shots: db.shots.length,
  };
}
