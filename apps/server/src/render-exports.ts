import type { FilmRenderGraph, LocalExport } from "@qstudio/core";
import { emit } from "./events";
import { discardMediaAsset, renderFilmPreview } from "./media";
import { uid } from "./store";

const localExports = new Map<string, LocalExport>();
const queue: string[] = [];
const controllers = new Map<string, AbortController>();
let activeId: string | null = null;

function trimHistory() {
  const finished = [...localExports.values()]
    .filter((item) => item.status !== "queued" && item.status !== "running")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const item of finished.slice(20)) localExports.delete(item.id);
}

export function listLocalExports(): LocalExport[] {
  return [...localExports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getLocalExport(id: string): LocalExport | undefined {
  return localExports.get(id);
}

function isExportCanceled(id: string): boolean {
  return localExports.get(id)?.status === "canceled";
}

export function startLocalExport(worldId: string, title: string, graph: FilmRenderGraph): LocalExport {
  const created: LocalExport = {
    id: uid("exp"),
    worldId,
    title,
    status: "queued",
    progress: 0,
    graph,
    skipped: [],
    createdAt: new Date().toISOString(),
  };
  localExports.set(created.id, created);
  queue.push(created.id);
  emit({ type: "export", localExport: created });
  pump();
  return created;
}

export function cancelLocalExport(id: string): LocalExport | undefined {
  const item = localExports.get(id);
  if (!item) return undefined;
  if (item.status === "queued") {
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
  }
  controllers.get(id)?.abort();
  if (item.status === "queued" || item.status === "running") {
    item.status = "canceled";
    item.finishedAt = new Date().toISOString();
    emit({ type: "export", localExport: { ...item } });
  }
  return item;
}

function settle(item: LocalExport, patch: Partial<LocalExport>) {
  if (item.status === "canceled") return;
  Object.assign(item, patch);
  emit({ type: "export", localExport: { ...item } });
}

async function run(id: string) {
  const item = localExports.get(id);
  if (!item || item.status !== "queued") return;
  item.status = "running";
  item.startedAt = new Date().toISOString();
  item.progress = 0;
  emit({ type: "export", localExport: { ...item } });
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const { asset, skipped } = await renderFilmPreview(item.graph, {
      signal: controller.signal,
      onProgress: (progress, note) => {
        if (controller.signal.aborted || item.status === "canceled") return;
        item.progress = Math.max(0, Math.min(0.99, progress));
        item.note = note;
        emit({ type: "export", localExport: { ...item } });
      },
    });
    if (controller.signal.aborted || isExportCanceled(id)) {
      discardMediaAsset(asset.id);
      throw new DOMException("Aborted", "AbortError");
    }
    settle(item, {
      status: "succeeded",
      progress: 1,
      mediaId: asset.id,
      skipped,
      note: undefined,
      error: undefined,
      finishedAt: new Date().toISOString(),
    });
    emit({ type: "media" });
  } catch (err) {
    if (controller.signal.aborted || (err as Error).name === "AbortError") {
      settle(item, {
        status: "canceled",
        finishedAt: new Date().toISOString(),
        error: undefined,
      });
    } else {
      settle(item, {
        status: "failed",
        error: (err as Error).message || "Preview export failed.",
        finishedAt: new Date().toISOString(),
      });
    }
  } finally {
    controllers.delete(id);
    if (activeId === id) activeId = null;
    trimHistory();
    pump();
  }
}

function pump() {
  if (activeId) return;
  while (queue.length) {
    const id = queue.shift()!;
    const item = localExports.get(id);
    if (!item || item.status !== "queued") continue;
    activeId = id;
    void run(id);
    return;
  }
}
