import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Film as FilmIcon, Mic, Minus, Pause, Play, Plus } from "lucide-react";
import { effectivePalette } from "@core";
import type { Scene, Shot, World } from "@core";
import { useApp } from "../../store";
import { api } from "../../api";
import { Button, Empty, IconButton, Modal } from "../../ui";
import { Img } from "../../components/Media";
import { cn, fmtDuration, truncate } from "../../lib";
import { byOrder, fmtTimelineDuration, selectedTakeOf, shotTimelineSeconds, takeJob } from "./shared";

export function CutPlayer({
  world,
  scenes,
  shots,
  open,
  onClose,
}: {
  world: World;
  scenes: Scene[];
  shots: Shot[];
  open: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [offset, setOffset] = useState(0);
  const [seekVersion, setSeekVersion] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const offsetRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<(HTMLAudioElement | null)[]>([]);

  const ordered = useMemo(() => {
    const out: { shot: Shot; scene: Scene }[] = [];
    for (const scene of scenes) {
      for (const shot of byOrder(shots.filter((item) => item.sceneId === scene.id))) out.push({ shot, scene });
    }
    return out;
  }, [scenes, shots]);

  const clips = useMemo(
    () =>
      ordered.map(({ shot, scene }) => {
        const job = takeJob(shot, app.jobs);
        const asset = job?.assets[0];
        return {
          shot,
          scene,
          asset,
          duration: shotTimelineSeconds(shot),
          trimIn: Math.max(0, shot.trimIn ?? 0),
          audio: shot.audioMediaIds
            .map((id) => app.media.find((item) => item.id === id))
            .filter((item): item is NonNullable<typeof item> => !!item?.url),
          gain: Math.max(0, Math.min(1, shot.audioGain ?? 1)),
        };
      }),
    [ordered, app.jobs, app.media]
  );

  const total = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const starts = useMemo(() => {
    let elapsed = 0;
    return clips.map((clip) => {
      const start = elapsed;
      elapsed += clip.duration;
      return start;
    });
  }, [clips]);
  const clip = clips[Math.min(index, Math.max(0, clips.length - 1))];
  const elapsed = (starts[index] ?? 0) + Math.min(offset, clip?.duration ?? 0);
  const aspect = /^\d+:\d+$/.test(world.aspect) ? world.aspect.replace(":", " / ") : "16 / 9";
  const audioSignature = clip?.audio.map((audio) => `${audio.id}:${audio.url}`).join("|") ?? "";

  useEffect(() => {
    if (!open) return;
    setPlaying(false);
    setIndex(0);
    setOffset(0);
    setAtEnd(false);
    offsetRef.current = 0;
    setSeekVersion((value) => value + 1);
  }, [open, world.id]);

  useEffect(() => {
    if (index < clips.length) return;
    setIndex(Math.max(0, clips.length - 1));
  }, [clips.length, index]);

  useEffect(() => {
    if (!open || !clip) return;
    const video = videoRef.current;
    if (video && clip.asset?.kind === "video") {
      const target = Math.min(clip.trimIn + offsetRef.current, clip.trimIn + Math.max(0, clip.duration - 0.05));
      if (video.readyState >= 1 && Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
    }
    for (const audio of audioRefs.current) {
      if (!audio) continue;
      audio.volume = clip.gain;
      const target = Math.min(offsetRef.current, Math.max(0, (audio.duration || clip.duration) - 0.05));
      if (audio.readyState >= 1 && Math.abs(audio.currentTime - target) > 0.15) audio.currentTime = target;
    }
  }, [open, index, seekVersion, clip?.shot.id, clip?.duration, clip?.trimIn, clip?.gain, clip?.asset?.url, audioSignature]);

  useEffect(() => {
    if (!open) return;
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [open]);

  useEffect(() => {
    if (!open || !playing || !clip) return;
    const video = videoRef.current;
    const audios = audioRefs.current.filter((audio): audio is HTMLAudioElement => !!audio);
    let cancelled = false;
    let frame = 0;
    let lastReport = 0;
    const imageStart = performance.now() - offsetRef.current * 1000;

    const pauseMedia = () => {
      video?.pause();
      for (const audio of audios) audio.pause();
    };

    const tick = (now: number) => {
      if (cancelled) return;
      const current =
        video && clip.asset?.kind === "video"
          ? Math.max(0, video.currentTime - clip.trimIn)
          : (now - imageStart) / 1000;
      offsetRef.current = Math.min(clip.duration, current);
      if (now - lastReport > 80) {
        lastReport = now;
        setOffset(offsetRef.current);
      }
      if ((video && clip.asset?.kind === "video" && video.ended) || current >= clip.duration - 0.03) {
        pauseMedia();
        setOffset(clip.duration);
        offsetRef.current = clip.duration;
        if (index < clips.length - 1) {
          offsetRef.current = 0;
          setOffset(0);
          setIndex(index + 1);
        } else {
          setPlaying(false);
          setAtEnd(true);
        }
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (cancelled) return;
      if (video && clip.asset?.kind === "video") {
        video.currentTime = clip.trimIn + offsetRef.current;
        void video
          .play()
          .catch((err: DOMException) => {
            if (err?.name !== "AbortError") setPlaying(false);
          });
      }
      for (const audio of audios) {
        audio.volume = clip.gain;
        audio.currentTime = Math.min(offsetRef.current, Math.max(0, (audio.duration || clip.duration) - 0.05));
        if (clip.gain > 0) void audio.play().catch(() => {});
      }
      frame = requestAnimationFrame(tick);
    };

    if (video && clip.asset?.kind === "video" && video.readyState < 1) {
      video.addEventListener("loadedmetadata", start, { once: true });
    } else {
      start();
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      video?.removeEventListener("loadedmetadata", start);
      pauseMedia();
    };
  }, [open, playing, index, seekVersion, clip?.shot.id, clip?.duration, clip?.trimIn, clip?.gain, clip?.asset?.url, audioSignature, clips.length]);

  const seekTo = (seconds: number) => {
    if (!clips.length) return;
    const targetTime = Math.max(0, Math.min(total, seconds));
    let targetIndex = clips.length - 1;
    for (let i = 0; i < starts.length; i++) {
      if (targetTime < starts[i] + clips[i].duration) {
        targetIndex = i;
        break;
      }
    }
    const nextOffset = Math.max(0, targetTime - starts[targetIndex]);
    const boundary = targetTime >= total - 0.01;
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
    setIndex(targetIndex);
    setAtEnd(boundary);
    if (boundary) setPlaying(false);
    if (playing && targetIndex === index && clip?.asset?.kind === "video" && !boundary) {
      const video = videoRef.current;
      if (video) video.currentTime = clip.trimIn + nextOffset;
      for (const audio of audioRefs.current) {
        if (audio) audio.currentTime = Math.min(nextOffset, Math.max(0, (audio.duration || clip.duration) - 0.05));
      }
      return;
    }
    setSeekVersion((value) => value + 1);
  };

  const changeIndex = (next: number) => {
    if (!clips.length) return;
    const bounded = Math.max(0, Math.min(clips.length - 1, next));
    offsetRef.current = 0;
    setOffset(0);
    setIndex(bounded);
    setAtEnd(false);
    setSeekVersion((value) => value + 1);
  };

  const togglePlay = () => {
    if (!clip) return;
    if (!playing && (atEnd || (index === clips.length - 1 && offsetRef.current >= clip.duration - 0.05))) {
      offsetRef.current = 0;
      setOffset(0);
      setIndex(0);
      setAtEnd(false);
      setSeekVersion((value) => value + 1);
    }
    setPlaying((value) => !value);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={1040}
      title="Play cut"
      sub={clip ? `${index + 1}/${clips.length} · ${clip.scene.title} · ${clip.shot.title}` : "No shots in this cut yet."}
    >
      {!clips.length ? (
        <Empty title="No shots to play" sub="Add a scene and a shot, or break down a script first." />
      ) : (
        <div className="space-y-3">
          <div
            className="relative flex max-h-[58vh] min-h-[240px] items-center justify-center overflow-hidden rounded-xl border border-[var(--line-2)] bg-black"
            style={{ aspectRatio: aspect }}
          >
            {clip?.asset?.kind === "video" ? (
              <video
                key={`${clip.shot.id}-${index}`}
                ref={videoRef}
                src={clip.asset.url}
                poster={clip.asset.thumb}
                className="h-full w-full object-contain"
                playsInline
                preload="auto"
              />
            ) : clip?.asset?.kind === "image" ? (
              <Img src={clip.asset.url} alt={clip.shot.title} className="h-full w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-[var(--muted)]">
                <FilmIcon size={30} />
                <span className="serif text-[18px]">{clip?.shot.title ?? "Missing take"}</span>
                <span className="text-[11px]">Animatic hold, no rendered take</span>
              </div>
            )}
            <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/65 px-2 py-1 text-[10.5px] text-white backdrop-blur">
              {index + 1}/{clips.length} · {fmtTimelineDuration(offset)} / {fmtTimelineDuration(clip?.duration ?? 0)}
            </div>
            {!playing && (
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors hover:bg-black/30"
                aria-label="Play cut"
                onClick={togglePlay}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/65 backdrop-blur">
                  <Play size={20} className="ml-1" />
                </span>
              </button>
            )}
            {clip?.audio.map((audio, audioIndex) => (
              <audio
                key={`${clip.shot.id}-${audio.id}`}
                ref={(element) => {
                  audioRefs.current[audioIndex] = element;
                }}
                src={audio.url ?? ""}
                preload="auto"
              />
            ))}
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(total, 0.1)}
            step={0.05}
            value={Math.min(total, atEnd ? total : elapsed)}
            aria-label="Cut position"
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--panel-3)] accent-[var(--accent)]"
            onChange={(event) => seekTo(Number(event.target.value))}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => changeIndex(index - 1)} disabled={index === 0} aria-label="Previous clip">
              <ArrowUp size={12} className="-rotate-90" />
            </Button>
            <Button size="sm" variant="primary" onClick={togglePlay} className="w-24">
              {playing ? <Pause size={12} /> : <Play size={12} />} {playing ? "Pause" : "Play"}
            </Button>
            <Button
              size="sm"
              onClick={() => changeIndex(index + 1)}
              disabled={index >= clips.length - 1}
              aria-label="Next clip"
            >
              <ArrowDown size={12} className="-rotate-90" />
            </Button>
            <span className="mono text-[10px] text-[var(--faint)]">
              {fmtTimelineDuration(elapsed)} / {fmtTimelineDuration(total)}
            </span>
            <span className="mono ml-auto text-[9.5px] text-[var(--faint)]">
              {clip?.audio.length ? `${clip.audio.length} dialogue clip${clip.audio.length === 1 ? "" : "s"} · ${Math.round(clip.gain * 100)}%` : "No dialogue audio"}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function FilmStrip({ world, scenes, shots }: { world: World; scenes: Scene[]; shots: Shot[] }) {
  const app = useApp();
  const [zoom, setZoom] = useState(24);
  const [trimDraft, setTrimDraft] = useState<{ shotId: string; trimIn: number; trimOut: number } | null>(null);
  const [dragShotId, setDragShotId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ shotId: string; after: boolean } | null>(null);
  const [reordering, setReordering] = useState(false);
  const dragRef = useRef<{
    shotId: string;
    edge: "in" | "out";
    startX: number;
    startIn: number;
    startOut: number;
    sourceDuration: number;
    currentIn: number;
    currentOut: number;
  } | null>(null);

  const ordered = useMemo(() => {
    const out: { shot: Shot; scene: Scene }[] = [];
    for (const scene of scenes) {
      for (const shot of byOrder(shots.filter((s) => s.sceneId === scene.id))) out.push({ shot, scene });
    }
    return out;
  }, [scenes, shots]);

  const trimValues = (shot: Shot) => {
    if (trimDraft?.shotId === shot.id) {
      return { trimIn: trimDraft.trimIn, trimOut: trimDraft.trimOut };
    }
    const trimIn = Math.max(0, shot.trimIn ?? 0);
    const fallbackOut = trimIn + Math.max(0.1, shot.durationSeconds || 3);
    const trimOut =
      shot.mode === "video" && shot.trimOut !== undefined && shot.trimOut > trimIn
        ? shot.trimOut
        : fallbackOut;
    return { trimIn, trimOut };
  };

  const durationOf = (shot: Shot) => {
    const trim = trimValues(shot);
    return Math.max(0.1, trim.trimOut - trim.trimIn);
  };

  const totalSeconds = ordered.reduce((sum, { shot }) => sum + durationOf(shot), 0);
  const trackWidth = ordered.reduce((sum, { shot }) => sum + Math.max(8, durationOf(shot) * zoom), 2);
  const tickStep = zoom <= 8 ? 5 : zoom <= 14 ? 2 : 1;
  const tickCount = Math.min(500, Math.ceil(totalSeconds / tickStep));

  const commitTrim = (shot: Shot, trimIn: number, trimOut: number) => {
    const roundedIn = Math.round(trimIn * 10) / 10;
    const roundedOut = Math.round(trimOut * 10) / 10;
    const currentIn = Math.max(0, shot.trimIn ?? 0);
    const fallbackOut = currentIn + Math.max(0.1, shot.durationSeconds || 3);
    const currentOut =
      shot.mode === "video" && shot.trimOut !== undefined && shot.trimOut > currentIn
        ? shot.trimOut
        : fallbackOut;
    if (roundedIn === currentIn && roundedOut === currentOut) return;
    void app.patchShot(shot.id, { trimIn: roundedIn, trimOut: roundedOut });
  };

  const beginTrim = (
    event: React.PointerEvent<HTMLElement>,
    shot: Shot,
    edge: "in" | "out",
    sourceDuration: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const trim = trimValues(shot);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    dragRef.current = {
      shotId: shot.id,
      edge,
      startX: event.clientX,
      startIn: trim.trimIn,
      startOut: trim.trimOut,
      sourceDuration: Math.max(0.2, sourceDuration, trim.trimOut, trim.trimIn + 0.2),
      currentIn: trim.trimIn,
      currentOut: trim.trimOut,
    };
    setTrimDraft({ shotId: shot.id, trimIn: trim.trimIn, trimOut: trim.trimOut });
  };

  const moveTrim = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = (event.clientX - drag.startX) / zoom;
    if (drag.edge === "in") {
      drag.currentIn = Math.min(
        drag.startOut - 0.2,
        Math.max(0, Math.round((drag.startIn + delta) * 10) / 10)
      );
    } else {
      drag.currentOut = Math.max(
        drag.startIn + 0.2,
        Math.min(drag.sourceDuration, Math.round((drag.startOut + delta) * 10) / 10)
      );
    }
    setTrimDraft({
      shotId: drag.shotId,
      trimIn: drag.edge === "in" ? drag.currentIn : drag.startIn,
      trimOut: drag.edge === "out" ? drag.currentOut : drag.startOut,
    });
  };

  const endTrim = (event: React.PointerEvent<HTMLElement>, shot: Shot) => {
    event.preventDefault();
    event.stopPropagation();
    const drag = dragRef.current;
    if (!drag) return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
    }
    dragRef.current = null;
    setTrimDraft(null);
    commitTrim(shot, drag.edge === "in" ? drag.currentIn : drag.startIn, drag.edge === "out" ? drag.currentOut : drag.startOut);
  };

  const reorderShotOnTimeline = async (draggedId: string, target: { shotId: string; after: boolean }) => {
    if (draggedId === target.shotId || reordering) return;
    const originals = new Map(ordered.map(({ shot }) => [shot.id, shot]));
    const entries = ordered.map(({ shot }) => ({ id: shot.id, sceneId: shot.sceneId }));
    const from = entries.findIndex((entry) => entry.id === draggedId);
    const targetEntry = entries.find((entry) => entry.id === target.shotId);
    if (from < 0 || !targetEntry) return;
    const moving = entries[from];
    moving.sceneId = targetEntry.sceneId;
    const without = entries.filter((entry) => entry.id !== draggedId);
    let targetIndex = without.findIndex((entry) => entry.id === target.shotId);
    if (targetIndex < 0) return;
    if (target.after) targetIndex += 1;
    without.splice(targetIndex, 0, moving);
    const counts = new Map<string, number>();
    const updates: { id: string; sceneId: string; order: number }[] = [];
    for (const entry of without) {
      const nextOrder = counts.get(entry.sceneId) ?? 0;
      counts.set(entry.sceneId, nextOrder + 1);
      const original = originals.get(entry.id);
      if (!original || original.sceneId !== entry.sceneId || original.order !== nextOrder) {
        updates.push({ id: entry.id, sceneId: entry.sceneId, order: nextOrder });
      }
    }
    setReordering(true);
    setDragShotId(null);
    setDropTarget(null);
    try {
      for (const update of updates) {
        await api.patchShot(update.id, { sceneId: update.sceneId, order: update.order });
      }
      await app.refresh();
      app.setActiveShot(draggedId);
      app.toast("Shot moved on the timeline.", "ok");
    } catch (err) {
      for (const update of updates) {
        const original = originals.get(update.id);
        if (!original) continue;
        await api
          .patchShot(update.id, { sceneId: original.sceneId, order: original.order })
          .catch(() => {});
      }
      await app.refresh().catch(() => {});
      app.toast((err as Error).message, "err");
    } finally {
      setReordering(false);
    }
  };

  return (
    <footer className="flex-none border-t border-[var(--line)] px-4 py-2.5" style={{ background: "var(--panel)" }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="label">Director timeline</span>
        <span className="mono text-[9.5px] text-[var(--faint)]">
          {ordered.length} shots · {fmtTimelineDuration(totalSeconds)} after trims
        </span>
        <span className="mono hidden text-[8.5px] text-[var(--faint)] md:inline">
          drag to reorder · drag edges to trim
        </span>
        <span className="ml-auto flex items-center gap-1">
          <IconButton label="Zoom timeline out" onClick={() => setZoom((value) => Math.max(8, value - 8))}>
            <Minus size={12} />
          </IconButton>
          <span className="mono w-12 text-center text-[9px] text-[var(--faint)]">{zoom}px/s</span>
          <IconButton label="Zoom timeline in" onClick={() => setZoom((value) => Math.min(48, value + 8))}>
            <Plus size={12} />
          </IconButton>
        </span>
      </div>

      {ordered.length === 0 ? (
        <p className="pb-1 text-[11px] text-[var(--faint)]">Shots will line up here in film order.</p>
      ) : (
        <div className="flex min-h-0">
          <div className="mono w-[72px] flex-none pr-2 text-[8px] uppercase tracking-[0.12em] text-[var(--faint)]">
            <div className="h-5" />
            <div className="flex h-[50px] items-center">Video</div>
            <div className="flex h-[32px] items-center">Dialogue</div>
          </div>
          <div className="scroll min-w-0 flex-1 overflow-x-auto pb-1">
            <div style={{ width: Math.max(320, trackWidth) }}>
              <div className="relative h-5 border-b border-[var(--line)]" aria-hidden>
                {Array.from({ length: tickCount + 1 }, (_, index) => {
                  const seconds = index * tickStep;
                  return (
                    <span
                      key={index}
                      className="mono absolute top-0 h-full border-l border-[var(--line-2)] pl-1 text-[8px] leading-5 text-[var(--faint)]"
                      style={{ left: seconds * zoom }}
                    >
                      {seconds > 0 ? fmtDuration(seconds) : ""}
                    </span>
                  );
                })}
              </div>

              <div className="flex h-[50px] items-stretch pt-1">
                {ordered.map(({ shot, scene }, index) => {
                  const palette = effectivePalette(world, scene);
                  const job = takeJob(shot, app.jobs);
                  const asset = job?.assets[0];
                  const take = selectedTakeOf(shot);
                  const trim = trimValues(shot);
                  const duration = durationOf(shot);
                  const active = app.activeShotId === shot.id;
                  const sourceDuration = Math.max(asset?.durationSeconds ?? duration, trim.trimOut, trim.trimIn + 0.2);
                  return (
                    <div
                      key={shot.id}
                      draggable={!reordering}
                      onDragStart={(event) => {
                        if (dragRef.current) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("application/x-qstudio-shot", shot.id);
                        setDragShotId(shot.id);
                      }}
                      onDragEnd={() => {
                        setDragShotId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        const shotDrag =
                          dragShotId !== null ||
                          Array.from(event.dataTransfer.types).includes("application/x-qstudio-shot");
                        if (!shotDrag || dragShotId === shot.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const rect = event.currentTarget.getBoundingClientRect();
                        setDropTarget({ shotId: shot.id, after: event.clientX > rect.left + rect.width / 2 });
                      }}
                      onDragLeave={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                        setDropTarget((current) => (current?.shotId === shot.id ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const draggedId = event.dataTransfer.getData("application/x-qstudio-shot") || dragShotId;
                        const rect = event.currentTarget.getBoundingClientRect();
                        if (draggedId) {
                          void reorderShotOnTimeline(draggedId, {
                            shotId: shot.id,
                            after: event.clientX > rect.left + rect.width / 2,
                          });
                        }
                      }}
                      className={cn(
                        "relative flex-none cursor-grab overflow-hidden rounded-md border bg-[var(--bg-elev)] active:cursor-grabbing",
                        active ? "border-[var(--accent)]" : "border-[var(--line)]",
                        dragShotId === shot.id && "opacity-40"
                      )}
                      style={{
                        width: Math.max(8, duration * zoom),
                        boxShadow:
                          dropTarget?.shotId === shot.id
                            ? dropTarget.after
                              ? "2px 0 0 var(--accent)"
                              : "-2px 0 0 var(--accent)"
                            : undefined,
                      }}
                    >
                      <button
                        type="button"
                        className="relative flex h-full w-full flex-col justify-between overflow-hidden px-2 py-1 text-left"
                        onClick={() => app.setActiveShot(shot.id)}
                        aria-current={active ? "true" : undefined}
                        title={`${scene.title} · ${shot.title} · ${fmtDuration(duration)}`}
                      >
                        {asset && (
                          <Img
                            src={asset.thumb ?? asset.url}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover opacity-25"
                          />
                        )}
                        <span className="relative min-w-0">
                          <span className="block truncate text-[9.5px] font-medium">
                            {index + 1}. {shot.title}
                          </span>
                          <span className="mono block truncate text-[8px] text-[var(--muted)]">
                            {fmtTimelineDuration(duration)}
                            {shot.audioMediaIds.length > 0 ? ` · ${shot.audioMediaIds.length} audio` : ""}
                            {take?.drift ? ` · drift ${take.drift.score}` : ""}
                          </span>
                        </span>
                        <span className="relative flex h-1.5 overflow-hidden rounded-full border border-[var(--line)]">
                          {(palette.length ? palette : ["transparent"]).map((hex, paletteIndex) => (
                            <span key={paletteIndex} className="h-full flex-1" style={{ background: hex }} />
                          ))}
                        </span>
                      </button>
                      {shot.mode === "video" && (
                        <>
                          <span
                            aria-hidden="true"
                            draggable={false}
                            title={`Trim in at ${trim.trimIn.toFixed(1)}s`}
                            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none bg-[color-mix(in_srgb,var(--accent)_65%,transparent)] opacity-70 hover:opacity-100"
                            onPointerDown={(event) => beginTrim(event, shot, "in", sourceDuration)}
                            onPointerMove={moveTrim}
                            onPointerUp={(event) => endTrim(event, shot)}
                            onPointerCancel={() => {
                              dragRef.current = null;
                              setTrimDraft(null);
                            }}
                          />
                          <span
                            aria-hidden="true"
                            draggable={false}
                            title={`Trim out at ${trim.trimOut.toFixed(1)}s`}
                            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none bg-[color-mix(in_srgb,var(--accent)_65%,transparent)] opacity-70 hover:opacity-100"
                            onPointerDown={(event) => beginTrim(event, shot, "out", sourceDuration)}
                            onPointerMove={moveTrim}
                            onPointerUp={(event) => endTrim(event, shot)}
                            onPointerCancel={() => {
                              dragRef.current = null;
                              setTrimDraft(null);
                            }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex h-[32px] items-stretch pt-1">
                {ordered.map(({ shot }) => {
                  const duration = durationOf(shot);
                  const gain = Math.max(0, Math.min(1, shot.audioGain ?? 1));
                  const audio = shot.audioMediaIds
                    .map((id) => app.media.find((item) => item.id === id))
                    .filter((item): item is NonNullable<typeof item> => !!item);
                  return (
                    <button
                      key={shot.id}
                      type="button"
                      className={cn(
                        "flex min-w-0 flex-none items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left",
                        audio.length && gain > 0
                          ? "border-[var(--line-2)] bg-[var(--panel-2)]"
                          : "border-dashed border-[var(--line)] bg-transparent"
                      )}
                      style={{ width: Math.max(8, duration * zoom), opacity: audio.length && gain === 0 ? 0.45 : 1 }}
                      onClick={() => app.setActiveShot(shot.id)}
                      aria-label={`${shot.title} dialogue track, ${
                        audio.length ? (gain === 0 ? "muted" : `${audio.length} audio`) : "silent"
                      }`}
                      title={
                        audio.length
                          ? `${audio.map((item) => item.name).join(", ")} · ${Math.round(gain * 100)}%`
                          : "No dialogue audio attached"
                      }
                    >
                      {audio.length > 0 && <Mic size={9} className="flex-none text-[var(--accent-text)]" />}
                      <span className="mono min-w-0 truncate text-[8px] text-[var(--faint)]">
                        {audio.length ? (gain === 0 ? "muted" : `${audio.length} audio`) : "silent"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
