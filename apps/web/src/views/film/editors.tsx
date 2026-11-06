import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Gauge, Mic, Play, Trash2, X } from "lucide-react";
import { FRAMINGS, modelsForMode } from "@core";
import type { Entity, Scene, Shot, World } from "@core";
import { useApp } from "../../store";
import { api, type CompiledPreview } from "../../api";
import { Button, Empty, IconButton, Input, Label, Segmented, Select, Slider, Spinner, Stepper } from "../../ui";
import { Img, KindGlyph, VideoPlayer, Waveform } from "../../components/Media";
import { cn, truncate } from "../../lib";
import { BlurArea, BlurInput, byOrder, selectedTakeOf } from "./shared";

function AudioGainControl({ shot }: { shot: Shot }) {
  const app = useApp();
  const [value, setValue] = useState(shot.audioGain ?? 1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    setValue(shot.audioGain ?? 1);
    pending.current = null;
  }, [shot.id, shot.audioGain]);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const commit = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (Math.abs(value - (shot.audioGain ?? 1)) < 0.001 || pending.current === value) return;
    pending.current = value;
    const ok = await app.patchShot(shot.id, { audioGain: value });
    pending.current = null;
    if (!ok) setValue(shot.audioGain ?? 1);
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit(), 350);
  };
  return (
    <div className="panel px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--muted)]">Dialogue level</span>
        <span className="mono text-[9.5px] text-[var(--faint)]">{Math.round(value * 100)}%</span>
      </div>
      <div onPointerUp={() => void commit()} onKeyUp={schedule} onBlur={() => void commit()}>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={value}
          onChange={setValue}
          format={(amount) => `${Math.round(amount * 100)}%`}
          ariaLabel="Dialogue level for this shot"
        />
      </div>
      <p className="mt-1 text-[9.5px] leading-relaxed text-[var(--faint)]">
        Applies to every attached dialogue clip during preview export and cut playback.
      </p>
    </div>
  );
}

