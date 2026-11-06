import { useState } from "react";
import { ArrowUpRight, ChevronRight, Copy, FolderOpen, KeyRound, RotateCcw, Square, X } from "lucide-react";
import { toCurl } from "@core";
import { useApp } from "../store";
import { api } from "../api";
import { cn, copyText, elapsed, fmtBytes, fmtDate, fmtDuration, statusMeta, timeAgo } from "../lib";
import { Button, CopyButton, Empty, Spinner, useTick } from "../ui";
import { Img } from "./Media";

function Tab({ id, label, count }: { id: string; label: string; count?: number }) {
  const app = useApp();
  const on = app.inspectorTab === id;
  return (
    <button
      onClick={() => app.setInspectorTab(id as any)}
      className={cn(
        "relative flex h-10 flex-1 items-center justify-center gap-1.5 text-[11.5px] transition-colors",
        on ? "text-[var(--paper)]" : "text-[var(--faint)] hover:text-[var(--muted)]"
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="mono rounded bg-[var(--panel-3)] px-1 text-[9px] text-[var(--muted)]">{count}</span>
      )}
      {on && <span className="absolute bottom-0 left-3 right-3 h-px bg-[var(--accent)]" />}
    </button>
  );
}

export function Inspector() {
  const app = useApp();
  useTick(1000);
  const job = app.jobs.find((j) => j.id === app.activeJobId) ?? app.jobs[0];
  const runningCount = app.jobs.filter((j) => j.status === "running" || j.status === "queued").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center border-b border-[var(--line)]">
        <Tab id="queue" label="Queue" count={runningCount} />
        <Tab id="request" label="Request" />
        <Tab id="details" label="Details" />
        <button
          className="icon-btn mr-1 h-7 w-7 flex-none"
          aria-label="Hide inspector"
          onClick={app.toggleInspector}
        >
          <X size={12} />
        </button>
      </div>

      <div className="scroll min-h-0 flex-1">
        {app.inspectorTab === "queue" && <Queue />}
        {app.inspectorTab === "request" && <Request />}
        {app.inspectorTab === "details" && <Details job={job} />}
      </div>
    </div>
  );
}

