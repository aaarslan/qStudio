import { getModel, modelsForMode } from "./models";
import { defaultSpec } from "./prompt";
import { sizeFor } from "./sizes";
import { estimateUnits } from "./estimate";
import type {
  Entity,
  JobRefInput,
  JobSpec,
  ModelDef,
  PatchSuggestion,
  Scene,
  Shot,
  World,
} from "./types";

export const FRAMINGS = [
  "Extreme wide",
  "Wide shot",
  "Medium wide",
  "Medium shot",
  "Medium close-up",
  "Close-up",
  "Extreme close-up",
  "Two-shot",
  "Over-the-shoulder",
  "Insert",
];

export function normalizePalette(input: string[]): string[] {
  const out: string[] = [];
  for (const raw of input ?? []) {
    const hex = String(raw).trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(hex) && !out.includes(hex)) out.push(hex);
    if (out.length >= 8) break;
  }
  return out;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9A-F]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorDistance(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return 1;
  const d = Math.sqrt((ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2);
  return d / Math.sqrt(3 * 255 * 255);
}

export function paletteDistance(a: string[], b: string[]): number {
  const pa = normalizePalette(a);
  const pb = normalizePalette(b);
  if (!pa.length && !pb.length) return 0;
  if (!pa.length || !pb.length) return 1;
  const nearest = (from: string[], to: string[]) =>
    from.map((c) => Math.min(...to.map((t) => colorDistance(c, t))));
  const all = [...nearest(pa, pb), ...nearest(pb, pa)];
  const mean = all.reduce((s, v) => s + v, 0) / all.length;
  return Math.round(Math.min(1, Math.max(0, mean)) * 1000) / 1000;
}

export function effectivePalette(world: World, scene: Scene): string[] {
  const fromScene = normalizePalette(scene.palette);
  return fromScene.length ? fromScene : normalizePalette(world.palette);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function castOf(shot: Shot, entities: Entity[]): Entity[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  return shot.entityIds.map((id) => byId.get(id)).filter(Boolean) as Entity[];
}

export function shotFingerprint(
  world: World,
  scene: Scene,
  shot: Shot,
  entities: Entity[],
  chainFirstFrameMediaId?: string
): string {
  const cast = castOf(shot, entities).map((e) => ({
    id: e.id,
    kind: e.kind,
    version: e.version,
    description: e.description,
    wardrobe: e.wardrobe,
    negative: e.negative,
    canonicalMediaIds: e.canonicalMediaIds,
  }));
  return fnv1a(
    stableStringify({
      world: { palette: normalizePalette(world.palette), aspect: world.aspect, look: world.look, rules: world.rules },
      scene: { palette: normalizePalette(scene.palette), light: scene.light, slugline: scene.slugline },
      shot: {
        action: shot.action,
        dialogue: shot.dialogue,
        speakerEntityId: shot.speakerEntityId ?? null,
        framing: shot.framing,
        lens: shot.lens,
        cameraMove: shot.cameraMove,
        light: shot.light,
        emotion: shot.emotion,
        screenDirection: shot.screenDirection,
        durationSeconds: shot.durationSeconds,
        entityIds: shot.entityIds,
        mode: shot.mode,
        modelId: shot.modelId,
        continuesFromShotId: shot.continuesFromShotId ?? null,
        audioMediaIds: shot.audioMediaIds,
      },
      cast,
      chainFirstFrameMediaId: chainFirstFrameMediaId ?? null,
    })
  );
}

export interface CompiledShot {
  spec: JobSpec;
  prompt: string;
  refs: JobRefInput[];
  palette: string[];
  fingerprint: string;
  entityVersions: Record<string, number>;
  warnings: string[];
}

function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return /[.!?"]$/.test(t) ? t : `${t}.`;
}

export function refCoverage(shot: Shot, entities: Entity[]): { ratio: number; missing: string[] } {
  const cast = castOf(shot, entities);
  if (!cast.length) return { ratio: 1, missing: [] };
  const missing = cast.filter((e) => !e.canonicalMediaIds.length).map((e) => e.name);
  return { ratio: Math.round(((cast.length - missing.length) / cast.length) * 1000) / 1000, missing };
}

export function compileShot(input: {
  world: World;
  scene: Scene;
  shot: Shot;
  entities: Entity[];
  chainFirstFrameMediaId?: string;
}): CompiledShot {
  const { world, scene, shot, entities, chainFirstFrameMediaId } = input;
  const warnings: string[] = [];
  let model: ModelDef = getModel(shot.modelId);
  if (model.id !== shot.modelId || model.mode !== shot.mode) {
    model = modelsForMode(shot.mode)[0] ?? model;
    warnings.push(`Model reset to ${model.label} for this shot mode.`);
  }
  const cast = castOf(shot, entities);
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const id of shot.entityIds) {
    if (!byId.has(id)) warnings.push("A cast member no longer exists in the World Bible.");
  }
  const palette = effectivePalette(world, scene);
  const chained = Boolean(shot.continuesFromShotId && chainFirstFrameMediaId);
  const refs: JobRefInput[] = [];
  const firstTokenByEntity = new Map<string, number>();

  if (shot.continuesFromShotId && !chainFirstFrameMediaId) {
    warnings.push("This shot continues from another shot, but no last frame is available yet. Render the earlier shot first.");
  }
  if (chained && model.refs.first_frame > 0) {
    refs.push({ mediaId: chainFirstFrameMediaId as string, role: "first_frame" });
    if (model.refs.exclusiveFrames && cast.some((e) => e.canonicalMediaIds.length)) {
      warnings.push("First frame chaining is active, so canonical reference images are held back on this model.");
    }
  } else {
    if (chained && model.refs.first_frame === 0) {
      warnings.push(`${model.label} cannot take a first frame, so chaining falls back to reference images.`);
    }
    const cap = model.refs.reference;
    let wanted = 0;
    for (const entity of cast) wanted += entity.canonicalMediaIds.length;
    for (const entity of cast) {
      for (const mediaId of entity.canonicalMediaIds) {
        if (refs.filter((r) => r.role === "reference").length >= cap) break;
        refs.push({ mediaId, role: "reference" });
        if (!firstTokenByEntity.has(entity.id)) {
          firstTokenByEntity.set(entity.id, refs.filter((r) => r.role === "reference").length);
        }
      }
    }
    if (wanted > cap) {
      warnings.push(`${model.label} accepts ${cap} reference image(s), so later canonical views were held back.`);
    }
    if (cap === 0 && wanted > 0) {
      warnings.push(`${model.label} takes no reference images, so cast identity rests on the prompt alone.`);
    }
  }
  for (const mediaId of shot.audioMediaIds) {
    if (model.refs.audio > 0 && !refs.some((r) => r.role === "first_frame" && model.refs.exclusiveFrames)) {
      if (refs.filter((r) => r.role === "audio").length < model.refs.audio) {
        refs.push({ mediaId, role: "audio" });
      }
    } else if (shot.audioMediaIds.length) {
      warnings.push("Attached audio was held back because this render path cannot carry it.");
      break;
    }
  }
  const coverage = refCoverage(shot, entities);
  for (const name of coverage.missing) {
    warnings.push(`${name} has no canonical reference yet. Add one in the World Bible for steadier continuity.`);
  }

  const parts: string[] = [];
  const frameLine = [shot.framing.trim(), shot.lens.trim()].filter(Boolean).join(", ");
  if (frameLine) parts.push(sentence(frameLine));
  if (shot.action.trim()) parts.push(sentence(shot.action));
  for (const entity of cast) {
    if (entity.kind === "character") {
      const bits = [
        entity.description.trim().replace(/\.+$/, ""),
        entity.wardrobe.trim() ? `wearing ${entity.wardrobe.trim().replace(/\.+$/, "")}` : "",
      ].filter(Boolean);
      if (bits.length) parts.push(sentence(`${entity.name}: ${bits.join(", ")}`));
    } else if (entity.kind === "location") {
      if (entity.description.trim()) parts.push(sentence(`Location, ${entity.name}: ${entity.description.trim()}`));
    } else if (entity.description.trim()) {
      parts.push(sentence(`${entity.name}: ${entity.description.trim()}`));
    }
    const token = firstTokenByEntity.get(entity.id);
    if (token) parts.push(sentence(`Keep ${entity.name} exactly as in [Image ${token}]`));
  }
  const light = shot.light.trim() || scene.light.trim();
  if (light) parts.push(sentence(`Light: ${light}`));
  if (shot.mode === "video" && shot.cameraMove.trim()) parts.push(sentence(`Camera: ${shot.cameraMove.trim()}`));
  if (shot.emotion.trim()) parts.push(sentence(`Mood: ${shot.emotion.trim()}`));
  if (shot.screenDirection.trim()) parts.push(sentence(`Screen direction ${shot.screenDirection.trim()}`));
  if (world.look.trim()) parts.push(sentence(world.look.trim()));
  if (world.rules.trim()) parts.push(sentence(world.rules.trim()));
  if (shot.mode === "video" && shot.dialogue.trim()) {
    parts.push(sentence(`Dialogue, spoken aloud: "${shot.dialogue.trim()}"`));
  }

  const spec: JobSpec = { ...defaultSpec(model), refs: [] };
  spec.prompt = parts.join(" ");
  spec.n = 1;
  const aspect = world.aspect || "16:9";
  spec.aspect = aspect;
  if (model.sizes) spec.size = sizeFor(model, spec.aspect, spec.tier);
  if (model.mode === "video") {
    spec.ratio = (model.ratios ?? []).includes(aspect) ? aspect : model.defaultRatio ?? spec.ratio;
    if (model.duration) {
      spec.duration = Math.min(Math.max(model.duration.min, Math.round(shot.durationSeconds || model.duration.default)), model.duration.max);
    }
    spec.audioTrack = model.features.audioTrack;
  }
  if (palette.length && model.features.colorPalette) spec.colorPalette = palette;
  else if (palette.length) spec.prompt = `${spec.prompt} ${sentence(`Palette: ${palette.join(", ")}`)}`.trim();
  const negatives = cast.map((e) => e.negative.trim()).filter(Boolean);
  if (negatives.length && model.features.negativePrompt) spec.negativePrompt = negatives.join(", ");
  else if (negatives.length) spec.prompt = `${spec.prompt} ${sentence(`Avoid: ${negatives.join(", ")}`)}`.trim();
  spec.refs = refs;

  const entityVersions: Record<string, number> = {};
  for (const entity of cast) entityVersions[entity.id] = entity.version;
  return {
    spec,
    prompt: spec.prompt,
    refs,
    palette,
    fingerprint: shotFingerprint(world, scene, shot, entities, chainFirstFrameMediaId),
    entityVersions,
    warnings: [...new Set(warnings)],
  };
}

export function staleReasons(
  world: World,
  scene: Scene,
  shot: Shot,
  entities: Entity[],
  chainFirstFrameMediaId?: string
): string[] {
  const take = shot.takes.find((t) => t.id === shot.selectedTakeId) ?? shot.takes[shot.takes.length - 1];
  if (!take) return [];
  const current = shotFingerprint(world, scene, shot, entities, chainFirstFrameMediaId);
  if (current === take.fingerprint) return [];
  const reasons: string[] = [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const [id, version] of Object.entries(take.entityVersions ?? {})) {
    const entity = byId.get(id);
    if (!entity) reasons.push("A cast member was removed from the World Bible.");
    else if (entity.version !== version) reasons.push(`${entity.name} changed in the World Bible.`);
  }
  for (const id of shot.entityIds) {
    if (!(id in (take.entityVersions ?? {}))) {
      const entity = byId.get(id);
      reasons.push(entity ? `${entity.name} joined the cast after this take.` : "The cast changed after this take.");
    }
  }
  if (!reasons.length) reasons.push("Shot, scene, or world intent changed since this take was rendered.");
  return [...new Set(reasons)];
}


export interface BreakdownShot {
  title: string;
  action: string;
  dialogue: string;
  speakerName: string;
  framing: string;
  durationSeconds: number;
}

export interface BreakdownScene {
  slugline: string;
  title: string;
  summary: string;
  shots: BreakdownShot[];
}

const SLUGLINE_RE = /^(INT\.|EXT\.|INT\/EXT\.|INT\b|EXT\b)\s+.+/i;
const CUE_RE = /^[A-Z][A-Z0-9 .'-]{1,28}$/;

function titleFromSlugline(slugline: string): string {
  const cleaned = slugline.replace(/^(INT\.|EXT\.|INT\/EXT\.|INT|EXT)\s+/i, "").trim();
  const head = cleaned.split(/\s+-\s+/)[0] ?? cleaned;
  if (!head) return "Scene";
  return head.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function breakDownScript(text: string): { scenes: BreakdownScene[] } {
  const lines = String(text ?? "").split("\n");
  const scenes: BreakdownScene[] = [];
  let actionBuffer: string[] = [];
  let shotNumber = 0;

  const active = (): BreakdownScene | undefined => scenes[scenes.length - 1];
  const startScene = (slugline: string) => {
    scenes.push({ slugline, title: titleFromSlugline(slugline), summary: "", shots: [] });
    shotNumber = 0;
  };
  const flushAction = () => {
    const action = actionBuffer.join(" ").replace(/\s+/g, " ").trim();
    actionBuffer = [];
    const sceneRef = active();
    if (!action || !sceneRef) return;
    shotNumber += 1;
    sceneRef.shots.push({
      title: `Shot ${shotNumber}`,
      action,
      dialogue: "",
      speakerName: "",
      framing: sceneRef.shots.length === 0 ? "Wide shot" : "Medium shot",
      durationSeconds: 5,
    });
    if (!sceneRef.summary) sceneRef.summary = action.slice(0, 160);
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (SLUGLINE_RE.test(line) && line.length <= 90) {
      flushAction();
      startScene(line);
      continue;
    }
    if (!active()) {
      if (!line) continue;
      startScene("OPENING");
    }
    if (CUE_RE.test(line) && line.length >= 2 && !/[.!?]$/.test(line)) {
      const next = (lines[i + 1] ?? "").trim();
      const after = (lines[i + 2] ?? "").trim();
      const dialogueStart = next && !next.startsWith("(") ? next : after;
      if (dialogueStart && !SLUGLINE_RE.test(dialogueStart)) {
        flushAction();
        const dialogueLines: string[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const d = lines[j].trim();
          if (!d) break;
          if (SLUGLINE_RE.test(d)) break;
          if (!d.startsWith("(")) dialogueLines.push(d);
          j += 1;
        }
        const dialogue = dialogueLines.join(" ").replace(/\s+/g, " ").trim();
        const sceneRef = active();
        if (dialogue && sceneRef) {
          shotNumber += 1;
          sceneRef.shots.push({
            title: `Shot ${shotNumber}`,
            action: `${titleFromSlugline(line)} speaks.`,
            dialogue,
            speakerName: titleFromSlugline(line),
            framing: "Medium close-up",
            durationSeconds: Math.max(3, Math.min(12, Math.round(dialogue.split(/\s+/).length / 2.5) || 4)),
          });
        }
        i = j - 1;
        continue;
      }
    }
    if (!line) {
      flushAction();
      continue;
    }
    actionBuffer.push(line);
  }
  flushAction();
  return { scenes: scenes.filter((s) => s.shots.length > 0 || s.slugline !== "OPENING") };
}

export function suggestPatches(input: {
  world: World;
  scenes: Scene[];
  shots: Shot[];
  entities: Entity[];
}): PatchSuggestion[] {
  const { scenes, shots, entities } = input;
  const out: PatchSuggestion[] = [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const sceneById = new Map(scenes.map((s) => [s.id, s]));

  for (const scene of scenes) {
    const inScene = shots.filter((s) => s.sceneId === scene.id);
    const speakers = new Set<string>();
    for (const s of inScene) if (s.speakerEntityId && s.dialogue.trim()) speakers.add(s.speakerEntityId);
    for (const speakerId of speakers) {
      const alone = inScene.some((s) => s.entityIds.length === 1 && s.entityIds[0] === speakerId);
      if (alone) continue;
      const speaker = byId.get(speakerId);
      if (!speaker) continue;
      out.push({
        id: `coverage:${scene.id}:${speakerId}`,
        kind: "coverage",
        title: `No single for ${speaker.name}`,
        detail: `${speaker.name} speaks in ${scene.title} but never appears alone. A close single gives the edit somewhere to land.`,
        sceneId: scene.id,
        draftShot: {
          title: `${speaker.name} single`,
          action: `${speaker.name} listens, then answers. Hold on the reaction before the line.`,
          framing: "Close-up",
          lens: "85mm",
          entityIds: [speakerId],
          dialogue: "",
          durationSeconds: 4,
          mode: "video",
        },
      });
    }
  }

  const castIds = new Set<string>();
  for (const s of shots) for (const id of s.entityIds) castIds.add(id);
  for (const id of castIds) {
    const entity = byId.get(id);
    if (!entity || entity.canonicalMediaIds.length) continue;
    out.push({
      id: `refs:${entity.id}`,
      kind: "references",
      title: `${entity.name} has no canonical views`,
      detail: "This cast member will be reinvented from text on every render until canonical references exist in the World Bible.",
    });
  }

  for (const shot of shots) {
    const scene = sceneById.get(shot.sceneId);
    if (!shot.framing.trim() && shot.dialogue.trim()) {
      out.push({
        id: `framing:${shot.id}`,
        kind: "framing",
        title: `Dialogue without a framing: ${shot.title}`,
        detail: shot.entityIds.length >= 2 ? "Two speakers in frame calls for a two-shot." : "A single speaker reads best closer in.",
        shotId: shot.id,
        sceneId: shot.sceneId,
        patch: { framing: shot.entityIds.length >= 2 ? "Two-shot" : "Close-up" },
      });
    }
    if (!shot.light.trim() && !(scene?.light.trim())) {
      out.push({
        id: `light:${shot.id}`,
        kind: "light",
        title: `No light described: ${shot.title}`,
        detail: "Neither the shot nor its scene names a light source. Continuity of light is decided here, not at render time.",
        shotId: shot.id,
        sceneId: shot.sceneId,
      });
    }
    if (!shot.action.trim()) {
      out.push({
        id: `action:${shot.id}`,
        kind: "action",
        title: `Shot has no action: ${shot.title}`,
        detail: "The compiler has nothing to direct. One sentence of action beats a page of adjectives.",
        shotId: shot.id,
        sceneId: shot.sceneId,
      });
    }
    if (shot.dialogue.trim() && shot.speakerEntityId) {
      const speaker = byId.get(shot.speakerEntityId);
      if (speaker && speaker.kind === "character" && !speaker.voiceId) {
        out.push({
          id: `voice:${shot.id}`,
          kind: "voice",
          title: `${speaker.name} has no voice cast`,
          detail: "Dialogue is written but the character has no voice in the World Bible, so lines cannot be voiced consistently.",
          shotId: shot.id,
          sceneId: shot.sceneId,
        });
      }
    }
  }
  return out;
}

export interface FilmForecast {
  total: number;
  label: string;
  scenes: { sceneId: string; title: string; units: number; shots: number }[];
}

export function forecastFilm(world: World, scenes: Scene[], shots: Shot[], entities: Entity[]): FilmForecast {
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const grouped = new Map<string, { sceneId: string; title: string; units: number; shots: number }>();
  let total = 0;
  for (const shot of shots) {
    const scene = sceneById.get(shot.sceneId);
    if (!scene) continue;
    const compiled = compileShot({ world, scene, shot, entities });
    const units = estimateUnits(compiled.spec);
    total += units;
    const row = grouped.get(scene.id) ?? { sceneId: scene.id, title: scene.title, units: 0, shots: 0 };
    row.units = Math.round((row.units + units) * 10) / 10;
    row.shots += 1;
    grouped.set(scene.id, row);
  }
  const ordered = scenes
    .map((s) => grouped.get(s.id))
    .filter(Boolean) as { sceneId: string; title: string; units: number; shots: number }[];
  return { total: Math.round(total * 10) / 10, label: "relative estimate, not Token Plan billing", scenes: ordered };
}

export function driftScore(paletteDistanceValue: number | undefined, coverageRatio: number): number {
  const coverage = Math.min(1, Math.max(0, coverageRatio));
  if (paletteDistanceValue === undefined) return Math.round(coverage * 1000) / 1000;
  const distance = Math.min(1, Math.max(0, paletteDistanceValue));
  return Math.round(((1 - distance) * 0.7 + coverage * 0.3) * 1000) / 1000;
}


