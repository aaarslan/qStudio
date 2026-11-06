import crypto from "node:crypto";
import type { Job, LocalExport } from "@qstudio/core";

export interface AppEvent {
  type: string;
  job?: Job;
  jobId?: string;
  localExport?: LocalExport;
  revision: number;
  instanceId: string;
}

type Listener = (event: AppEvent) => void;

const listeners = new Set<Listener>();
export const eventInstanceId = crypto.randomUUID();
let revision = 0;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentRevision(): number {
  return revision;
}

export function emit(event: { type: string; job?: Job; jobId?: string; localExport?: LocalExport }) {
  const next: AppEvent = { ...event, revision: ++revision, instanceId: eventInstanceId };
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
    }
  }
}
