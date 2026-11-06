import type { JobStatus } from "./types";

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "failed", "canceled"],
  running: ["queued", "succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "canceled"];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export function isActiveJobStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
