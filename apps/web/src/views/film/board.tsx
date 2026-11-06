import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Clapperboard, Film as FilmIcon, Gauge, Lightbulb, Link2, Mic, Play, Plus, Trash2, X } from "lucide-react";
import { filmGraphSummary, staleReasons } from "@core";
import type { Entity, FilmForecast, FilmRenderGraph, PatchSuggestion, Scene, Shot, World } from "@core";
import { useApp } from "../../store";
import { api } from "../../api";
import { Button, CopyButton, Empty, IconButton, Modal, Spinner } from "../../ui";
import { Img, KindGlyph } from "../../components/Media";
import { cn, fmtDuration, statusMeta, truncate } from "../../lib";
import { BlurInput, PaletteField, byOrder, fmtTimelineDuration, selectedTakeOf, shotTimelineSeconds, takeJob } from "./shared";
import { CutPlayer } from "./player";

export function ShotBoard({
  world,
  scenes,
  shots,
  entities,
}: {
  world: World;
  scenes: Scene[];
  shots: Shot[];
  entities: Entity[];
}) {
  const app = useApp();
  const [inspectOpen, setInspectOpen] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  const worldExports = app.exports.filter((item) => item.worldId === world.id).slice(0, 3);
  const activeExport = worldExports.find((item) => item.status === "queued" || item.status === "running");
  return (
    <section className="scroll min-h-0 flex-1 px-5 py-4">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 className="serif text-[21px] leading-tight">{world.title}</h2>
        {world.logline && <span className="max-w-[560px] text-[12px] text-[var(--muted)]">{world.logline}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={() => void app.createScene(world.id, { title: "New scene" })}>
            <Plus size={12} /> Scene
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setInspectOpen(true)}>
            <Gauge size={12} /> Inspect cut
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPlayOpen(true)}>
            <Play size={12} /> Play cut
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!!activeExport}
            onClick={() => void app.previewFilm(world.id)}
          >
            <FilmIcon size={12} /> {activeExport ? "Export running…" : "Export preview"}
          </Button>
        </span>
      </div>
      <RenderGraphModal world={world} open={inspectOpen} onClose={() => setInspectOpen(false)} />
      <CutPlayer
        world={world}
        scenes={scenes}
        shots={shots}
        open={playOpen}
        onClose={() => setPlayOpen(false)}
      />
      {worldExports.length > 0 && (
        <div className="mb-4 flex flex-col gap-1.5">
          {worldExports.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2.5 py-1.5"
            >
              <span className="mono w-14 flex-none text-[9px] uppercase tracking-wider text-[var(--faint)]">
                {item.status}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mb-1 block truncate text-[10.5px] text-[var(--muted)]">
                  {item.error ?? item.note ?? `${item.graph.clips.length} clips · ${item.title}`}
                </span>
                <span className="block h-1 overflow-hidden rounded-full bg-[var(--panel-3)]">
                  <span
                    className="block h-full transition-[width]"
                    style={{
                      width: `${Math.round(item.progress * 100)}%`,
                      background: item.status === "failed" ? "var(--rose)" : "var(--accent)",
                    }}
                  />
                </span>
              </span>
              {(item.status === "queued" || item.status === "running") && (
                <Button size="sm" variant="ghost" onClick={() => void app.cancelExport(item.id)}>
                  Cancel
                </Button>
              )}
              {item.status === "succeeded" && item.mediaId && (
                <Button size="sm" variant="ghost" onClick={() => app.setView("library")}>
                  Open
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <CopilotPanel world={world} scenes={scenes} shots={shots} entities={entities} />
      {!scenes.length && (
        <Empty
          icon={<Clapperboard size={30} />}
          title="No scenes yet"
          sub="Paste a script on the left and break it down, or add a scene and direct shot by shot."
        />
      )}
      <div className="flex flex-col gap-6">
        {scenes.map((scene, sceneIndex) => (
          <SceneBlock
            key={scene.id}
            world={world}
            scene={scene}
            scenes={scenes}
            sceneIndex={sceneIndex}
            shots={byOrder(shots.filter((s) => s.sceneId === scene.id))}
            entities={entities}
          />
        ))}
      </div>
    </section>
  );
}

function SceneBlock({
  world,
  scene,
  scenes,
  sceneIndex,
  shots,
  entities,
}: {
  world: World;
  scene: Scene;
  scenes: Scene[];
  sceneIndex: number;
  shots: Shot[];
  entities: Entity[];
}) {
  const app = useApp();
  const moveScene = (delta: number) => {
    const other = scenes[sceneIndex + delta];
    if (!other) return;
    void app.patchScene(scene.id, { order: other.order });
    void app.patchScene(other.id, { order: scene.order });
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-2">
        <span className="mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--faint)]">
          Scene {sceneIndex + 1}
        </span>
        <input
          key={scene.title}
          defaultValue={scene.title}
          aria-label="Scene title"
          className="serif w-[220px] bg-transparent text-[16px] outline-none"
          onBlur={(e) => {
            if (e.target.value !== scene.title) void app.patchScene(scene.id, { title: e.target.value });
          }}
        />
        <input
          key={scene.slugline}
          defaultValue={scene.slugline}
          aria-label="Scene slugline"
          placeholder="EXT. SOMEWHERE - NIGHT"
          className="mono w-[240px] bg-transparent text-[10px] uppercase tracking-[0.08em] text-[var(--muted)] outline-none"
          onBlur={(e) => {
            if (e.target.value !== scene.slugline) void app.patchScene(scene.id, { slugline: e.target.value });
          }}
        />
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton label="Move scene up" onClick={() => moveScene(-1)}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton label="Move scene down" onClick={() => moveScene(1)}>
            <ArrowDown size={13} />
          </IconButton>
          <Button size="sm" onClick={() => void app.createShot(scene.id)}>
            <Plus size={12} /> Shot
          </Button>
          <IconButton label="Delete scene" onClick={() => void app.deleteScene(scene.id)}>
            <Trash2 size={13} />
          </IconButton>
        </span>
      </div>
      <div className="mb-3 grid max-w-[760px] grid-cols-2 gap-2">
        <BlurInput
          label="Scene light"
          value={scene.light}
          placeholder="Inherited by shots with no light of their own."
          onCommit={(v) => void app.patchScene(scene.id, { light: v })}
        />
        <PaletteField
          label="Scene palette"
          value={scene.palette}
          onCommit={(next) => void app.patchScene(scene.id, { palette: next })}
        />
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {shots.map((shot, shotIndex) => (
          <ShotCard
            key={shot.id}
            world={world}
            scene={scene}
            shot={shot}
            shots={shots}
            shotIndex={shotIndex}
            entities={entities}
          />
        ))}
      </div>
      {!shots.length && <p className="text-[11.5px] text-[var(--faint)]">No shots in this scene yet.</p>}
    </div>
  );
}

function ShotCard({
  world,
  scene,
  shot,
  shots,
  shotIndex,
  entities,
}: {
  world: World;
  scene: Scene;
  shot: Shot;
  shots: Shot[];
  shotIndex: number;
  entities: Entity[];
}) {
  const app = useApp();
  const job = takeJob(shot, app.jobs);
  const asset = job?.assets[0];
  const meta = job ? statusMeta(job.status) : null;
  const stale = shot.continuesFromShotId ? [] : staleReasons(world, scene, shot, entities);
  const take = selectedTakeOf(shot);
  const active = app.activeShotId === shot.id;
  const moveShot = (delta: number) => {
    const other = shots[shotIndex + delta];
    if (!other) return;
    void app.patchShot(shot.id, { order: other.order });
    void app.patchShot(other.id, { order: shot.order });
  };
  return (
    <article className={cn("card group relative overflow-hidden", active && "border-[var(--accent)]")}>
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => app.setActiveShot(shot.id)}
        aria-current={active ? "true" : undefined}
      >
        <span className="thumb-frame block aspect-video w-full rounded-none border-0 border-b border-[var(--line)]">
          {asset ? (
            <Img src={asset.thumb ?? asset.url} alt="" />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--faint)]">
              <KindGlyph kind={shot.mode} size={20} />
              <span className="mono px-2 text-center text-[9px] uppercase tracking-[0.12em]">
                {shot.framing || "Unframed"} · animatic
              </span>
            </span>
          )}
        </span>
        <span className="flex flex-col gap-1.5 px-3 py-2.5">
          <span className="flex items-center gap-1.5">
            <span className="mono text-[9px] text-[var(--faint)]">{shotIndex + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{shot.title}</span>
            {shot.continuesFromShotId && (
              <span className="text-[var(--muted)]" title="Continues from an earlier shot">
                <Link2 size={11} />
              </span>
            )}
            <span className="chip flex-none">{shot.status}</span>
          </span>
          <span className="line-clamp-2 min-h-[30px] text-[11.5px] leading-snug text-[var(--muted)]">
            {shot.action || "No action written yet."}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            {meta && (
              <span className="chip">
                <span className={meta.dot} /> {meta.label}
              </span>
            )}
            <span className="chip">{fmtTimelineDuration(shotTimelineSeconds(shot))}</span>
            <span className="chip">{shot.takes.length} take{shot.takes.length === 1 ? "" : "s"}</span>
            {shot.audioMediaIds.length > 0 && (
              <span className="chip">
                <Mic size={9} /> {shot.audioMediaIds.length}
              </span>
            )}
            {take?.drift && <span className="chip chip-jade">drift {take.drift.score}</span>}
            {stale.length > 0 && <span className="chip chip-accent">Stale</span>}
          </span>
          {stale.length > 0 && (
            <span className="block text-[10.5px] leading-snug text-[var(--accent)]">{stale.join(" ")}</span>
          )}
        </span>
      </button>
      <span className="absolute right-2 top-2 z-10 flex rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] p-0.5 opacity-0 shadow-lg backdrop-blur transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label="Move shot earlier" onClick={() => moveShot(-1)}>
          <ArrowUp size={12} />
        </IconButton>
        <IconButton label="Move shot later" onClick={() => moveShot(1)}>
          <ArrowDown size={12} />
        </IconButton>
        <IconButton label="Render take" onClick={() => void app.renderShot(shot.id)}>
          <Play size={12} />
        </IconButton>
      </span>
    </article>
  );
}

function CopilotPanel({
  world,
  scenes,
  shots,
  entities,
}: {
  world: World;
  scenes: Scene[];
  shots: Shot[];
  entities: Entity[];
}) {
  const app = useApp();
  const [suggestions, setSuggestions] = useState<PatchSuggestion[]>([]);
  const [forecast, setForecast] = useState<FilmForecast | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const signature = useMemo(
    () =>
      [
        world.updatedAt,
        scenes.map((s) => s.updatedAt).join(),
        shots.map((s) => `${s.id}:${s.updatedAt}`).join(),
        entities.map((e) => `${e.id}:v${e.version}`).join(),
      ].join("|"),
    [world, scenes, shots, entities]
  );
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all([api.suggestions(world.id), api.forecastFilm(world.id)])
        .then(([s, f]) => {
          if (!live) return;
          setSuggestions(s.suggestions);
          setForecast(f);
        })
        .catch(() => {});
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [world.id, signature]);

  const visible = suggestions.filter((s) => !dismissed.has(s.id));
  return (
    <div className="panel mb-5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
          <Lightbulb size={13} className="text-[var(--accent)]" /> Director notes
        </span>
        <span className="text-[11px] text-[var(--faint)]">Proposals only. Applying one never renders anything.</span>
        {forecast && (
          <span className="chip ml-auto" title={forecast.label}>
            <Gauge size={10} /> Forecast {forecast.total} units · {forecast.label}
          </span>
        )}
      </div>
      {forecast && forecast.scenes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {forecast.scenes.map((row) => (
            <span key={row.sceneId} className="chip">
              {row.title}: {row.units}u / {row.shots} shots
            </span>
          ))}
        </div>
      )}
      {visible.length > 0 ? (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {visible.map((s) => (
            <div key={s.id} className="flex items-start gap-2 border-t border-[var(--line)] pt-2">
              <div className="min-w-0 flex-1">
                <button
                  className="text-left text-[12px] font-medium hover:text-[var(--accent)]"
                  onClick={() => s.shotId && app.setActiveShot(s.shotId)}
                  title={s.shotId ? "Open this shot" : undefined}
                >
                  {s.title}
                </button>
                <div className="text-[11.5px] leading-snug text-[var(--muted)]">{s.detail}</div>
                {s.patch?.framing && (
                  <div className="mono mt-0.5 text-[10px] text-[var(--faint)]">Patch: framing → {s.patch.framing}</div>
                )}
                {s.draftShot && (
                  <div className="mono mt-0.5 text-[10px] text-[var(--faint)]">
                    New shot: {s.draftShot.title} ({s.draftShot.framing})
                  </div>
                )}
              </div>
              {(s.patch || s.draftShot) && (
                <Button size="sm" className="flex-none" onClick={() => void app.applySuggestion(s)}>
                  <Check size={12} /> Apply
                </Button>
              )}
              <IconButton
                label="Dismiss note"
                onClick={() => setDismissed((prev) => new Set(prev).add(s.id))}
              >
                <X size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-[var(--muted)]">
          No notes. Coverage, light, framing, voices and canonical views all check out for now.
        </p>
      )}
      <p className="mono mt-2.5 text-[9.5px] leading-relaxed text-[var(--faint)]">
        Local lab: ffmpeg {app.tools.ffmpeg ? "ready" : "missing"} · captions not installed · identity embeddings not
        installed. Drafts stay free in demo mode. Unmeasured checks say so instead of guessing.
      </p>
    </div>
  );
}

function RenderGraphModal({ world, open, onClose }: { world: World; open: boolean; onClose: () => void }) {
  const [graph, setGraph] = useState<FilmRenderGraph | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    setGraph(null);
    api
      .renderGraph(world.id)
      .then((result) => {
        if (!alive) return;
        setGraph(result.graph);
        setSkipped(result.skipped);
      })
      .catch((err) => {
        if (alive) setError((err as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, world.id]);

  const summary = graph ? filmGraphSummary(graph) : null;
  const serialized = graph ? JSON.stringify(graph, null, 2) : "";
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={820}
      title="Inspect the cut"
      sub="The local ffmpeg graph for the current selected takes. Nothing renders until you click Export preview."
      footer={
        <>
          {graph && <CopyButton text={serialized} label="Copy graph JSON" small />}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {loading && (
        <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
          <Spinner size={13} /> Resolving takes and audio…
        </div>
      )}
      {error && <p className="text-[12px] text-[var(--rose)]">{error}</p>}
      {graph && summary && (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              ["Clips", String(summary.clips)],
              ["Duration", fmtDuration(summary.seconds)],
              ["Canvas", summary.resolution],
              ["Audio refs", String(summary.audioClips)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2">
                <div className="label mb-1">{label}</div>
                <div className="mono text-[12px]">{value}</div>
              </div>
            ))}
          </div>

          {skipped.length > 0 && (
            <p className="rounded-lg border border-[var(--amber)] px-3 py-2 text-[11.5px] text-[var(--amber)]">
              Skipped without a usable take: {skipped.join(", ")}
            </p>
          )}

          <div className="space-y-1.5">
            {graph.clips.map((clip, index) => (
              <div
                key={clip.id}
                className="flex items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2"
              >
                <span className="mono mt-0.5 w-6 flex-none text-[10px] text-[var(--faint)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">{clip.name}</span>
                  <span className="mono mt-0.5 block truncate text-[9.5px] text-[var(--faint)]">
                    {clip.kind} · {fmtDuration(clip.durationSeconds)}
                    {clip.trimIn ? ` · in ${clip.trimIn}s` : ""}
                    {clip.trimOut ? ` · out ${clip.trimOut}s` : ""}
                    {clip.hasAudio ? " · native audio" : ""}
                  </span>
                </span>
                <span className="mono flex-none text-[9.5px] text-[var(--muted)]">
                  {clip.audio.length
                    ? `${clip.audio.length} audio · ${Math.round(clip.audio[0].gain * 100)}%`
                    : "silent"}
                </span>
              </div>
            ))}
          </div>

          <details className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)]">
            <summary className="cursor-pointer px-3 py-2 text-[11.5px] text-[var(--muted)]">Graph JSON</summary>
            <pre className="mono max-h-[300px] overflow-auto border-t border-[var(--line)] px-3 py-2 text-[9.5px] leading-relaxed text-[var(--muted)]">
              {serialized}
            </pre>
          </details>
        </div>
      )}
    </Modal>
  );
}
