import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Copy,
  Heart,
  Image as ImageIcon,
  Search,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import type { MediaAsset, PromptRecord, PromptRecipe as PromptRecipeValue } from "@core";
import { useApp } from "../store";
import { cn, copyText, timeAgo } from "../lib";
import { Button, Empty, Modal, Segmented } from "../ui";
import { Img, VideoPlayer, Waveform } from "../components/Media";
import { compilePromptRecipe, initialPromptRecipe, PromptRecipe } from "../components/PromptRecipe";
import { CharacterCollections } from "../components/CharacterCollections";

function hueOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function coverStyle(seed: string) {
  const h = hueOf(seed);
  return {
    background: `radial-gradient(120% 130% at 16% 6%, hsl(${h} 42% 30%), hsl(${(h + 44) % 360} 30% 11%) 68%), radial-gradient(90% 90% at 88% 92%, hsla(${(h + 180) % 360}, 55%, 55%, .22), transparent 60%)`,
  };
}

function modeGlyph(mode: string) {
  return mode === "video" ? <Square size={11} /> : mode === "audio" ? <Sparkles size={11} /> : <ImageIcon size={11} />;
}

function representativeMedia(prompt: PromptRecord, media: MediaAsset[]) {
  return prompt.exampleMediaIds?.map((id) => media.find((asset) => asset.id === id)).find(Boolean) ??
    media.find((asset) => asset.id === prompt.coverMediaId);
}

function PromptCover({ prompt }: { prompt: PromptRecord }) {
  const app = useApp();
  const cover = representativeMedia(prompt, app.media);
  if (cover) {
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        <Img src={cover.thumb ?? cover.url} alt={prompt.title} className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[9px] text-white/85">
          {cover.source === "generated" ? "Generated example" : "Reference"}
        </span>
      </div>
    );
  }
  const words = prompt.title.split(" ").slice(0, 4).join(" ");
  return (
    <div className="relative flex aspect-[16/9] w-full items-end overflow-hidden p-4" style={coverStyle(prompt.title)}>
      <div className="absolute right-3 top-3 text-white/35">{modeGlyph(prompt.mode)}</div>
      <div className="serif relative z-10 text-[19px] leading-tight text-white/92">{words}</div>
      <div className="absolute inset-0 opacity-[0.55]" style={{ backgroundImage: "radial-gradient(circle at 76% 24%, rgba(255,255,255,.12), transparent 42%)" }} />
    </div>
  );
}

