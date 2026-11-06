import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Camera,
  ChevronsLeftRight,
  Copy,
  Download,
  Expand,
  FolderOpen,
  Image as ImageIcon,
  Images,
  Link2,
  MoreHorizontal,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { estimateSeconds, frameTimes, getModel, parseSize } from "@core";
import type { Job, JobAsset } from "@core";
import { useApp } from "../store";
import { api, downloadUrl, frameUrl } from "../api";
import { cn, copyText, elapsed, fmtBytes, fmtDuration, statusMeta } from "../lib";
import { Aperture, Button, Empty, IconButton, Spinner, Tip, useTick } from "../ui";
import { Img, VideoPlayer, Waveform } from "./Media";

function frameRatio(job: Job): string {
  if (job.mode === "image") {
    const { width, height } = parseSize(job.spec.size || "1024*1024");
    return `${width ?? 1} / ${height ?? 1}`;
  }
  if (job.mode === "video") {
    const r = job.spec.ratio === "adaptive" ? "16:9" : job.spec.ratio || "16:9";
    const [w, h] = r.split(":").map(Number);
    return `${w || 16} / ${h || 9}`;
  }
  return "16 / 7";
}

async function downloadAsset(asset: JobAsset) {
  const a = document.createElement("a");
  a.href = downloadUrl(asset.id);
  a.download = asset.filePath.split("/").pop() || "asset";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function Menu({
  items,
  onClose,
}: {
  items: { label: string; icon?: React.ReactNode; onClick: () => void; disabled?: boolean; divider?: boolean }[];
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-0 z-50 mb-1.5 w-[212px] overflow-hidden rounded-xl border border-[var(--line-2)] bg-[var(--panel-2)] p-1 shadow-2xl">
        {items.map((it, i) =>
          it.divider ? (
            <div key={i} className="my-1 h-px bg-[var(--line)]" />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => {
                it.onClick();
                onClose();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors",
                it.disabled ? "opacity-35" : "hover:bg-[var(--panel-3)]"
              )}
            >
              <span className="text-[var(--muted)]">{it.icon}</span>
              {it.label}
            </button>
          )
        )}
      </div>
    </>
  );
}

