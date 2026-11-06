import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Image as ImageIcon, Plus, Sparkles, UserRound } from "lucide-react";
import type { MediaAsset, PromptRecord } from "@core";
import { api } from "../api";
import { useApp } from "../store";
import { Button, Empty, Modal } from "../ui";
import { Img } from "./Media";

type QualityLabel = "best-likeness" | "best-motion";
type CharacterMedia = MediaAsset & {
  referenceStatus?: "candidate" | "approved";
  qualityLabels?: QualityLabel[];
};
type MediaPatch = Partial<Pick<CharacterMedia, "referenceStatus" | "qualityLabels" | "tags">>;
type CharacterRecord = {
  slug: string;
  name: string;
  prompts: PromptRecord[];
  referenceIds: Set<string>;
  portrait?: PromptRecord;
};

const reservedTags = new Set([
  "character", "reference", "portrait", "studio", "identity-preserving", "gallery",
  "best-likeness", "best-motion", "source-reference", "generated-reference",
]);

function titleFromSlug(slug: string) {
  return slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function isSlug(value: string) {
  return /^[a-z]+(?:-[a-z]+)+$/.test(value) && !reservedTags.has(value);
}

function promptCharacterName(prompt: PromptRecord, slug: string) {
  const prefix = prompt.title.replace(/\s+(studio portrait|identity motion|face close-up|full-length fashion|daytime architectural editorial|slow camera orbit)$/i, "");
  return prefix && prefix !== prompt.title ? prefix : titleFromSlug(slug);
}

export function CharacterCollections() {
  const app = useApp();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [assignId, setAssignId] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retryPatches, setRetryPatches] = useState<Record<string, MediaPatch>>({});
  const [assignError, setAssignError] = useState("");
  const [inspectedMedia, setInspectedMedia] = useState<CharacterMedia | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusAfterMove, setFocusAfterMove] = useState<{ id: string; status: "candidate" | "approved" } | null>(null);
  const statusButtons = useRef(new Map<string, HTMLButtonElement>());

  const characters = useMemo(() => {
    const records = new Map<string, CharacterRecord>();
    const ensure = (slug: string, name = titleFromSlug(slug)) => {
      const record = records.get(slug);
      if (record) return record;
      const created: CharacterRecord = { slug, name, prompts: [], referenceIds: new Set<string>() };
      records.set(slug, created);
      return created;
    };

    for (const prompt of app.prompts) {
      if (!prompt.id.startsWith("character-")) continue;
      const slug = prompt.tags.find((tag) => isSlug(tag) && prompt.id.startsWith(`character-${tag}-`));
      if (!slug) continue;
      const record = ensure(slug, promptCharacterName(prompt, slug));
      record.prompts.push(prompt);
      for (const ref of prompt.params.refs ?? []) record.referenceIds.add(ref.mediaId);
      if (prompt.id === `character-${slug}-portrait` || /studio portrait$/i.test(prompt.title)) record.portrait = prompt;
    }

    for (const media of app.media) {
      const slug = media.tags.find((tag) => isSlug(tag) && (media.tags.includes("character") || records.has(tag)));
      if (!slug) continue;
      const record = ensure(slug);
      record.referenceIds.add(media.id);
    }

    return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [app.media, app.prompts]);

  const active = characters.find((character) => character.slug === selectedSlug) ?? characters[0];
  const allMedia = app.media as CharacterMedia[];
  const references = active
    ? allMedia.filter((media) => active.referenceIds.has(media.id) || media.tags.includes(active.slug))
    : [];
  const candidates = references.filter((media) => media.referenceStatus !== "approved");
  const approved = references.filter((media) => media.referenceStatus === "approved");
  const referenceIds = new Set(references.map((media) => media.id));
  const relatedJobs = active
    ? app.jobs.filter((job) => job.spec.refs.some((ref) => referenceIds.has(ref.mediaId)))
    : [];
  const relatedJobIds = new Set(relatedJobs.map((job) => job.id));
  const generatedResults = allMedia.filter((media) =>
    media.source === "generated" && media.jobId && relatedJobIds.has(media.jobId) && !referenceIds.has(media.id)
  );
  const availableMedia = allMedia.filter((media) =>
    media.kind === "image" && !characters.some((character) => media.tags.includes(character.slug)) && !active?.referenceIds.has(media.id)
  );
  const suggestedReference = approved.find((media) => media.kind === "image") ?? candidates.find((media) => media.kind === "image");

  useEffect(() => {
    if (!focusAfterMove) return;
    const media = references.find((item) => item.id === focusAfterMove.id);
    if (!media || (media.referenceStatus ?? "candidate") !== focusAfterMove.status) return;
    const target = statusButtons.current.get(`${focusAfterMove.status}:${focusAfterMove.id}`);
    if (!target) return;
    target.focus();
    setFocusAfterMove(null);
  }, [references, focusAfterMove]);

  const save = async (media: CharacterMedia, patch: MediaPatch): Promise<boolean> => {
    if (pending.includes(media.id)) return false;
    setPending((current) => [...current, media.id]);
    setErrors((current) => ({ ...current, [media.id]: "" }));
    setRetryPatches((current) => ({ ...current, [media.id]: patch }));
    try {
      await api.patchMedia(media.id, patch);
      await app.refresh();
      setRetryPatches((current) => {
        const next = { ...current };
        delete next[media.id];
        return next;
      });
      return true;
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [media.id]: error instanceof Error ? error.message : "Could not save this reference.",
      }));
      return false;
    } finally {
      setPending((current) => current.filter((id) => id !== media.id));
    }
  };

  const assign = async () => {
    if (!active || !assignId) return;
    setAssignError("");
    const media = allMedia.find((item) => item.id === assignId);
    if (!media) return;
    const saved = await save(media, {
      tags: Array.from(new Set([...media.tags, "character", active.slug])),
      referenceStatus: "candidate",
    });
    if (saved) setAssignId("");
    else setAssignError("Could not assign this image. Retry the save when the connection is available.");
  };

  const changeStatus = (media: CharacterMedia, status: "candidate" | "approved") => {
    void save(media, { referenceStatus: status }).then((saved) => {
      if (!saved) return;
      setAnnouncement(`${media.name} moved to ${status === "approved" ? "approved references" : "candidate references"}.`);
      setFocusAfterMove({ id: media.id, status });
    });
  };

  const toggleQuality = (media: CharacterMedia, label: QualityLabel) => {
    const current = media.qualityLabels ?? [];
    const next = current.includes(label) ? current.filter((value) => value !== label) : [...current, label];
    void save(media, { qualityLabels: next });
  };

  if (!characters.length) {
    return (
      <div className="rounded-xl border border-[var(--line)] p-4">
        <Empty title="No character prompts found" sub="Character pages appear when prompts use the character-* records and slug tags." />
      </div>
    );
  }

  return (
    <>
    <div className="grid min-h-0 gap-4 xl:grid-cols-[190px_minmax(0,1fr)]">
      <nav aria-label="Character collections" className="flex min-w-0 flex-row items-stretch gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
        <h3 className="mono flex-none self-center px-1 text-[9px] uppercase tracking-[0.14em] text-[var(--faint)]">Characters</h3>
        {characters.map((character) => {
          const count = allMedia.filter((media) => character.referenceIds.has(media.id) || media.tags.includes(character.slug)).length;
          return (
            <button
              key={character.slug}
              type="button"
              aria-pressed={active.slug === character.slug}
              aria-current={active.slug === character.slug ? "page" : undefined}
              aria-label={`${character.name}, ${count} references${active.slug === character.slug ? ", selected" : ""}`}
              onClick={() => {
                setSelectedSlug(character.slug);
                setAssignId("");
                setAssignError("");
              }}
              className={`flex w-auto min-w-[150px] flex-none items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] xl:w-full ${active.slug === character.slug ? "border-[var(--line-2)] bg-[var(--panel-2)] text-[var(--paper)]" : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--panel)]"}`}
            >
              <span className="flex min-w-0 items-center gap-2 truncate"><UserRound size={13} /><span className="truncate">{character.name}</span></span>
              <span className="mono flex-none text-[9px] text-[var(--faint)]">{count}</span>
            </button>
          );
        })}
      </nav>

      <section aria-label={`${active.name} character page`} className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
          <div>
            <h3 className="serif text-[20px]">{active.name}</h3>
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Reference counts">
              <span className="rounded-md border border-[var(--accent)]/35 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-2 py-1 text-[10px] text-[var(--paper)]">Approved · {approved.length}</span>
              <span className="rounded-md border border-[var(--line-2)] px-2 py-1 text-[10px] text-[var(--muted)]">Candidates · {candidates.length}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="field h-8 max-w-[230px] text-[11px]" value={assignId} onChange={(event) => { setAssignId(event.target.value); setAssignError(""); }} aria-label={`Choose an image to assign to ${active.name}`}>
              <option value="">Assign existing image…</option>
              {availableMedia.map((media) => <option key={media.id} value={media.id}>{media.name}</option>)}
            </select>
            <Button size="sm" disabled={!assignId || pending.includes(assignId)} onClick={() => void assign()}><Plus size={12} /> {assignError ? "Retry assign" : "Assign"}</Button>
          </div>
        </header>
        {assignError && <p role="alert" className="text-[10px] text-[var(--rose)]">{assignError}</p>}
        <p className="text-[10.5px] leading-relaxed text-[var(--muted)]">Approved references are your chosen character anchors. Candidates are supplied or generated images awaiting review; generated images can vary from their source.</p>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

        <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3.5">
          <h4 className="mono mb-2 text-[9px] uppercase tracking-[0.14em] text-[var(--faint)]">Appearance described by portrait prompt</h4>
          {active.portrait ? (
            <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-[var(--muted)]">{active.portrait.text}</p>
          ) : (
            <p className="text-[11.5px] text-[var(--faint)]">No portrait prompt is available for this character.</p>
          )}
        </section>

        <div className="grid gap-4 2xl:grid-cols-2">
          <ReferenceGroup
            title="Approved references"
            media={approved}
            pending={pending}
            errors={errors}
            retryPatches={retryPatches}
            onStatus={changeStatus}
            onQuality={toggleQuality}
            onRetry={(media) => void save(media, retryPatches[media.id])}
            group="approved"
            registerStatusButton={(id, status, button) => {
              const key = `${status}:${id}`;
              if (button) statusButtons.current.set(key, button);
              else statusButtons.current.delete(key);
            }}
            onInspect={setInspectedMedia}
          />
          <ReferenceGroup
            title="Candidate references"
            media={candidates}
            pending={pending}
            errors={errors}
            retryPatches={retryPatches}
            onStatus={changeStatus}
            onQuality={toggleQuality}
            onRetry={(media) => void save(media, retryPatches[media.id])}
            group="candidate"
            registerStatusButton={(id, status, button) => {
              const key = `${status}:${id}`;
              if (button) statusButtons.current.set(key, button);
              else statusButtons.current.delete(key);
            }}
            onInspect={setInspectedMedia}
          />
        </div>

        <section>
          <div className="mb-2 flex items-center gap-2"><Sparkles size={13} className="text-[var(--accent)]" /><h4 className="mono text-[9px] uppercase tracking-[0.14em] text-[var(--faint)]">Related recipes</h4></div>
          {active.prompts.length ? (
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {active.prompts.map((prompt) => (
                <article key={prompt.id} className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
                  <div className="text-[11.5px] font-medium">{prompt.title}</div>
                  <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-[var(--muted)]">{prompt.text}</p>
                  <Button size="sm" className="mt-2" onClick={() => app.applyPrompt(prompt, suggestedReference ? { refAssets: [suggestedReference] } : undefined)}>Use recipe</Button>
                </article>
              ))}
            </div>
          ) : <p className="text-[11px] text-[var(--faint)]">No related prompt recipes are available.</p>}
        </section>

        <MediaResultGroup title="Generated from character references" media={generatedResults} />
      </section>
    </div>

    <Modal
      open={!!inspectedMedia}
      onClose={() => setInspectedMedia(null)}
      title={inspectedMedia?.name}
      sub={inspectedMedia ? `${inspectedMedia.referenceStatus === "approved" ? "Approved reference" : "Candidate reference"} · ${inspectedMedia.source === "generated" || inspectedMedia.tags.includes("generated-reference") ? "Generated" : "Supplied"}` : undefined}
      width={880}
      className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
    >
      {inspectedMedia && <Img src={inspectedMedia.url ?? inspectedMedia.thumb ?? ""} alt={inspectedMedia.name} className="mx-auto max-h-[70dvh] w-full rounded-lg object-contain" />}
    </Modal>
    </>
  );
}