function Card({ prompt, onOpen }: { prompt: PromptRecord; onOpen: () => void }) {
  const app = useApp();
  return (
    <div className="card group overflow-hidden">
      <button className="block w-full text-left" onClick={onOpen}>
        <PromptCover prompt={prompt} />
      </button>
      <div className="p-3.5">
        <div className="flex items-start gap-2">
          <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
            <div className="truncate text-[13px] font-medium">{prompt.title}</div>
          </button>
          <button
            className={cn("icon-btn h-6 w-6 flex-none", prompt.favorite && "text-[var(--accent)]")}
            aria-label="Favourite"
            onClick={() => void app.togglePromptFavorite(prompt)}
          >
            <Heart size={12} fill={prompt.favorite ? "currentColor" : "none"} />
          </button>
        </div>
        <p className="mt-1 line-clamp-3 text-[11.5px] leading-[1.55] text-[var(--muted)]">{prompt.text}</p>
        <div className="mt-2.5 flex flex-wrap gap-1">
          <span className="chip">
            {modeGlyph(prompt.mode)} {prompt.mode}
          </span>
          <span className="chip">{prompt.modelId.replace(/-pro$/, "")}</span>
          {prompt.tags.slice(0, 2).map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <Button size="sm" onClick={() => app.applyPrompt(prompt)}>
            Use
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => app.picker.openPicker("prompt", { prompt })}
          >
            With refs
          </Button>
          <span className="mono ml-auto text-[9px] text-[var(--faint)]">
            {prompt.useCount > 0 ? `${prompt.useCount}×` : timeAgo(prompt.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function PromptsView() {
  const app = useApp();
  const [tab, setTab] = useState<"all" | "favorites" | "characters">("all");
  const [mode, setMode] = useState<"all" | "image" | "video" | "audio">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "used" | "az">("recent");
  const [detail, setDetail] = useState<PromptRecord | null>(null);
  const [detailTab, setDetailTab] = useState<"recipe" | "examples" | "history">("recipe");
  const [editTitle, setEditTitle] = useState("");
  const [editRecipe, setEditRecipe] = useState<PromptRecipeValue>(() => initialPromptRecipe(""));
  const [editExampleIds, setEditExampleIds] = useState<string[]>([]);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const liveDetail = detail ? (app.prompts.find((p) => p.id === detail.id) ?? detail) : null;

  useEffect(() => {
    if (detail) {
      setDetailTab("recipe");
      setEditTitle(detail.title);
      setEditRecipe(detail.recipe ?? initialPromptRecipe(detail.text, detail.mode !== "audio"));
      setEditExampleIds(detail.exampleMediaIds ?? []);
    }
  }, [detail?.id]);

  const referenceCount = liveDetail?.params.refs?.filter((ref) => app.media.find((media) => media.id === ref.mediaId)?.kind === "image").length ?? 0;
  const isVisual = liveDetail?.mode !== "audio";
  const finalText = compilePromptRecipe(editRecipe, referenceCount, isVisual);
  const selectedExamples = editExampleIds
    .map((id) => app.media.find((media) => media.id === id))
    .filter((media): media is MediaAsset => Boolean(media));
  const savedRecipe = liveDetail?.recipe ?? initialPromptRecipe(liveDetail?.text ?? "", liveDetail?.mode !== "audio");
  const hasUnsavedChanges = Boolean(liveDetail && (
    editTitle !== liveDetail.title ||
    JSON.stringify(editRecipe) !== JSON.stringify(savedRecipe) ||
    JSON.stringify(editExampleIds) !== JSON.stringify(liveDetail.exampleMediaIds ?? [])
  ));
  const recipeStatus = restoringVersion ? "Restoring version…" : savingRecipe ? "Saving recipe…" : hasUnsavedChanges ? "Unsaved changes" : "Saved";
  const availableExamples = useMemo(
    () => app.media
      .filter((media) => media.source === "generated")
      .slice()
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [app.media]
  );
  const invalidExampleIds = editExampleIds.filter((id) => !availableExamples.some((media) => media.id === id));

  const list = useMemo(() => {
    let out = app.prompts;
    if (tab === "favorites") out = out.filter((p) => p.favorite);
    if (mode !== "all") out = out.filter((p) => p.mode === mode);
    if (q.trim()) {
      const needle = q.toLowerCase();
      out = out.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.text.toLowerCase().includes(needle) ||
          p.tags.some((t) => t.toLowerCase().includes(needle))
      );
    }
    const copy = out.slice();
    if (sort === "used") copy.sort((a, b) => b.useCount - a.useCount);
    else if (sort === "az") copy.sort((a, b) => a.title.localeCompare(b.title));
    else copy.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return copy;
  }, [app.prompts, tab, mode, q, sort]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-[var(--line)] px-5 py-3">
        <Segmented
          value={tab}
          options={[
            { id: "all", label: "All" },
            { id: "favorites", label: "Favourites" },
            { id: "characters", label: "Characters" },
          ]}
          onChange={setTab}
        />
        <div className="relative min-w-[180px] flex-1 md:max-w-[300px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search prompts and tags"
            aria-label="Search prompts"
            className="field h-8 pl-7 text-[12px]"
          />
        </div>
        <select
          className="field h-8 w-auto text-[11.5px]"
          aria-label="Filter prompts by mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as any)}
        >
          <option value="all">All modes</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
        </select>
        <select
          className="field h-8 w-auto text-[11.5px]"
          aria-label="Sort prompts"
          value={sort}
          onChange={(e) => setSort(e.target.value as any)}
        >
          <option value="recent">Newest</option>
          <option value="used">Most used</option>
          <option value="az">A–Z</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="mono text-[9.5px] text-[var(--faint)]">{list.length} prompts</span>
          <Button size="sm" onClick={() => app.setSavePrompt(true)}>
            Save current
          </Button>
        </div>
      </div>

      <div className="scroll min-h-0 flex-1 p-5">
        {tab === "characters" ? <CharacterCollections /> : list.length === 0 ? (
          app.prompts.length > 0 ? (
            <Empty
              title="Nothing matches"
              sub="No prompt matches this search and filter combination."
              action={
                <Button
                  onClick={() => {
                    setQ("");
                    setTab("all");
                    setMode("all");
                  }}
                >
                  Clear search and filters
                </Button>
              }
            />
          ) : (
            <Empty
              title="No prompts here yet"
              sub="Save what works. A prompt with [Image 1] tokens can be re-used with a completely different reference set."
              action={<Button onClick={() => app.setSavePrompt(true)}>Save the current prompt</Button>}
            />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((p) => (
              <Card key={p.id} prompt={p} onOpen={() => setDetail(p)} />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!detail}
        onClose={() => {
          if (!hasUnsavedChanges || window.confirm("Discard unsaved recipe changes?")) setDetail(null);
        }}
        width={760}
        title={liveDetail?.title}
        sub={liveDetail ? `${liveDetail.mode} · ${liveDetail.modelId} · used ${liveDetail.useCount}×` : undefined}
        footer={
          liveDetail && (
            <>
              <Button variant="ghost" className="min-h-11" onClick={async () => {
                if (await copyText(finalText)) app.toast("Prompt copied.", "ok");
              }}>
                <Copy size={12} /> Copy
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 text-[var(--rose)]"
                onClick={() => {
                  void app.deletePrompt(liveDetail.id);
                  setDetail(null);
                }}
              >
                <Trash2 size={12} /> Delete
              </Button>
              <Button className="min-h-11" onClick={() => {
                const prompt = { ...liveDetail, title: editTitle, text: finalText, recipe: editRecipe, exampleMediaIds: editExampleIds };
                setDetail(null);
                window.requestAnimationFrame(() => app.picker.openPicker("prompt", { prompt }));
              }}>
                Use with references
              </Button>
              <Button variant="primary" className="min-h-11" onClick={() => {
                app.applyPrompt({ ...liveDetail, title: editTitle, text: finalText, recipe: editRecipe, exampleMediaIds: editExampleIds });
                setDetail(null);
              }}>
                Use in studio <ArrowUpRight size={12} />
              </Button>
            </>
          )
        }
      >
        {liveDetail && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="field h-9 min-h-11 min-w-[180px] flex-1 text-[13px] [@media(pointer:coarse)]:text-base"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                aria-label="Prompt title"
              />
              <div role="status" aria-live="polite" aria-atomic="true" className={cn("text-[11px]", hasUnsavedChanges || savingRecipe || restoringVersion ? "text-[var(--accent)]" : "text-[var(--muted)]")}>
                {recipeStatus}
              </div>
              <Button
                size="sm"
                className="min-h-11"
                disabled={savingRecipe || restoringVersion || editExampleIds.length > 12 || invalidExampleIds.length > 0 || !editRecipe.identity.trim() || !hasUnsavedChanges}
                onClick={async () => {
                  if (savingRecipe || restoringVersion) return;
                  setSavingRecipe(true);
                  try {
                    const saved = await app.editPrompt(liveDetail.id, {
                      title: editTitle.trim() || liveDetail.title,
                      text: finalText,
                      recipe: editRecipe,
                      exampleMediaIds: editExampleIds,
                    });
                    if (saved) {
                      setEditTitle(saved.title);
                      setEditRecipe(saved.recipe ?? editRecipe);
                      setEditExampleIds(saved.exampleMediaIds ?? []);
                      app.toast("Recipe and examples saved.", "ok");
                    }
                  } finally {
                    setSavingRecipe(false);
                  }
                }}
              >
                {savingRecipe ? "Saving…" : "Save recipe"}
              </Button>
            </div>
            <Segmented
              value={detailTab}
              onChange={setDetailTab}
              className="w-full sm:w-auto [&>button]:min-h-11"
              options={[
                { id: "recipe", label: "Recipe" },
                { id: "examples", label: `Examples${editExampleIds.length ? ` · ${editExampleIds.length}` : ""}` },
                { id: "history", label: `History${liveDetail.history?.length ? ` · ${liveDetail.history.length}` : ""}` },
              ]}
            />
            {detailTab === "recipe" && (
              <div id="prompt-detail-recipe" role="tabpanel" aria-label="Recipe" className="space-y-3">
                <PromptRecipe value={editRecipe} onChange={setEditRecipe} referenceCount={referenceCount} isVisual={isVisual} />
                <details className="rounded-xl border border-[var(--line)] p-3" open>
                  <summary className="min-h-11 cursor-pointer text-[11.5px] font-medium text-[var(--paper)]">Generation settings, references, and notes</summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {liveDetail.tags.map((t) => <span key={t} className="chip">{t}</span>)}
                      {liveDetail.params.aspect && <span className="chip">{liveDetail.params.aspect}</span>}
                      {liveDetail.params.size && <span className="chip">{liveDetail.params.size.replace("*", "×")}</span>}
                      {liveDetail.params.resolution && <span className="chip">{liveDetail.params.resolution}</span>}
                      {liveDetail.params.duration && <span className="chip">{liveDetail.params.duration}s</span>}
                      {liveDetail.params.voice && <span className="chip">{liveDetail.params.voice}</span>}
                    </div>
                    <div>
                      <div className="label mb-1.5">Saved references</div>
                      {(liveDetail.params.refs ?? []).length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {(liveDetail.params.refs ?? []).map((ref, index) => {
                            const media = app.media.find((asset) => asset.id === ref.mediaId);
                            const kind = media?.kind === "video" ? "Video" : media?.kind === "audio" ? "Audio" : "Image";
                            return (
                              <div key={`${ref.mediaId}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2 py-1.5">
                                {media?.thumb && <Img src={media.thumb} alt="" className="h-8 w-10 rounded object-cover" />}
                                <span className="mono text-[9px] text-[var(--faint)]">[{kind} {index + 1}]</span>
                                <span className="max-w-[220px] truncate text-[10.5px]">{media?.name ?? ref.mediaId}</span>
                                <span className="chip">{ref.role}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--faint)]">No references are saved with this prompt. Attach them in Studio or choose Use with references.</div>
                      )}
                    </div>
                    {liveDetail.notes && <div className="text-[12px] leading-relaxed text-[var(--muted)]">{liveDetail.notes}</div>}
                  </div>
                </details>
              </div>
            )}
            {detailTab === "examples" && (
              <div id="prompt-detail-examples" role="tabpanel" aria-label="Examples" className="space-y-3">
                <section className="space-y-2 rounded-xl border border-[var(--line)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="label">Generated examples</div>
                      <div className="mt-1 text-[10px] text-[var(--faint)]">Choose generated outputs to represent this recipe.</div>
                    </div>
                    <span className="mono text-[9px] text-[var(--faint)]">{editExampleIds.length}/12 selected</span>
                  </div>
                  {availableExamples.length ? (
                    <div className="scroll max-h-[160px] space-y-1 overflow-auto">
                      {availableExamples.map((media) => (
                        <label key={media.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--panel-2)]">
                          <input
                            type="checkbox"
                            checked={editExampleIds.includes(media.id)}
                            disabled={!editExampleIds.includes(media.id) && editExampleIds.length >= 12}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setEditExampleIds((current) => checked ? [...current, media.id] : current.filter((id) => id !== media.id));
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">{media.name}</span>
                          <span className="chip">{media.kind}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[var(--faint)]">Generate an output to add a real example.</div>
                  )}
                  {invalidExampleIds.length > 0 && (
                    <div className="space-y-1 rounded-lg border border-[var(--line)] px-2.5 py-2">
                      <div className="text-[10px] text-[var(--muted)]">Remove unavailable examples before saving.</div>
                      {invalidExampleIds.map((id) => (
                        <div key={id} className="flex items-center gap-2 text-[10px] text-[var(--faint)]">
                          <span className="min-w-0 flex-1 truncate">{id}</span>
                          <button className="min-h-11 px-2 text-[var(--accent)]" onClick={() => setEditExampleIds((current) => current.filter((value) => value !== id))}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedExamples.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {selectedExamples.map((media) => (
                        <div key={media.id} className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-elev)]">
                          {media.kind === "audio" ? <div className="p-3"><Waveform src={media.url ?? ""} seed={media.id} compact /></div> : media.kind === "video" ? (
                            <VideoPlayer src={media.url ?? ""} poster={media.thumb} className="aspect-video w-full bg-black object-contain" />
                          ) : (
                            <Img src={media.thumb ?? media.url} alt={media.name} className="aspect-video w-full object-contain" />
                          )}
                          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                            <span className="min-w-0 truncate text-[10.5px]">{media.name}</span>
                            <span className="chip">{media.source === "generated" ? "Generated example" : "Reference"}</span>
                          </div>
                          {(() => {
                            const exampleJob = app.jobs.find((job) => job.id === media.jobId);
                            return exampleJob ? <div className="space-y-1 border-t border-[var(--line)] px-2.5 py-2 text-[10px] text-[var(--muted)]">
                              <div>{exampleJob.demo ? "Demo example · " : ""}{exampleJob.modelId} · {exampleJob.spec.size || exampleJob.spec.resolution} {exampleJob.mode === "video" ? `· ${exampleJob.spec.duration}s` : ""}</div>
                              <div className="break-words">References: {exampleJob.spec.refs.map((ref) => app.media.find((asset) => asset.id === ref.mediaId)?.name ?? "Unavailable reference").join(", ") || "None"}</div>
                            </div> : <div className="px-2.5 pb-2 text-[10px] text-[var(--faint)]">Generation settings unavailable</div>;
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
            {detailTab === "history" && (
              <div id="prompt-detail-history" role="tabpanel" aria-label="History" className="space-y-2">
                {(liveDetail.history?.length ?? 0) > 0 ? liveDetail.history!.map((version, i) => (
                  <div key={`${version.editedAt}-${i}`} className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11.5px]">{version.title}</div>
                      <div className="line-clamp-2 text-[10.5px] leading-relaxed text-[var(--faint)]">{version.text}</div>
                      <div className="mono mt-0.5 text-[8.5px] text-[var(--faint)]">{new Date(version.editedAt).toLocaleString()}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={savingRecipe || restoringVersion}
                      onClick={async () => {
                        if (savingRecipe || restoringVersion) return;
                        setRestoringVersion(true);
                        try {
                          const restoredRecipe = version.recipe ?? initialPromptRecipe(version.text, liveDetail.mode !== "audio");
                          const saved = await app.editPrompt(liveDetail.id, {
                            title: version.title,
                            text: compilePromptRecipe(restoredRecipe, version.params.refs?.filter((ref) => app.media.find((media) => media.id === ref.mediaId)?.kind === "image").length ?? 0, liveDetail.mode !== "audio"),
                            params: version.params,
                            recipe: restoredRecipe,
                          });
                          if (saved) {
                            setEditTitle(saved.title);
                            setEditRecipe(saved.recipe ?? restoredRecipe);
                            setEditExampleIds(saved.exampleMediaIds ?? []);
                            app.toast("Restored. What you had is now the newest version.", "ok");
                          }
                        } finally {
                          setRestoringVersion(false);
                        }
                      }}
                    >
                      {restoringVersion ? "Restoring…" : "Restore"}
                    </Button>
                  </div>
                )) : (
                  <div className="rounded-xl border border-[var(--line)] px-3 py-6 text-center text-[11px] text-[var(--faint)]">No earlier versions.</div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