function VideoStage({ asset, job }: { asset: JobAsset; job: Job }) {
  const app = useApp();
  const ref = useRef<HTMLVideoElement>(null);
  const [grabbing, setGrabbing] = useState(false);

  const grab = async () => {
    const el = ref.current;
    const media = app.media.find((m) => m.id === asset.id);
    if (!el || !media) return app.toast("The video is not ready yet.", "err");
    setGrabbing(true);
    try {
      await app.grabFrame(media, el.currentTime, "reference");
    } finally {
      setGrabbing(false);
    }
  };

  const media = app.media.find((m) => m.id === asset.id);
  const strip = frameTimes(asset.durationSeconds ?? 0, 6);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <VideoPlayer videoRef={ref} src={asset.url} poster={asset.thumb} className="max-h-[calc(100vh-330px)] w-full rounded-xl" />
      {media && strip.length > 1 && (
        <div className="flex gap-1.5" aria-label="Frame strip">
          {strip.map((at) => (
            <button
              key={at}
              className="thumb-frame h-11 w-20"
              title={`Use frame at ${at}s as reference`}
              aria-label={`Use frame at ${at} seconds as reference`}
              onClick={() => void app.grabFrame(media, at, "reference")}
            >
              <img src={frameUrl(media.id, at)} alt={`Frame at ${at}s`} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void grab()} disabled={grabbing}>
          <Camera size={12} /> {grabbing ? "Capturing…" : "Grab current frame"}
        </Button>
        {media && (
          <Button size="sm" variant="ghost" onClick={() => void app.grabFrame(media, "last", "first_frame")}>
            Chain: last frame → next first frame
          </Button>
        )}
        {media && (
          <Button size="sm" variant="ghost" onClick={() => app.extendClip(media)}>
            Extend this clip
          </Button>
        )}
        <span className="mono text-[9.5px] text-[var(--faint)]">
          {asset.width}×{asset.height} · {fmtDuration(asset.durationSeconds)}
        </span>
      </div>
    </div>
  );
}

export function Stage() {
  const app = useApp();
  useTick(1000);
  const [focus, setFocus] = useState(false);
  const [menu, setMenu] = useState(false);
  const [compare, setCompare] = useState(false);

  const job = useMemo(
    () => app.jobs.find((j) => j.id === app.activeJobId) ?? app.jobs[0],
    [app.jobs, app.activeJobId]
  );
  const asset = job?.assets[app.activeAssetIndex] ?? job?.assets[0];
  const model = job ? getModel(job.modelId) : null;
  const running = job?.status === "running" || job?.status === "queued";
  const [lo, hi] = job ? estimateSeconds(getModel(job.modelId), job.spec) : [0, 0];

  useEffect(() => {
    if (!job) return;
    if (job.assets.length && app.activeAssetIndex >= job.assets.length) app.setActiveAsset(0);
  }, [job?.id, job?.assets.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (focus && e.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  if (!job) {
    const starters = app.prompts.slice(0, 3);
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-[560px] text-center">
          <div className="mb-5 flex justify-center opacity-80">
            <Aperture size={62} />
          </div>
          <h2 className="serif serif-display text-[26px]">Nothing developed yet.</h2>
          <p className="mx-auto mt-2 max-w-[410px] text-[13px] leading-relaxed text-[var(--muted)]">
            Use Compose to start with a prompt, or drop an image to begin from a reference. Everything you
            make is saved to disk with its path attached.
          </p>
          {starters.length > 0 && (
            <div className="mt-7 text-left">
              <div className="label mb-2 text-center">Start from a saved prompt</div>
              <div className="grid gap-1.5">
                {starters.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => app.applyPrompt(p)}
                    className="card flex items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="text-[var(--faint)]">
                      {p.mode === "video" ? <Square size={12} /> : p.mode === "audio" ? <Sparkles size={12} /> : <ImageIcon size={12} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px]">{p.title}</span>
                      <span className="mono block text-[9.5px] text-[var(--faint)]">{p.modelId}</span>
                    </span>
                    <ArrowUpRight size={12} className="text-[var(--faint)]" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-7 flex items-center justify-center gap-2 text-[11px] text-[var(--faint)]">
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
            <span>to generate</span>
          </div>
        </div>
      </div>
    );
  }

  const meta = statusMeta(job.status);
  const media = asset ? app.media.find((m) => m.id === asset.id) : undefined;
  const firstRef = job.spec.refs[0] ? app.media.find((m) => m.id === job.spec.refs[0].mediaId) : undefined;

  const send = (role: "reference" | "first_frame" | "last_frame" | "audio") => {
    if (!media) return;
    if (role === "first_frame" || role === "last_frame") {
      if (app.activeMode !== "video") app.setMode("video");
      app.addRefs([media], role);
    } else if (role === "audio") {
      if (app.activeMode !== "video") app.setMode("video");
      app.addRefs([media], "audio");
    } else {
      if (app.activeMode === "video") app.setMode("image");
      app.addRefs([media], "reference");
    }
    app.toast("Sent to the composer.", "ok");
  };

  const stageInner = (
    <div className="flex h-full min-h-0 flex-col">
      {/* job strip */}
      <div className="flex h-11 flex-none items-center gap-2.5 border-b border-[var(--line)] px-4">
        <span className={meta.dot} />
        <span className={cn("text-[11.5px] font-medium", meta.text)}>{meta.label}</span>
        {job.statusNote && <span className="truncate text-[11px] text-[var(--faint)]">{job.statusNote}</span>}
        <span className="mono ml-auto hidden max-w-[150px] truncate text-[9.5px] text-[var(--faint)] lg:block">{model?.label}</span>
        <span className="mono text-[9.5px] text-[var(--faint)]">{elapsed(job.startedAt ?? job.createdAt, job.finishedAt)}</span>
        {running && (
          <button className="btn btn-sm" onClick={() => void app.cancelJob(job.id)}>
            <Square size={10} /> Cancel
          </button>
        )}
        <IconButton label={app.inspectorOpen ? "Hide inspector" : "Show inspector"} onClick={app.toggleInspector} active={app.inspectorOpen}>
          <ChevronsLeftRight size={15} />
        </IconButton>
      </div>

      {/* canvas */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5"
        style={{
          background:
            "radial-gradient(58% 46% at 50% 38%, color-mix(in srgb, var(--accent) 4%, transparent), transparent 72%)",
        }}
      >
        <div
          className="relative flex max-h-full w-full items-center justify-center"
          style={{ aspectRatio: running || !asset ? frameRatio(job) : undefined, maxWidth: "100%" }}
        >
          {running && (
            <div
              className="shimmer relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--line)]"
              style={{ aspectRatio: frameRatio(job), maxHeight: "calc(100vh - 250px)", maxWidth: "100%" }}
            >
              <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
                <Spinner size={22} />
                <div className="serif text-[18px]">{job.status === "queued" ? "Waiting for a slot" : "Developing"}</div>
                <div className="mono text-[10.5px] text-[var(--muted)]">
                  {elapsed(job.startedAt ?? job.createdAt)} · usually {lo}–{hi}s
                </div>
                <div className="max-w-[280px] text-[11.5px] leading-relaxed text-[var(--faint)]">{job.statusNote}</div>
              </div>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                <span className="chip">{job.demo ? "DEMO" : model?.id}</span>
              </div>
            </div>
          )}

          {!running && job.status === "failed" && (
            <div className="w-full max-w-[560px] rounded-xl border border-[var(--rose)] bg-[color-mix(in_srgb,var(--rose)_7%,var(--panel))] p-5">
              <div className="mono text-[9.5px] uppercase tracking-wider text-[var(--rose)]">
                {job.error?.code ?? "Generation failed"}
              </div>
              <div className="mt-2 text-[13.5px] leading-relaxed">{job.error?.message}</div>
              {job.error?.hint && (
                <div className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">{job.error.hint}</div>
              )}
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => app.setInspectorTab("request")}>
                  Inspect request
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    app.replayJob(job);
                    void app.generate();
                  }}
                >
                  <RefreshCw size={12} /> Retry
                </Button>
              </div>
            </div>
          )}

          {!running && job.status === "canceled" && (
            <Empty title="Canceled" sub="The task was stopped before it finished. Nothing was charged for unfinished work." />
          )}

          {!running && asset && (
            <div className="flex h-full w-full items-center justify-center">
              {asset.kind === "image" && (
                <div className={cn("checker flex max-h-full items-center justify-center overflow-hidden rounded-xl border border-[var(--line)]")}>
                  <img
                    src={asset.url}
                    alt={job.prompt || "Generated image"}
                    className="max-h-[calc(100vh-250px)] max-w-full cursor-zoom-in object-contain"
                    onClick={() => setFocus(true)}
                  />
                </div>
              )}
              {asset.kind === "video" && <VideoStage asset={asset} job={job} />}
              {asset.kind === "audio" && (
                <div className="w-full max-w-[620px] rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
                  <div className="label mb-3">Speech</div>
                  <Waveform src={asset.url} seed={asset.id} />
                  <div className="mt-5 max-h-[180px] overflow-auto text-[13px] leading-relaxed text-[var(--muted)]">
                    {job.prompt}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {compare && firstRef && asset && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] p-6">
            <div className="grid max-h-full grid-cols-2 gap-3">
              <div className="flex flex-col items-center gap-2">
                <span className="label">Input</span>
                <img src={firstRef.url} alt="Input" className="max-h-[60vh] rounded-lg border border-[var(--line)] object-contain" />
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="label">Output</span>
                <img src={asset.url} alt="Output" className="max-h-[60vh] rounded-lg border border-[var(--line)] object-contain" />
              </div>
            </div>
            <button className="absolute right-5 top-5" onClick={() => setCompare(false)}>
              <IconButton label="Close compare">
                <X size={16} />
              </IconButton>
            </button>
          </div>
        )}
      </div>

      {/* filmstrip */}
      {job.assets.length > 1 && (
        <div className="flex flex-none gap-2 overflow-x-auto border-t border-[var(--line)] px-4 py-2.5">
          {job.assets.map((a, i) => (
            <button
              key={a.id}
              onClick={() => app.setActiveAsset(i)}
              className={cn(
                "thumb-frame h-12 w-12 flex-none",
                i === app.activeAssetIndex && "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg)]"
              )}
            >
              <Img src={a.thumb} alt={`Variant ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* output bar */}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line)] px-4 py-2.5">
        {asset ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5">
              <FolderOpen size={11} className="flex-none text-[var(--faint)]" />
              <span className="mono truncate text-[10.5px] text-[var(--muted)]" title={asset.filePath}>
                {asset.filePath.replace(/^.*\/(images|videos|audio|references)\//, "$1/")}
              </span>
              <Tip text="Copy full path">
                <button
                  className="icon-btn h-6 w-6"
                  aria-label="Copy full path"
                  onClick={async () => {
                    if (await copyText(asset.filePath)) app.toast("Path copied.", "ok");
                  }}
                >
                  <Copy size={10} />
                </button>
              </Tip>
              <Tip text="Reveal in Finder">
                <button
                  className="icon-btn h-6 w-6"
                  aria-label="Reveal in Finder"
                  onClick={() => void api.revealMedia(asset.id)}
                >
                  <ArrowUpRight size={10} />
                </button>
              </Tip>
            </div>
            <span className="mono text-[9.5px] text-[var(--faint)]">{fmtBytes(asset.bytes)}</span>
            {asset.kind === "image" && (
              <span className="mono text-[9.5px] text-[var(--faint)]">
                {asset.width}×{asset.height}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {asset.kind === "image" && firstRef && (
                <Button size="sm" variant="ghost" onClick={() => setCompare(true)}>
                  Compare
                </Button>
              )}
              <IconButton label="Focus" onClick={() => setFocus(true)}>
                <Expand size={14} />
              </IconButton>
              <IconButton label="Download a copy" onClick={() => void downloadAsset(asset)}>
                <Download size={14} />
              </IconButton>
              <div className="relative">
                <Button size="sm" onClick={() => setMenu((v) => !v)}>
                  <Send size={12} /> Send to <MoreHorizontal size={12} />
                </Button>
                {menu && (
                  <Menu
                    onClose={() => setMenu(false)}
                    items={[
                      {
                        label: "Use as reference",
                        icon: <Images size={13} />,
                        onClick: () => send("reference"),
                        disabled: !media,
                      },
                      ...(asset.kind === "image"
                        ? [
                            { label: "Use as first frame", icon: <ImageIcon size={13} />, onClick: () => send("first_frame"), disabled: !media },
                            { label: "Use as last frame", icon: <ImageIcon size={13} />, onClick: () => send("last_frame"), disabled: !media },
                          ]
                        : []),
                      ...(asset.kind === "audio"
                        ? [{ label: "Use as audio reference", icon: <Sparkles size={13} />, onClick: () => send("audio"), disabled: !media }]
                        : []),
                      { divider: true, label: "", onClick: () => {} },
                      {
                        label: "Copy source URL",
                        icon: <Link2 size={13} />,
                        onClick: async () => {
                          if (asset.sourceUrl) {
                            await copyText(asset.sourceUrl);
                            app.toast("Source URL copied — it expires 24h after generation.", "ok");
                          } else app.toast("This asset has no remote URL (demo or uploaded).");
                        },
                        disabled: !asset.sourceUrl,
                      },
                    ]}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <span className="mono text-[10px] text-[var(--faint)]">
            {new Date(job.createdAt).toLocaleString()} · {job.id}
          </span>
        )}
      </div>
    </div>
  );

  if (!focus) return stageInner;

  return (
    <>
      {stageInner}
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(4,4,5,0.94)] p-8"
        role="dialog"
        aria-modal="true"
        aria-label="Focus preview"
        onClick={() => setFocus(false)}
      >
        <button
          className="absolute right-6 top-6 text-[var(--muted)] hover:text-white"
          aria-label="Close focus preview"
          onClick={() => setFocus(false)}
        >
          <X size={20} />
        </button>
        {asset?.kind === "image" && <img src={asset.url} alt={job.prompt} className="max-h-full max-w-full object-contain" />}
        {asset?.kind === "video" && (
          <div onClick={(e) => e.stopPropagation()}>
            <VideoPlayer src={asset.url} poster={asset.thumb} className="max-h-[90vh] rounded-xl" />
          </div>
        )}
        {asset?.kind === "audio" && (
          <div className="w-[min(720px,90vw)] rounded-xl border border-[var(--line-2)] bg-[var(--panel)] p-6" onClick={(e) => e.stopPropagation()}>
            <Waveform src={asset.url} seed={asset.id} />
          </div>
        )}
      </div>
    </>
  );
}