function Queue() {
  const app = useApp();
  if (!app.jobs.length) {
    return (
      <Empty
        title="The queue is empty"
        sub="Every job you run appears here with its task ID and a link to the saved file."
      />
    );
  }
  return (
    <div>
      {app.jobs.slice(0, 60).map((job) => {
        const meta = statusMeta(job.status);
        const active = job.id === app.activeJobId;
        return (
          <div
            key={job.id}
            className={cn(
              "group relative flex items-center border-b border-[var(--line)] transition-colors",
              active ? "bg-[var(--panel-2)]" : "hover:bg-[var(--panel)]"
            )}
          >
            <button
              type="button"
              onClick={() => app.setActiveJob(job.id)}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 pr-16 text-left"
            >
              <span className="thumb-frame h-9 w-9 flex-none">
                {job.assets[0]?.thumb || (job.assets[0]?.kind === "image" ? job.assets[0].url : undefined) ? (
                  <Img
                    src={job.assets[0].thumb ?? job.assets[0].url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    {job.status === "running" ? <Spinner size={11} /> : <span className={meta.dot} />}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] leading-snug">
                  {job.prompt || <span className="text-[var(--faint)]">No prompt</span>}
                </span>
                <span className="mono mt-0.5 flex items-center gap-1.5 text-[9px] text-[var(--faint)]">
                  <span className={meta.text}>{meta.label}</span>
                  <span>·</span>
                  <span>{job.modelId}</span>
                  <span>·</span>
                  <span>{timeAgo(job.createdAt)}</span>
                </span>
              </span>
            </button>
            <span className="absolute right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {(job.status === "running" || job.status === "queued") && (
                <button
                  type="button"
                  aria-label="Cancel job"
                  className="icon-btn h-6 w-6"
                  onClick={() => void app.cancelJob(job.id)}
                >
                  <Square size={9} />
                </button>
              )}
              {(job.status === "failed" || job.status === "canceled") && (
                <button
                  type="button"
                  aria-label="Retry job"
                  className="icon-btn h-6 w-6"
                  onClick={() => void app.retryJob(job.id)}
                >
                  <RotateCcw size={10} />
                </button>
              )}
              <ChevronRight size={11} className="flex-none text-[var(--faint)]" />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Request() {
  const app = useApp();
  const job = app.jobs.find((j) => j.id === app.activeJobId) ?? app.jobs[0];
  if (!job) return <Empty title="No job selected" sub="Run something to inspect the exact request." />;
  if (!job.request) {
    return (
      <Empty
        title="Not submitted yet"
        sub={
          app.settings.demoMode || !app.key.present
            ? "Demo mode composes the request but never sends it. Add a key in Settings to go live."
            : "The request appears the moment the job is picked up by the queue."
        }
      />
    );
  }

  const curl = toCurl(job.request as any);
  const body = JSON.stringify(job.request.body, null, 2);

  return (
    <div className="space-y-4 p-3">
      {(app.settings.demoMode || !app.key.present) && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--muted)]">
          Demo mode: this is the request that would be sent. No credits were used.
        </div>
      )}
      <div>
        <div className="label mb-1.5">Endpoint</div>
        <div className="flex items-start gap-2">
          <code className="mono min-w-0 flex-1 break-all rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--muted)]">
            POST {job.request.url}
          </code>
          <CopyButton text={job.request.url} label="" small />
        </div>
      </div>

      <div>
        <div className="label mb-1.5">Headers</div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2.5 py-2">
          <div className="mono flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
            <KeyRound size={9} />
            Authorization: Bearer{" "}
            <span className="text-[var(--muted)]">{app.key.prefix || "sk-sp-••••"}</span>
          </div>
          {Object.entries(job.request.headers).map(([k, v]) => (
            <div key={k} className="mono mt-1 text-[10px] text-[var(--muted)]">
              {k}: {v}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="label mb-0">Body</div>
          <CopyButton text={body} label="JSON" small />
        </div>
        <pre className="mono max-h-[46vh] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5 text-[9.5px] leading-[1.6] text-[var(--muted)]">
          {body}
        </pre>
      </div>

      <div>
        <div className="label mb-1.5">Reproduce in your agent</div>
        <div className="mb-1.5 text-[10.5px] leading-relaxed text-[var(--faint)]">
          The exact shell command. Run it in Claude Code, OpenCode or a terminal with your key exported as{" "}
          <span className="mono">$QSTUDIO_API_KEY</span>.
        </div>
        <CopyButton text={curl} label="Copy as cURL" />
      </div>
    </div>
  );
}

function Details({ job }: { job: any }) {
  const app = useApp();
  if (!job) return <Empty title="No job selected" />;
  const asset = job.assets[app.activeAssetIndex] ?? job.assets[0];

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] py-2 last:border-0">
      <span className="text-[10.5px] text-[var(--faint)]">{k}</span>
      <span className="mono max-w-[62%] break-all text-right text-[10px] text-[var(--muted)]">{v}</span>
    </div>
  );

  return (
    <div className="p-3">
      {job.demo && (
        <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--muted)]">
          Demo output. Turn off demo mode and add a key to use the real model.
        </div>
      )}
      <div className="label mb-1">Job</div>
      {row("ID", job.id)}
      {row("Model", job.modelId)}
      {row("Mode", job.mode)}
      {row("Status", statusMeta(job.status).label)}
      {row("Created", fmtDate(job.createdAt))}
      {job.taskId && row("Task ID", job.taskId)}
      {job.units !== undefined && row("Est. units", `${job.units} (${app.usage.label})`)}
      {job.startedAt && row("Elapsed", elapsed(job.startedAt, job.finishedAt))}
      {row("Spec", `${job.spec.aspect} · ${job.spec.size || `${job.spec.resolution} ${job.spec.ratio}`} · n${job.spec.n}`)}
      {job.spec.seed != null && row("Seed", String(job.spec.seed))}
      {job.spec.seed != null && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              app.replayJob(job);
              app.patchSpec({ seed: job.spec.seed });
              app.setSeedLocked(true);
              app.toast("Seed locked for the next runs.", "ok");
            }}
          >
            Reuse this seed (locked)
          </Button>
        </div>
      )}

      {asset && (
        <>
          <div className="label mb-1 mt-5">File</div>
          {row("Name", asset.filePath.split("/").pop())}
          {row("Size", fmtBytes(asset.bytes))}
          {asset.width && row("Dimensions", `${asset.width}×${asset.height}`)}
          {asset.durationSeconds && row("Duration", fmtDuration(asset.durationSeconds))}
          {row("Path", asset.filePath)}
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" onClick={() => void api.revealMedia(asset.id)}>
              <FolderOpen size={11} /> Reveal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyText(asset.filePath)}>
              <Copy size={11} /> Copy path
            </Button>
          </div>
          {asset.sourceUrl && (
            <>
              <div className="label mb-1 mt-5">Source URL</div>
              <div className="break-all text-[9.5px] leading-relaxed text-[var(--faint)]">{asset.sourceUrl}</div>
              <div className="mt-1 text-[10px] text-[var(--amber)]">Expires 24h after generation.</div>
            </>
          )}
        </>
      )}

      {job.error && (
        <>
          <div className="label mb-1 mt-5 text-[var(--rose)]">Error</div>
          <div className="text-[11px] leading-relaxed text-[var(--muted)]">{job.error.message}</div>
        </>
      )}

      <div className="mt-5 flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => void api.openOutput()}>
          <ArrowUpRight size={11} /> Open output folder
        </Button>
      </div>
    </div>
  );
}
