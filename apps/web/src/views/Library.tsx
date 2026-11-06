import { useMemo, useState } from "react";
import { BookmarkPlus, Heart, Search, Video } from "lucide-react";
import type { MediaAsset } from "@core";
import { useApp } from "../store";
import { api } from "../api";
import { dayKey } from "../lib";
import { Button, Empty, Segmented } from "../ui";
import { MediaModal, MediaTile } from "../components/MediaCard";
import { VideoHandoff } from "../components/VideoHandoff";

export function LibraryView() {
  const app = useApp();
  const [kind, setKind] = useState<"all" | "image" | "video" | "audio">("all");
  const [collection, setCollection] = useState("all");
  const [favOnly, setFavOnly] = useState(false);
  const [q, setQ] = useState("");
  const [quality, setQuality] = useState("all");
  const [detail, setDetail] = useState<MediaAsset | null>(null);
  const [videoSource, setVideoSource] = useState<MediaAsset | null>(null);
  const [qualitySaving, setQualitySaving] = useState<string | null>(null);
  const [recipeSaving, setRecipeSaving] = useState(false);

  const collections = useMemo(
    () =>
      Array.from(
        new Set(
          app.media
            .filter((m) => m.source === "generated")
            .map((m) => m.collection)
            .filter(Boolean) as string[]
        )
      ).sort(),
    [app.media]
  );

  const list = useMemo(() => {
    let out = app.media.filter((m) => m.source === "generated");
    if (kind !== "all") out = out.filter((m) => m.kind === kind);
    if (collection !== "all") out = out.filter((m) => (m.collection ?? "") === collection);
    if (favOnly) out = out.filter((m) => m.favorite);
    if (quality !== "all") out = out.filter((m) => m.qualityLabels?.some((label) => label === quality));
    const query = q.trim().toLowerCase();
    if (query) {
      out = out.filter((m) =>
        m.name.toLowerCase().includes(query) ||
        (m.prompt ?? "").toLowerCase().includes(query) ||
        m.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }
    return out;
  }, [app.media, kind, collection, favOnly, q, quality]);

  const groups = useMemo(() => {
    const map = new Map<string, MediaAsset[]>();
    for (const m of list) {
      const key = dayKey(m.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [list]);

  const activeDetail = detail ? app.media.find((m) => m.id === detail.id) ?? detail : null;
  const job = activeDetail?.jobId ? app.jobs.find((j) => j.id === activeDetail.jobId) : undefined;
  const related = useMemo(() => {
    if (!activeDetail) return { parents: [] as MediaAsset[], derived: [] as MediaAsset[] };
    const parentIds = new Set(activeDetail.parentMediaIds ?? []);
    for (const ref of job?.spec.refs ?? []) parentIds.add(ref.mediaId);
    const parents = [...parentIds]
      .map((id) => app.media.find((m) => m.id === id))
      .filter((m): m is MediaAsset => Boolean(m));
    const derived = app.media.filter((candidate) => {
      if (candidate.id === activeDetail.id) return false;
      if (candidate.parentMediaIds?.includes(activeDetail.id)) return true;
      const childJob = candidate.jobId ? app.jobs.find((item) => item.id === candidate.jobId) : undefined;
      return Boolean(childJob?.spec.refs.some((ref) => ref.mediaId === activeDetail.id));
    });
    return { parents, derived };
  }, [activeDetail, app.media, app.jobs, job]);

  const toggleQuality = async (asset: MediaAsset, label: "best-likeness" | "best-motion") => {
    if (qualitySaving) return;
    setQualitySaving(asset.id);
    const current = asset.qualityLabels ?? [];
    const next = current.includes(label) ? current.filter((value) => value !== label) : [...current, label];
    try {
      await api.patchMedia(asset.id, { qualityLabels: next });
      await app.refresh();
    } catch (error) {
      app.toast(error instanceof Error ? error.message : "Could not update quality label.", "err");
    } finally {
      setQualitySaving(null);
    }
  };

  const saveRecipe = async (asset: MediaAsset) => {
    if (!job || job.status !== "succeeded" || recipeSaving) return;
    setRecipeSaving(true);
    try {
      await api.savePrompt({
        title: job.prompt.trim().slice(0, 72) || "Untitled recipe",
        text: job.prompt,
        mode: job.mode,
        modelId: job.modelId,
        params: { ...job.spec, refs: job.spec.refs.map((ref) => ({ ...ref })) },
        tags: ["recipe"],
        favorite: false,
        recipe: {
          identity: job.prompt,
          wardrobe: "",
          pose: "",
          expression: "",
          lighting: "",
          background: "",
          camera: "",
          preserveFace: false,
          preserveProportions: false,
          preserveOutfit: false,
        },
        coverMediaId: asset.id,
        exampleMediaIds: [asset.id],
      });
      await app.refresh();
      app.toast("Recipe saved with its source references.", "ok");
    } catch (error) {
      app.toast(error instanceof Error ? error.message : "Could not save recipe.", "err");
    } finally {
      setRecipeSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
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
        <div className="relative min-w-[180px] flex-1 md:max-w-[320px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input
            className="field h-8 pl-7 text-[12px]"
            placeholder="Search names, prompts, tags"
            aria-label="Search library"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
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
          onClick={() => setFavOnly((current) => !current)}
          aria-label="Favourites only"
          aria-pressed={favOnly}
        >
          <Heart size={14} fill={favOnly ? "currentColor" : "none"} />
        </button>
        <select className="field h-8 w-auto text-[11.5px]" value={quality} onChange={(event) => setQuality(event.target.value)} aria-label="Filter by quality label">
          <option value="all">All ratings</option>
          <option value="best-likeness">Best likeness</option>
          <option value="best-motion">Best motion</option>
        </select>
        <span className="mono ml-auto text-[9.5px] text-[var(--faint)]">{list.length} outputs</span>
        <Button size="sm" variant="ghost" onClick={() => void api.openOutput()}>
          Open folder
        </Button>
      </div>

      <div className="scroll min-h-0 flex-1 px-5 pb-8">
        {list.length === 0 ? (
          app.media.some((m) => m.source === "generated") ? (
            <Empty
              title="Nothing matches"
              sub="No outputs match these filters."
              action={
                <Button
                  onClick={() => {
                    setQ("");
                    setKind("all");
                    setCollection("all");
                    setFavOnly(false);
                    setQuality("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Empty
              title="Nothing developed yet"
              sub="Every image, clip and voice you generate is saved here and on disk. Press ⌘↵ in the studio to make the first one."
              action={<Button onClick={() => app.setView("studio")}>Open the studio</Button>}
            />
          )
        ) : (
          groups.map(([day, items]) => (
            <section key={day} className="pt-5">
              <div className="mb-2.5 flex items-baseline gap-3">
                <h3 className="mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--faint)]">{day}</h3>
                <span className="mono text-[9px] text-[var(--faint)]">{items.length}</span>
                <span className="h-px flex-1 bg-[var(--line)]" />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-7">
                {items.map((m) => (
                  <MediaTile
                    key={m.id}
                    media={m}
                    onClick={() => setDetail(m)}
                    onFavorite={() => void app.toggleMediaFavorite(m)}
                    onDelete={() => void app.deleteMedia(m)}
                    showMeta
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <MediaModal
        media={activeDetail}
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
        extra={
          activeDetail && (
            <div className="flex w-full flex-wrap items-center gap-2">
              {activeDetail.kind === "image" && (
                <Button size="sm" variant="ghost" onClick={() => { setVideoSource(activeDetail); setDetail(null); }}>
                  <Video size={12} /> Animate image
                </Button>
              )}
              {job && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    app.replayJob(job);
                    setDetail(null);
                  }}
                >
                  Replay this job
                </Button>
              )}
              {job?.status === "succeeded" && (
                <Button size="sm" variant="ghost" disabled={recipeSaving} onClick={() => void saveRecipe(activeDetail)}>
                  <BookmarkPlus size={12} /> {recipeSaving ? "Saving…" : "Save as recipe"}
                </Button>
              )}
              {activeDetail.kind !== "audio" && (
                <div className="flex items-center gap-1.5">
                  {activeDetail.kind === "image" && (
                    <button
                      className={`chip ${activeDetail.qualityLabels?.includes("best-likeness") ? "border-[var(--accent)] text-[var(--accent)]" : ""}`}
                      disabled={qualitySaving === activeDetail.id}
                      aria-pressed={activeDetail.qualityLabels?.includes("best-likeness") ?? false}
                      onClick={() => void toggleQuality(activeDetail, "best-likeness")}
                    >
                      Best likeness
                    </button>
                  )}
                  {activeDetail.kind === "video" && (
                    <button
                      className={`chip ${activeDetail.qualityLabels?.includes("best-motion") ? "border-[var(--accent)] text-[var(--accent)]" : ""}`}
                      disabled={qualitySaving === activeDetail.id}
                      aria-pressed={activeDetail.qualityLabels?.includes("best-motion") ?? false}
                      onClick={() => void toggleQuality(activeDetail, "best-motion")}
                    >
                      Best motion
                    </button>
                  )}
                </div>
              )}
              {(related.parents.length > 0 || related.derived.length > 0) && (
                <div className="flex w-full flex-wrap items-center gap-2 border-t border-[var(--line)] pt-2">
                  {related.parents.length > 0 && (
                    <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Original / parents</span>
                  )}
                  {related.parents.map((asset) => (
                    <button key={`parent-${asset.id}`} className="chip max-w-[220px] truncate" title={`${asset.kind} · ${asset.name}`} onClick={() => setDetail(asset)}>
                      {asset.kind} · {asset.name}
                    </button>
                  ))}
                  {related.derived.length > 0 && (
                    <span className="mono ml-2 text-[9px] uppercase tracking-wide text-[var(--faint)]">Derived</span>
                  )}
                  {related.derived.map((asset) => (
                    <button key={`derived-${asset.id}`} className="chip max-w-[220px] truncate" title={`${asset.kind} · ${asset.name}`} onClick={() => setDetail(asset)}>
                      {asset.kind} · {asset.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        }
      />
      <VideoHandoff media={videoSource} onClose={() => setVideoSource(null)} />
    </div>
  );
}