function ReferenceGroup({
  title,
  media,
  pending,
  errors,
  retryPatches,
  onStatus,
  onQuality,
  onRetry,
  group,
  registerStatusButton,
  onInspect,
}: {
  title: string;
  media: CharacterMedia[];
  pending: string[];
  errors: Record<string, string>;
  retryPatches: Record<string, MediaPatch>;
  onStatus: (media: CharacterMedia, status: "candidate" | "approved") => void;
  onQuality: (media: CharacterMedia, label: QualityLabel) => void;
  onRetry: (media: CharacterMedia) => void;
  group: "candidate" | "approved";
  registerStatusButton: (id: string, status: "candidate" | "approved", button: HTMLButtonElement | null) => void;
  onInspect: (media: CharacterMedia) => void;
}) {
  const app = useApp();
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="mono text-[9px] uppercase tracking-[0.14em] text-[var(--faint)]">{title}</h4>
        <span className="mono text-[9px] text-[var(--faint)]">{media.length}</span>
      </div>
      {media.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {media.map((asset) => {
            const busy = pending.includes(asset.id);
            const error = errors[asset.id];
            const approved = asset.referenceStatus === "approved";
            const sourceLabel = asset.tags.includes("generated-reference") || asset.source === "generated"
              ? "Generated reference" : "Supplied reference";
            return (
              <article key={asset.id} className="min-w-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)]">
                <div className="relative aspect-square bg-[var(--bg)]">
                  <Img src={asset.thumb ?? asset.url ?? ""} alt={asset.name} className="h-full w-full object-cover" />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-1 font-mono text-[8px] text-white">{sourceLabel}</span>
                </div>
                <div className="space-y-2 p-2">
                  <div className="truncate text-[10px] text-[var(--muted)]" title={asset.name}>{asset.name}</div>
                  <button className="btn btn-sm w-full justify-center" onClick={() => onInspect(asset)} aria-label={`Inspect ${asset.name} at full size`}>Inspect image</button>
                  <button className="btn btn-sm w-full justify-center" onClick={() => app.useAsReference(asset)}><ImageIcon size={11} /> Use reference</button>
                  <div className="flex flex-wrap gap-1">
                    {(["best-likeness", "best-motion"] as const).map((label) => {
                      const selected = (asset.qualityLabels ?? []).includes(label);
                      return <button key={label} className={`chip ${selected ? "text-[var(--accent)]" : ""}`} disabled={busy || !!error} aria-pressed={selected} onClick={() => onQuality(asset, label)}>{label === "best-likeness" ? "Best likeness" : "Best motion"}</button>;
                    })}
                  </div>
                  <button
                    ref={(button: HTMLButtonElement | null) => registerStatusButton(asset.id, group, button)}
                    className="btn btn-sm flex w-full items-center justify-center"
                    disabled={busy || !!error}
                    aria-label={approved ? `Move ${asset.name} to candidate references` : `Approve ${asset.name}`}
                    onClick={() => onStatus(asset, approved ? "candidate" : "approved")}
                  >
                    {approved ? "Move to candidates" : <><Check size={11} /> Approve</>}
                  </button>
                  {busy && <p role="status" className="text-[9px] text-[var(--faint)]">Saving…</p>}
                  {error && <div role="alert" className="space-y-1 text-[9px] text-[var(--rose)]"><p>{error}</p><button className="underline" disabled={busy || !retryPatches[asset.id]} onClick={() => onRetry(asset)}>Retry save</button></div>}
                </div>
              </article>
            );
          })}
        </div>
      ) : <p className="rounded-lg border border-dashed border-[var(--line)] px-3 py-5 text-center text-[10.5px] text-[var(--faint)]">No {title.toLowerCase()} yet.</p>}
    </section>
  );
}

function MediaResultGroup({ title, media }: { title: string; media: CharacterMedia[] }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2"><ImageIcon size={12} className="text-[var(--faint)]" /><h4 className="mono text-[9px] uppercase tracking-[0.14em] text-[var(--faint)]">{title}</h4><span className="mono text-[9px] text-[var(--faint)]">{media.length}</span></div>
      {media.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((asset) => <div key={asset.id} className="overflow-hidden rounded-lg border border-[var(--line)]"><div className="aspect-square"><Img src={asset.thumb ?? asset.url ?? ""} alt={asset.name} className="h-full w-full object-cover" /></div><p className="truncate px-2 py-1.5 text-[10px] text-[var(--muted)]">{asset.name}</p></div>)}
        </div>
      ) : <p className="text-[10.5px] text-[var(--faint)]">No generated outputs reference this character’s current references yet.</p>}
  </section>
  );
}
