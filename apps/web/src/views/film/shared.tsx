import { normalizePalette } from "@core";
import type { Job, Shot } from "@core";
import { Input, Label, Textarea } from "../../ui";

export function byOrder<T extends { order: number; createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function shotTimelineSeconds(shot: Shot): number {
  if (shot.mode === "video" && shot.trimOut !== undefined && shot.trimOut > (shot.trimIn ?? 0)) {
    return shot.trimOut - (shot.trimIn ?? 0);
  }
  return Math.max(0.1, shot.durationSeconds || 3);
}

export function fmtTimelineDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded < 60) return `${rounded.toFixed(1).replace(/\.0$/, "")}s`;
  const minutes = Math.floor(rounded / 60);
  const rest = Math.round((rounded % 60) * 10) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

export function selectedTakeOf(shot: Shot) {
  return shot.takes.find((t) => t.id === shot.selectedTakeId) ?? shot.takes[shot.takes.length - 1];
}

export function takeJob(shot: Shot, jobs: Job[]): Job | undefined {
  const take = selectedTakeOf(shot);
  return take ? jobs.find((j) => j.id === take.jobId) : undefined;
}

export function PaletteField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string[];
  onCommit: (next: string[]) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <div className="flex flex-none gap-1" aria-hidden>
          {(value.length ? value : ["transparent"]).map((hex, i) => (
            <span
              key={`${hex}-${i}`}
              className="h-5 w-5 rounded-md border border-[var(--line-2)]"
              style={{ background: hex }}
            />
          ))}
        </div>
        <Input
          key={value.join(",")}
          defaultValue={value.join(", ")}
          placeholder="#1F3A34, #E8E2D6"
          className="field-mono"
          aria-label={label}
          onBlur={(e) => {
            const next = normalizePalette(e.target.value.split(/[\s,]+/).filter(Boolean));
            if (JSON.stringify(next) !== JSON.stringify(value)) onCommit(next);
          }}
        />
      </div>
    </div>
  );
}

export function BlurInput({
  label,
  value,
  onCommit,
  placeholder,
  mono,
}: {
  label?: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <Input
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        className={mono ? "field-mono" : undefined}
        aria-label={label ?? placeholder}
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
      />
    </div>
  );
}

export function BlurArea({
  label,
  value,
  onCommit,
  placeholder,
  rows = 3,
}: {
  label?: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <Textarea
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        rows={rows}
        aria-label={label ?? placeholder}
        onBlur={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
        }}
      />
    </div>
  );
}
