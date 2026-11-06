import { MODELS, defaultSpec, remapTokens } from "@core";
import type { Job, LocalExport, MediaAsset, Mode, ModelDef, RefRole } from "@core";
import type { Draft, RefItem } from "./types";
import { mediaUrl } from "../api";
import type { Store } from "./types";

export type StoreSet = (partial: Partial<Store>) => void;

export function fixMedia(m: MediaAsset): MediaAsset {
  return { ...m, url: mediaUrl(m.url ?? `/api/media/${m.id}/file`), thumb: m.thumb ? mediaUrl(m.thumb) : m.thumb };
}

export function fixJob(j: Job): Job {
  return {
    ...j,
    assets: j.assets.map((a) => ({ ...a, url: mediaUrl(a.url), thumb: a.thumb ? mediaUrl(a.thumb) : a.thumb })),
    spec: {
      ...j.spec,
      refs: j.spec.refs.map((r) => ({ ...r, thumb: r.thumb ? mediaUrl(r.thumb) : r.thumb })),
    },
  };
}

const DRAFTS_KEY = "qstudio.drafts.v1";

export function persistDrafts(drafts: Record<Mode, Draft>, varsByMode: Record<Mode, Record<string, string>>) {
  try {
    const clean: Record<string, Draft> = {};
    for (const mode of ["image", "video", "audio"] as Mode[]) {
      const draft = drafts[mode];
      clean[mode] = {
        spec: {
          ...draft.spec,
          refs: draft.spec.refs.map(({ thumb: _thumb, name: _name, ...ref }) => ref),
        },
        refs: draft.refs.map(({ thumb: _thumb, ...ref }) => ref),
        appliedPromptId: draft.appliedPromptId,
      };
    }
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ drafts: clean, varsByMode }));
  } catch {
  }
}

export function restoreDrafts(
  media: MediaAsset[]
): { drafts: Partial<Record<Mode, Draft>>; varsByMode?: Record<Mode, Record<string, string>> } {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "null") as {
      drafts?: Record<Mode, Draft>;
      varsByMode?: Record<Mode, Record<string, string>>;
    } | null;
    if (!raw?.drafts) return { drafts: {} };
    const drafts: Partial<Record<Mode, Draft>> = {};
    for (const mode of ["image", "video", "audio"] as Mode[]) {
      const saved = raw.drafts[mode];
      if (!saved?.spec) continue;
      const refs = (saved.refs ?? [])
        .map((r) => {
          const asset = media.find((m) => m.id === r.mediaId);
          return asset
            ? {
                mediaId: asset.id,
                role: r.role,
                name: asset.name,
                mime: asset.mime,
                kind: asset.kind,
                thumb: asset.thumb,
                width: asset.width,
                height: asset.height,
              }
            : null;
        })
        .filter(Boolean) as RefItem[];
      drafts[mode] = { spec: saved.spec, refs, appliedPromptId: saved.appliedPromptId };
    }
    return { drafts, varsByMode: raw.varsByMode };
  } catch {
    return { drafts: {} };
  }
}

export const confirmQueue: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (ok: boolean) => void;
}[] = [];
let lastSubmitAt = 0;
let lastSubmitFingerprint = "";
const renderInFlight = new Set<string>();
const voiceInFlight = new Set<string>();
const previewInFlight = new Set<string>();


export function askConfirmDialog(
  set: StoreSet,
  title: string,
  body: string,
  confirmLabel = "Generate anyway",
  cancelLabel = "Not yet"
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const entry = { title, body, confirmLabel, cancelLabel, resolve };
    if (confirmQueue.length === 0) set({ pendingConfirm: { title, body, confirmLabel, cancelLabel } });
    confirmQueue.push(entry);
  });
}

export async function withCapRetry<T>(
  set: StoreSet,
  attempt: (force: boolean) => Promise<T>,
  verb: string
): Promise<T | null> {
  try {
    return await attempt(false);
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    if (code !== "CAP" && code !== "DUPLICATE") throw err;
    const ok = await askConfirmDialog(
      set,
      code === "CAP" ? "Monthly soft cap" : "Already running",
      `${(err as Error).message} ${verb} anyway?`
    );
    if (!ok) return null;
    return attempt(true);
  }
}

export function modelForMode(mode: Mode): ModelDef {
  return MODELS.find((m) => m.mode === mode)!;
}

export function draftFor(model: ModelDef): Draft {
  return { spec: defaultSpec(model), refs: [] };
}

export function pruneRefs(refs: RefItem[], model: ModelDef): RefItem[] {
  const counts: Record<string, number> = {};
  const out: RefItem[] = [];
  for (const ref of refs) {
    const max =
      ref.role === "reference"
        ? model.refs.reference
        : ref.role === "audio"
          ? model.refs.audio
          : 1;
    if ((counts[ref.role] ?? 0) >= max) continue;
    counts[ref.role] = (counts[ref.role] ?? 0) + 1;
    out.push(ref);
  }
  return out;
}

export function refImages(refs: RefItem[]) {
  return refs.filter((r) => r.role === "reference");
}

export function remapForRemoval(prompt: string, before: RefItem[], after: RefItem[]): string {
  const oldOrder = refImages(before).map((r) => r.mediaId);
  const newOrder = refImages(after).map((r) => r.mediaId);
  const map: Record<number, number | null> = {};
  oldOrder.forEach((id, i) => {
    const next = newOrder.indexOf(id);
    map[i + 1] = next === -1 ? null : next + 1;
  });
  return remapTokens(prompt, map);
}

export function upsertJob(jobs: Job[], job: Job): Job[] {
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i === -1) return [job, ...jobs];
  const copy = jobs.slice();
  copy[i] = job;
  return copy;
}

export function upsertExport(items: LocalExport[], item: LocalExport): LocalExport[] {
  const i = items.findIndex((entry) => entry.id === item.id);
  if (i === -1) return [item, ...items];
  const copy = items.slice();
  copy[i] = item;
  return copy;
}

export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
}
