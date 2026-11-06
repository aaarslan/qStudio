import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Heart, Images, Search, Upload, X } from "lucide-react";
import type { MediaAsset } from "@core";
import { useApp } from "../store";
import { api } from "../api";
import { Button, Empty, Segmented } from "../ui";
import { MediaModal, MediaTile } from "../components/MediaCard";

type KindFilter = "all" | "image" | "video" | "audio";

export function ReferencesView() {
  const app = useApp();
  const [kind, setKind] = useState<KindFilter>("all");
  const [collection, setCollection] = useState("all");
  const [batchCollection, setBatchCollection] = useState("");
  const [batchTag, setBatchTag] = useState("");
  const [source, setSource] = useState<"all" | "generated" | "uploaded">("all");
  const [favOnly, setFavOnly] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastIndex = useRef<number | null>(null);
  const uploadBatchActive = useRef(false);

  const collections = useMemo(
    () => Array.from(new Set(app.media.map((m) => m.collection).filter(Boolean) as string[])).sort(),
    [app.media]
  );

  const list = useMemo(() => {
    let out = app.media;
    if (kind !== "all") out = out.filter((m) => m.kind === kind);
    if (collection !== "all") out = out.filter((m) => (m.collection ?? "") === collection);
    if (source !== "all") out = out.filter((m) => m.source === source);
    if (favOnly) out = out.filter((m) => m.favorite);
    if (q.trim()) {
      const n = q.toLowerCase();
      out = out.filter((m) => m.name.toLowerCase().includes(n) || (m.prompt ?? "").toLowerCase().includes(n) || m.tags.some((t) => t.toLowerCase().includes(n)));
    }
    return out;
  }, [app.media, kind, collection, source, favOnly, q]);

  useEffect(() => {
    const mediaIds = new Set(app.media.map((m) => m.id));
    setSelected((current) => current.filter((id) => mediaIds.has(id)));
  }, [app.media]);

  useEffect(() => {
    lastIndex.current = null;
  }, [list]);

  const toggle = (m: MediaAsset, index: number) => {
    const shift = window.event instanceof MouseEvent && (window.event as MouseEvent).shiftKey;
    if (shift && lastIndex.current !== null) {
      const [a, b] = [Math.min(lastIndex.current, index), Math.max(lastIndex.current, index)];
      const range = list.slice(a, b + 1).map((x) => x.id);
      setSelected((cur) => Array.from(new Set([...cur, ...range])));
    } else {
      setSelected((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]));
    }
    lastIndex.current = index;
  };

  const addFiles = async (files: FileList | File[]) => {
    if (uploadBatchActive.current) {
      app.toast("An upload batch is already in progress.", "err");
      return;
    }
    const arr = Array.from(files);
    if (!arr.length) return;
    uploadBatchActive.current = true;
    setUploading((n) => n + arr.length);
    let added = 0;
    let failed = 0;
    let failureMessage = "";
    for (const file of arr) {
      try {
        await api.upload(file);
        added += 1;
      } catch (err) {
        failed += 1;
        if (!failureMessage) failureMessage = err instanceof Error ? err.message : "Upload failed.";
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    uploadBatchActive.current = false;
    try {
      await app.refresh();
    } catch {
      app.toast("Could not refresh references. Reload to see uploaded files.", "err");
    }
    if (failed === 0) {
      app.toast(`${added} file${added === 1 ? "" : "s"} added.`, "ok");
    } else {
      app.toast(`${added} added, ${failed} failed. ${failureMessage}`, "err");
    }
  };

  const send = () => {
    const assets = selected.map((id) => app.media.find((m) => m.id === id)).filter(Boolean) as MediaAsset[];
    if (!assets.length) return;
    if (assets.some((a) => a.kind !== "image") && app.activeMode !== "video") app.setMode("video");
    app.addRefs(assets);
    setSelected([]);
    app.setView("studio");
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files?.length) {
          e.preventDefault();
          setDragOver(false);
          void addFiles(e.dataTransfer.files);
        }
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]">
          <div className="rounded-xl border border-[var(--line-2)] bg-[var(--panel)] px-4 py-3 text-[12.5px]">Drop to add references</div>
        </div>
      )}

      <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-[var(--line)] px-5 py-3">
        <Segmented
          value={kind}
          options={[
            { id: "all", label: "All" },
            { id: "image", label: "Images" },
            { id: "video", label: "Video" },
            { id: "audio", label: "Audio" },
          ]}
          onChange={setKind}
        />
        <div className="relative min-w-[160px] flex-1 md:max-w-[280px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input
            className="field h-8 pl-7 text-[12px]"
            placeholder="Search names, prompts, tags"
            aria-label="Search references"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="field h-8 w-auto text-[11.5px]"
          aria-label="Filter references by source"
          value={source}
          onChange={(e) => setSource(e.target.value as any)}
        >
          <option value="all">All sources</option>
          <option value="uploaded">Uploaded</option>
          <option value="generated">Generated</option>
        </select>
        {collections.length > 0 && (
          <select
            className="field h-8 w-auto text-[11.5px]"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            aria-label="Filter by collection"
          >
            <option value="all">All collections</option>
            {collections.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        <button
          className={`icon-btn ${favOnly ? "active text-[var(--accent)]" : ""}`}
          onClick={() => setFavOnly(!favOnly)}
          aria-label="Favourites only"
        >
          <Heart size={14} fill={favOnly ? "currentColor" : "none"} />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="mono text-[9.5px] text-[var(--faint)]">{list.length} files</span>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            <Upload size={12} /> Add files
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="scroll min-h-0 flex-1 p-5">
        {list.length === 0 && uploading === 0 ? (
          <Empty
            icon={<Images size={26} />}
            title="No references yet"
            sub="Drop images, video or audio here. Generated frames and clips land here automatically so you can feed them back in."
            action={<Button onClick={() => fileRef.current?.click()}>Add files</Button>}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-7">
            {uploading > 0 &&
              Array.from({ length: Math.min(uploading, 8) }).map((_, i) => (
                <div key={`u${i}`} className="shimmer aspect-square rounded-lg border border-[var(--line)]" />
              ))}
            {list.map((m, i) => (
              <MediaTile
                key={m.id}
                media={m}
                selected={selected.includes(m.id)}
                order={selected.indexOf(m.id) + 1}
                onClick={() => toggle(m, i)}
                onOpen={() => setDetail(m)}
                onFavorite={() => void app.toggleMediaFavorite(m)}
                onDelete={() => void app.deleteMedia(m)}
              />
            ))}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="pointer-events-auto z-20 m-2 flex max-w-full flex-none flex-wrap items-center justify-center gap-2 rounded-xl border border-[var(--line-2)] bg-[color-mix(in_srgb,var(--panel)_94%,transparent)] px-2.5 py-2.5 shadow-2xl backdrop-blur sm:self-center sm:gap-3 sm:px-3.5">
          <span className="mono text-[10px] text-[var(--muted)]">{selected.length} selected</span>
          <div className="hidden max-w-[220px] gap-1 overflow-hidden sm:flex">
            {selected.slice(0, 6).map((id) => {
              const m = app.media.find((x) => x.id === id);
              return m ? (
                <span key={id} className="thumb-frame h-7 w-7 flex-none">
                  <img src={m.thumb} alt="" className="h-full w-full object-cover" />
                </span>
              ) : null;
            })}
          </div>
          <button className="icon-btn h-7 w-7" onClick={() => setSelected([])} aria-label="Clear selection">
            <X size={12} />
          </button>
          <input
            className="field h-7 w-28 text-[11px]"
            placeholder="Collection"
            value={batchCollection}
            onChange={(e) => setBatchCollection(e.target.value)}
            aria-label="Batch collection"
          />
          <input
            className="field h-7 w-20 text-[11px]"
            placeholder="Tag"
            value={batchTag}
            onChange={(e) => setBatchTag(e.target.value)}
            aria-label="Batch tag"
          />
          <Button
            size="sm"
            disabled={!batchCollection.trim() && !batchTag.trim()}
            onClick={async () => {
              for (const id of selected) {
                const m = app.media.find((x) => x.id === id);
                if (!m) continue;
                await app.patchMedia(id, {
                  ...(batchCollection.trim() ? { collection: batchCollection.trim() } : {}),
                  ...(batchTag.trim()
                    ? { tags: Array.from(new Set([...m.tags, batchTag.trim()])) }
                    : {}),
                });
              }
              app.toast(`Updated ${selected.length} file${selected.length > 1 ? "s" : ""}.`, "ok");
              setBatchCollection("");
              setBatchTag("");
            }}
          >
            Apply
          </Button>
          <Button size="sm" variant="primary" onClick={send}>
            <Check size={12} /> Send to studio
          </Button>
        </div>
      )}

      <MediaModal
        media={detail}
        onClose={() => setDetail(null)}
        onReveal={() => detail && void api.revealMedia(detail.id)}
        onDelete={() => {
          if (detail) void app.deleteMedia(detail);
          setDetail(null);
        }}
        onUse={() => {
          if (detail) app.useAsReference(detail);
          setDetail(null);
        }}
      />
    </div>
  );
}
