import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Check, Crop, FlipHorizontal2, Heart, Maximize2, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { CROP_PRESETS, frameTimes } from "@core";
import type { MediaAsset } from "@core";
import { cn, fmtBytes, fmtDuration } from "../lib";
import { frameUrl } from "../api";
import { useApp } from "../store";
import { Img, KindGlyph } from "./Media";

export function MediaTile({
  media,
  selected,
  order,
  onClick,
  onOpen,
  onFavorite,
  onDelete,
  showMeta = false,
}: {
  media: MediaAsset;
  selected?: boolean;
  order?: number;
  onClick?: () => void;
  onOpen?: () => void;
  onFavorite?: () => void;
  onDelete?: () => void;
  showMeta?: boolean;
}) {
  return (
    <div className="group relative">
      <div
        className={cn(
          "thumb-frame relative aspect-square w-full",
          selected && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]"
        )}
      >
        <button
          type="button"
          onClick={onClick}
          aria-label={`Open ${media.name}`}
          className="absolute inset-0 h-full w-full text-left"
        >
          {media.kind === "audio" ? (
            <span className="checker flex h-full w-full items-center justify-center">
              <span className="text-[var(--muted)]">
                <KindGlyph kind="audio" size={28} />
              </span>
            </span>
          ) : (
            <Img src={media.thumb} alt={media.name} className="h-full w-full object-cover" />
          )}

          {media.kind !== "image" && (
            <span
              className="absolute left-1.5 top-1.5 flex h-[18px] items-center gap-1 rounded-[4px] px-1.5 font-mono text-[8.5px] text-white"
              style={{ background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)" }}
            >
              <KindGlyph kind={media.kind} size={9} />
              {media.kind === "video" ? fmtDuration(media.durationSeconds) : "AUDIO"}
            </span>
          )}

          {media.favorite && (
            <span className="absolute bottom-1.5 left-1.5 text-[var(--accent)]">
              <Heart size={11} fill="currentColor" />
            </span>
          )}

          {selected && (
            <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-medium text-[var(--on-accent)]">
              {order ?? <Check size={11} />}
            </span>
          )}
        </button>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-1 p-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {onFavorite && (
            <button
              type="button"
              aria-label={media.favorite ? "Remove favourite" : "Mark favourite"}
              onClick={() => onFavorite()}
              className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white backdrop-blur hover:bg-black/90"
            >
              <Heart size={11} fill={media.favorite ? "currentColor" : "none"} />
            </button>
          )}
          {onOpen && (
            <button
              type="button"
              aria-label="Open details"
              onClick={() => onOpen()}
              className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white backdrop-blur hover:bg-black/90"
            >
              <Maximize2 size={10} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              aria-label="Delete"
              onClick={() => onDelete()}
              className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white backdrop-blur hover:bg-[var(--rose)]"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      </div>
      {showMeta && (
        <div className="mt-1.5 px-0.5">
          <div className="truncate text-[10.5px] text-[var(--muted)]">{media.name}</div>
          <div className="mono text-[8.5px] text-[var(--faint)]">
            {media.kind === "image" && media.width ? `${media.width}×${media.height}` : ""}
            {media.kind !== "image" ? fmtDuration(media.durationSeconds) : ""}
            {media.bytes ? ` · ${fmtBytes(media.bytes)}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaEditPanel({ media, onClose }: { media: MediaAsset; onClose: () => void }) {
  const app = useApp();
  const [collection, setCollection] = useState(media.collection ?? "");
  const [tags, setTags] = useState(media.tags.join(", "));
  const [busy, setBusy] = useState(false);

  const saveMeta = async () => {
    await app.patchMedia(media.id, {
      collection: collection.trim() || undefined,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    app.toast("Saved.", "ok");
  };

  const transform = async (body: { preset?: string; rotate?: 0 | 90 | 180 | 270; flipH?: boolean }) => {
    setBusy(true);
    await app.transformMedia(media, body);
    setBusy(false);
  };

  return (
    <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3.5">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input
          className="field h-8 text-[12px]"
          placeholder="Collection (e.g. Winter campaign refs)"
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          aria-label="Collection"
        />
        <input
          className="field h-8 text-[12px]"
          placeholder="Tags, comma separated"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          aria-label="Tags"
        />
        <button className="btn btn-sm h-8" onClick={() => void saveMeta()}>
          Save
        </button>
      </div>

      {media.kind === "image" && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mono mr-1 flex items-center gap-1 text-[9px] uppercase tracking-wider text-[var(--faint)]">
            <Crop size={10} /> Crop copy
          </span>
          {CROP_PRESETS.map((preset) => (
            <button
              key={preset}
              className="chip"
              disabled={busy}
              onClick={() => void transform({ preset })}
            >
              {preset}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" />
          <button className="chip" disabled={busy} onClick={() => void transform({ rotate: 270 })} aria-label="Rotate left">
            <RotateCcw size={11} />
          </button>
          <button className="chip" disabled={busy} onClick={() => void transform({ rotate: 90 })} aria-label="Rotate right">
            <RotateCw size={11} />
          </button>
          <button className="chip" disabled={busy} onClick={() => void transform({ flipH: true })} aria-label="Flip horizontal">
            <FlipHorizontal2 size={11} />
          </button>
          <span className="ml-1 text-[10px] text-[var(--faint)]">Edits save as new references; the original is untouched.</span>
        </div>
      )}

      {media.kind === "video" && (
        <div className="mt-3">
          <div className="mono mb-1.5 text-[9px] uppercase tracking-wider text-[var(--faint)]">
            Frames — click to save and use as reference
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {frameTimes(media.durationSeconds ?? 0, 6).map((at) => (
              <button
                key={at}
                className="thumb-frame h-14 w-24 flex-none"
                disabled={busy}
                title={`Frame at ${at}s`}
                onClick={async () => {
                  setBusy(true);
                  await app.grabFrame(media, at, "reference");
                  setBusy(false);
                  onClose();
                }}
              >
                <img src={frameUrl(media.id, at)} alt={`Frame at ${at}s`} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
          <button
            className="btn btn-sm mt-2"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await app.grabFrame(media, "last", "first_frame");
              setBusy(false);
              onClose();
            }}
          >
            Chain: last frame → next shot's first frame
          </button>
        </div>
      )}
    </div>
  );
}

export function MediaModal({
  media,
  onClose,
  onUse,
  onReveal,
  onDelete,
  extra,
}: {
  media: MediaAsset | null;
  onClose: () => void;
  onUse: () => void;
  onReveal: () => void;
  onDelete: () => void;
  extra?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!media) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [media, onClose]);
  if (!media) return null;
  return (
    <div className="dialog-backdrop fixed inset-0 z-[80] overflow-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex min-h-full items-center justify-center p-4 md:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={media.name}
          tabIndex={-1}
          className="flex h-[90vh] w-full max-w-[1100px] flex-col outline-none"
        >
          <div className="flex items-start justify-between gap-4 pb-4">
            <div className="min-w-0">
              <div className="truncate text-[13px]">{media.name}</div>
              <div className="mono mt-0.5 text-[9.5px] text-[var(--faint)]">
                {media.kind} · {media.width ? `${media.width}×${media.height} · ` : ""}
                {fmtBytes(media.bytes)} · {new Date(media.createdAt).toLocaleString()}
              </div>
            </div>
            <button className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-black/40">
            {media.kind === "image" && (
              <img src={media.url} alt={media.name} className="h-full w-full object-contain" onClick={onClose} />
            )}
            {media.kind === "video" && (
              <video src={media.url} poster={media.thumb} controls className="h-full w-full" />
            )}
            {media.kind === "audio" && (
              <div className="flex h-full flex-col items-center justify-center gap-6 p-10">
                <KindGlyph kind="audio" size={40} />
                <audio src={media.url} controls className="w-full max-w-[520px]" />
              </div>
            )}
          </div>
          <MediaEditPanel media={media} onClose={onClose} />
          <div className="flex flex-wrap items-center gap-2 pt-4">
            <div className="mono mr-auto max-w-[60%] truncate text-[9.5px] text-[var(--faint)]" title={media.filePath}>
              {media.filePath}
            </div>
            {extra}
            <button className="btn btn-sm" onClick={onReveal}>
              Reveal
            </button>
            <button className="btn btn-sm" onClick={onDelete}>
              <Trash2 size={11} /> Delete
            </button>
            <button className="btn btn-sm btn-primary" onClick={onUse}>
              Use as reference
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