export function ShotEditor({
  world,
  scenes,
  shots,
  entities,
  onClose,
}: {
  world: World;
  scenes: Scene[];
  shots: Shot[];
  entities: Entity[];
  onClose?: () => void;
}) {
  const app = useApp();
  const shot = shots.find((s) => s.id === app.activeShotId) ?? null;
  if (!shot) {
    return (
      <aside className="flex w-[348px] max-w-full flex-none flex-col border-l border-[var(--line)] px-4 py-4">
        <div className="flex items-center gap-2">
          <Label className="mb-0">Shot</Label>
          {onClose && (
            <IconButton label="Close shot editor" className="ml-auto" onClick={onClose}>
              <X size={13} />
            </IconButton>
          )}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--muted)]">
          Pick a shot card or a timeline cell to direct it. Prompts are compiled from the world, the scene and the
          cast. You approve every render.
        </p>
      </aside>
    );
  }
  const scene = scenes.find((s) => s.id === shot.sceneId);
  const models = modelsForMode(shot.mode);
  const orderedFilm = scenes.flatMap((sc) => byOrder(shots.filter((s) => s.sceneId === sc.id)));
  const earlier = orderedFilm.slice(0, Math.max(0, orderedFilm.findIndex((s) => s.id === shot.id)));
  const characters = entities.filter((e) => e.kind === "character");
  return (
    <aside className="scroll flex w-[348px] max-w-full flex-none flex-col gap-3 border-l border-[var(--line)] px-4 py-4">
      <div className="flex items-center gap-1.5">
        <Label>Shot · {scene?.title ?? "Scene"}</Label>
        <span className="ml-auto flex">
          <IconButton label="Delete shot" onClick={() => void app.deleteShot(shot.id)}>
            <Trash2 size={13} />
          </IconButton>
          <IconButton label="Close editor" onClick={() => { app.setActiveShot(null); onClose?.(); }}>
            <X size={13} />
          </IconButton>
        </span>
      </div>
      <BlurInput value={shot.title} placeholder="Shot title" onCommit={(v) => void app.patchShot(shot.id, { title: v })} />
      <div>
        <Label htmlFor="shot-scene">Scene</Label>
        <Select
          id="shot-scene"
          aria-label="Shot scene"
          value={shot.sceneId}
          onChange={(event) => {
            const sceneId = event.target.value;
            if (sceneId === shot.sceneId) return;
            const order = shots.filter((item) => item.sceneId === sceneId).length;
            void app.patchShot(shot.id, { sceneId, order });
          }}
        >
          {scenes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </Select>
      </div>
      <Segmented
        value={shot.status}
        onChange={(v) => void app.patchShot(shot.id, { status: v })}
        options={[
          { id: "draft", label: "Draft" },
          { id: "approved", label: "Approved" },
          { id: "locked", label: "Locked" },
        ]}
      />
      <BlurArea
        label="Action"
        value={shot.action}
        rows={3}
        placeholder="What happens on screen, in one or two sentences."
        onCommit={(v) => void app.patchShot(shot.id, { action: v })}
      />
      <div className="flex flex-col gap-1.5">
        <BlurArea
          label="Dialogue"
          value={shot.dialogue}
          rows={2}
          placeholder="The line, exactly as spoken."
          onCommit={(v) => void app.patchShot(shot.id, { dialogue: v })}
        />
        <div className="flex gap-1.5">
          <Select
            value={shot.speakerEntityId ?? ""}
            aria-label="Speaker"
            onChange={(e) => void app.patchShot(shot.id, { speakerEntityId: e.target.value || undefined })}
          >
            <option value="">Speaker…</option>
            {characters.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Button size="sm" className="flex-none" disabled={!shot.dialogue.trim()} onClick={() => void app.voiceShot(shot.id)}>
            <Mic size={12} /> Voice line
          </Button>
        </div>
        {shot.audioMediaIds.map((id) => {
          const media = app.media.find((m) => m.id === id);
          if (!media) return null;
          return (
            <div key={id} className="panel px-2.5 py-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px]">{media.name}</span>
                <IconButton
                  label="Detach audio"
                  onClick={() =>
                    void app.patchShot(shot.id, { audioMediaIds: shot.audioMediaIds.filter((x) => x !== id) })
                  }
                >
                  <X size={12} />
                </IconButton>
              </div>
              <Waveform src={media.url ?? ""} seed={media.id} compact />
            </div>
          );
        })}
        {shot.audioMediaIds.length > 0 && <AudioGainControl shot={shot} />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Framing</Label>
          <Select
            value={FRAMINGS.includes(shot.framing) ? shot.framing : ""}
            aria-label="Framing"
            onChange={(e) => void app.patchShot(shot.id, { framing: e.target.value })}
          >
            <option value="">{shot.framing || "Choose…"}</option>
            {FRAMINGS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
        <BlurInput label="Lens" value={shot.lens} placeholder="35mm" onCommit={(v) => void app.patchShot(shot.id, { lens: v })} />
        <BlurInput label="Camera" value={shot.cameraMove} placeholder="Slow push in" onCommit={(v) => void app.patchShot(shot.id, { cameraMove: v })} />
        <BlurInput label="Light" value={shot.light} placeholder="Falls back to scene light" onCommit={(v) => void app.patchShot(shot.id, { light: v })} />
        <BlurInput label="Mood" value={shot.emotion} placeholder="Wary, controlled" onCommit={(v) => void app.patchShot(shot.id, { emotion: v })} />
        <div>
          <Label>Screen direction</Label>
          <Select
            value={shot.screenDirection}
            aria-label="Screen direction"
            onChange={(e) => void app.patchShot(shot.id, { screenDirection: e.target.value })}
          >
            <option value="">Not set</option>
            <option value="left-to-right">Left to right</option>
            <option value="right-to-left">Right to left</option>
            <option value="toward camera">Toward camera</option>
            <option value="away from camera">Away from camera</option>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Render as</Label>
          <Segmented
            value={shot.mode}
            onChange={(v) => {
              const first = modelsForMode(v)[0];
              void app.patchShot(shot.id, { mode: v, modelId: first?.id ?? shot.modelId });
            }}
            options={[
              { id: "video", label: "Video" },
              { id: "image", label: "Image" },
            ]}
          />
        </div>
        <div>
          <Label>Model</Label>
          <Select
            value={shot.modelId}
            aria-label="Shot model"
            onChange={(e) => void app.patchShot(shot.id, { modelId: e.target.value })}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Stepper
        label="Duration (s)"
        value={Math.round(shot.durationSeconds || 5)}
        min={1}
        max={30}
        onChange={(v) => void app.patchShot(shot.id, { durationSeconds: v })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Trim in (s)</Label>
          <Input
            key={String(shot.trimIn ?? "")}
            type="number"
            min={0}
            step={0.1}
            defaultValue={shot.trimIn ?? ""}
            aria-label="Trim in seconds"
            onBlur={(e) => void app.patchShot(shot.id, { trimIn: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
        <div>
          <Label>Trim out (s)</Label>
          <Input
            key={String(shot.trimOut ?? "")}
            type="number"
            min={0}
            step={0.1}
            defaultValue={shot.trimOut ?? ""}
            aria-label="Trim out seconds"
            onBlur={(e) => void app.patchShot(shot.id, { trimOut: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </div>
      </div>
      <div>
        <Label>Cast and setting</Label>
        <div className="flex flex-col gap-1">
          {entities.map((entity) => {
            const on = shot.entityIds.includes(entity.id);
            return (
              <label key={entity.id} className="flex cursor-pointer items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    void app.patchShot(shot.id, {
                      entityIds: on
                        ? shot.entityIds.filter((x) => x !== entity.id)
                        : [...shot.entityIds, entity.id],
                    })
                  }
                />
                <span className="flex-1">
                  {entity.name} <span className="text-[var(--faint)]">· {entity.kind}</span>
                </span>
                {!entity.canonicalMediaIds.length && <span className="mono text-[9px] text-[var(--accent)]">no refs</span>}
              </label>
            );
          })}
          {!entities.length && <span className="text-[11px] text-[var(--faint)]">The bible is empty.</span>}
        </div>
      </div>
      <div>
        <Label>Continues from</Label>
        <Select
          value={shot.continuesFromShotId ?? ""}
          aria-label="Continues from shot"
          onChange={(e) => void app.patchShot(shot.id, { continuesFromShotId: e.target.value || undefined })}
        >
          <option value="">Starts fresh</option>
          {earlier.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-[10.5px] leading-snug text-[var(--faint)]">
          Rendering grabs that shot last frame as this shot first frame.
        </p>
      </div>
      <CompilePanel world={world} shot={shot} entities={entities} />
      <TakesPanel shot={shot} />
    </aside>
  );
}

function CompilePanel({ world, shot, entities }: { world: World; shot: Shot; entities: Entity[] }) {
  const app = useApp();
  const [compiled, setCompiled] = useState<CompiledPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const signature = useMemo(
    () => [world.updatedAt, shot.updatedAt, entities.map((e) => `${e.id}:v${e.version}`).join()].join("|"),
    [world, shot, entities]
  );
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void api
        .compileShot(shot.id)
        .then((res) => {
          if (live) setCompiled(res);
        })
        .catch(() => {
          if (live) setCompiled(null);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [shot.id, signature]);

  return (
    <div className="panel px-3 py-3">
      <div className="flex items-center gap-2">
        <Label>Compiled prompt</Label>
        {loading && <Spinner size={10} />}
        {compiled && <span className="chip ml-auto">~{compiled.units} units</span>}
      </div>
      {compiled ? (
        <>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--muted)]">{compiled.prompt || "Empty. Add action or cast."}</p>
          {compiled.refs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {compiled.refs.map((r, i) => (
                <span key={`${r.mediaId}-${i}`} className="chip">
                  {r.role === "reference" ? `Image ${compiled.refs.filter((x) => x.role === "reference").indexOf(r) + 1}` : r.role}: {truncate(r.name, 20)}
                </span>
              ))}
            </div>
          )}
          <div className="mono mt-2 text-[9.5px] text-[var(--faint)]">
            ref coverage {compiled.coverage.ratio} · fingerprint {compiled.fingerprint}
          </div>
          {compiled.stale.length > 0 && (
            <p className="mt-1.5 text-[11px] leading-snug text-[var(--accent)]">Stale: {compiled.stale.join(" ")}</p>
          )}
          {compiled.warnings.map((w) => (
            <p key={w} className="mt-1 text-[11px] leading-snug text-[var(--amber)]">
              {w}
            </p>
          ))}
        </>
      ) : (
        <p className="mt-1.5 text-[11.5px] text-[var(--muted)]">{loading ? "Compiling…" : "Compile unavailable."}</p>
      )}
      <Button variant="primary" className="mt-3 w-full" disabled={shot.status === "locked"} onClick={() => void app.renderShot(shot.id)}>
        <Play size={13} /> Render take {shot.takes.length + 1}
      </Button>
      <p className="mt-1.5 text-center text-[10.5px] text-[var(--faint)]">
        One click, one job, in the capped queue. Demo mode spends nothing.
      </p>
    </div>
  );
}

function TakesPanel({ shot }: { shot: Shot }) {
  const app = useApp();
  const selected = selectedTakeOf(shot);
  const selectedJob = selected ? app.jobs.find((j) => j.id === selected.jobId) : undefined;
  const selectedAsset = selectedJob?.assets[0];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Label>Takes</Label>
        <Button size="sm" className="ml-auto" disabled={!shot.takes.length} onClick={() => void app.checkDrift(shot.id)}>
          <Gauge size={12} /> Check drift
        </Button>
      </div>
      {selectedAsset && selectedAsset.kind === "video" && (
        <VideoPlayer src={selectedAsset.url} poster={selectedAsset.thumb} className="w-full rounded-lg" />
      )}
      {selectedAsset && selectedAsset.kind === "image" && (
        <div className="thumb-frame w-full">
          <Img src={selectedAsset.url} alt={shot.title} />
        </div>
      )}
      {selectedAsset && selectedAsset.kind === "audio" && (
        <Waveform src={selectedAsset.url} seed={selectedAsset.id} compact />
      )}
      {!shot.takes.length && (
        <p className="text-[11.5px] text-[var(--muted)]">No takes yet. This shot is still an animatic card.</p>
      )}
      {[...shot.takes].reverse().map((take) => {
        const job = app.jobs.find((j) => j.id === take.jobId);
        const asset = job?.assets[0];
        const isSelected = selected?.id === take.id;
        return (
          <div key={take.id} className={cn("card px-2.5 py-2", isSelected && "border-[var(--accent)]")}>
            <div className="flex items-center gap-2">
              <span className="thumb-frame block h-9 w-14 flex-none">
                {asset ? <Img src={asset.thumb ?? asset.url} alt={take.label} /> : <KindGlyph kind={shot.mode} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium">{take.label}</span>
                <span className="mono block text-[9px] text-[var(--faint)]">
                  {job ? job.status : "job gone"}
                  {take.drift ? ` · drift ${take.drift.score}` : ""}
                  {take.verdict ? ` · ${take.verdict}` : ""}
                </span>
              </span>
              <Button
                size="sm"
                variant={isSelected ? "primary" : "default"}
                className="flex-none"
                onClick={() => void app.patchShot(shot.id, { selectedTakeId: take.id })}
              >
                {isSelected ? "Selected" : "Select"}
              </Button>
            </div>
            {take.drift && (
              <div className="mt-1.5 border-t border-[var(--line)] pt-1.5">
                <div className="mono text-[9.5px] text-[var(--faint)]">
                  palette {take.drift.paletteDistance ?? "not measured"}
                  {take.drift.averageColor ? ` · avg ${take.drift.averageColor}` : ""} · coverage {take.drift.refCoverage}
                </div>
                {take.drift.warnings.map((w) => (
                  <p key={w} className="mt-0.5 text-[10.5px] leading-snug text-[var(--muted)]">
                    {w}
                  </p>
                ))}
              </div>
            )}
            <div className="mt-1.5 flex gap-1">
              <Button
                size="sm"
                variant={take.verdict === "accepted" ? "primary" : "default"}
                onClick={() => void app.verdictTake(shot.id, take.id, take.verdict === "accepted" ? null : "accepted")}
              >
                <Check size={11} /> Accept
              </Button>
              <Button
                size="sm"
                variant={take.verdict === "rejected" ? "danger" : "default"}
                onClick={() => void app.verdictTake(shot.id, take.id, take.verdict === "rejected" ? null : "rejected")}
              >
                <X size={11} /> Reject
              </Button>
              {job && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    app.setActiveJob(job.id);
                    app.setView("studio");
                  }}
                >
                  Open in Studio
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
