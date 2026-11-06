import { useEffect, useMemo, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import type { MediaAsset, PromptRecord, RefRole } from "@core";
import { useApp } from "../store";
import { Modal } from "../ui";

const cameraMoves = ["Static camera", "Slow push in", "Slow pull back", "Pan left", "Pan right", "Orbit the subject", "Handheld drift"];
const motionRecipes = [
  { id: "portrait", label: "Subtle portrait motion", prompt: "The subject breathes naturally, with a gentle blink and slight head movement." },
  { id: "walk", label: "Walk forward", prompt: "The subject walks forward at a relaxed pace with natural body movement." },
  { id: "turntable", label: "Product turntable", prompt: "The product rotates slowly in place, revealing its shape and material details." },
  { id: "custom", label: "Custom motion", prompt: "" },
];

export function VideoHandoff({ media, onClose }: { media: MediaAsset | null; onClose: () => void }) {
  const app = useApp();
  const models = useMemo(
    () => app.models.filter((model) => model.mode === "video" && (model.refs.first_frame > 0 || model.refs.reference > 0)),
    [app.models]
  );
  const [modelId, setModelId] = useState("");
  const [motionRecipe, setMotionRecipe] = useState("portrait");
  const [motion, setMotion] = useState(motionRecipes[0].prompt);
  const [camera, setCamera] = useState(cameraMoves[1]);
  const [duration, setDuration] = useState(5);
  const [sourceRole, setSourceRole] = useState<RefRole>("first_frame");
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [extraRoles, setExtraRoles] = useState<Record<string, RefRole>>({});

  const model = models.find((item) => item.id === modelId) ?? models[0];
  const images = app.media.filter((item) => item.kind === "image" && item.id !== media?.id);
  const roles = useMemo(() => {
    if (!model) return [] as RefRole[];
    return (["reference", "first_frame", "last_frame"] as const).filter((role) => model.refs[role] > 0);
  }, [model]);

  useEffect(() => {
    if (!models.some((item) => item.id === modelId)) setModelId(models[0]?.id ?? "");
  }, [models, modelId]);

  useEffect(() => {
    if (!media) return;
    setSourceRole("first_frame");
    setExtraIds([]);
    setExtraRoles({});
    setMotionRecipe("portrait");
    setMotion(motionRecipes[0].prompt);
    setCamera(cameraMoves[1]);
    setDuration(5);
  }, [media?.id]);

  useEffect(() => {
    if (!model) return;
    const initialRole = model.refs.first_frame > 0 ? "first_frame" : "reference";
    setSourceRole((current) => (roles.includes(current) ? current : initialRole));
    setDuration((current) => Math.min(model.duration?.max ?? 5, Math.max(model.duration?.min ?? 1, current)));
    setExtraRoles((current) => Object.fromEntries(Object.entries(current).filter(([, role]) => roles.includes(role))));
  }, [model, roles]);

  if (!media) return null;

  const refCounts = new Map<RefRole, number>();
  refCounts.set(sourceRole, 1);
  for (const id of extraIds) {
    const role = roles.includes(extraRoles[id]) ? extraRoles[id] : roles.find((candidate) => candidate !== sourceRole) ?? sourceRole;
    refCounts.set(role, (refCounts.get(role) ?? 0) + 1);
  }
  const prompt = [motion.trim(), camera && `Camera: ${camera}.`].filter(Boolean).join("\n\n");
  const refs: { mediaId: string; role: RefRole }[] = [
    { mediaId: media.id, role: sourceRole },
    ...extraIds.map((id) => ({ mediaId: id, role: roles.includes(extraRoles[id]) ? extraRoles[id] : roles.find((candidate) => candidate !== sourceRole) ?? sourceRole })),
  ];
  const isFrameRole = (role: RefRole) => role === "first_frame" || role === "last_frame";
  const extraRole = (id: string) => roles.includes(extraRoles[id]) ? extraRoles[id] : roles.find((candidate) => candidate !== sourceRole) ?? sourceRole;
  const sourceRoleOptions = roles.filter((role) =>
    !model?.refs.exclusiveFrames || extraIds.every((id) => isFrameRole(role) === isFrameRole(extraRole(id)))
  );
  const availableRoleSlots = roles.reduce((total, role) => {
    if (model?.refs.exclusiveFrames && isFrameRole(role) !== isFrameRole(sourceRole)) return total;
    return total + Math.max(0, (model?.refs[role] ?? 0) - (refCounts.get(role) ?? 0));
  }, 0);
  const missingRequiredRoles = (model?.refs.required ?? []).filter((role) => (refCounts.get(role) ?? 0) < model!.refs[role]);
  const roleOptions = (current: RefRole) =>
    roles.filter((role) =>
      (role === current || (refCounts.get(role) ?? 0) < (model?.refs[role] ?? 0)) &&
      (!model?.refs.exclusiveFrames || isFrameRole(role) === isFrameRole(sourceRole))
    );
  const hasReferenceConflict = Boolean(model?.refs.exclusiveFrames &&
    refs.some((ref) => ref.role === "reference") &&
    refs.some((ref) => ref.role === "first_frame" || ref.role === "last_frame"));
  const hasInvalidReferences = Boolean(model && (
    refs.some((ref) => model.refs[ref.role] === 0) ||
    roles.some((role) => (refCounts.get(role) ?? 0) > model.refs[role]) ||
    model.refs[sourceRole] < 1 ||
    hasReferenceConflict
  ));

  const openInStudio = () => {
    if (!model || !prompt.trim() || missingRequiredRoles.length > 0 || hasInvalidReferences) return;
    const boundedDuration = Math.min(model.duration?.max ?? duration, Math.max(model.duration?.min ?? duration, duration));
    const now = new Date().toISOString();
    const record: PromptRecord = {
      id: `handoff-${media.id}-${Date.now()}`,
      title: "Image to video handoff",
      text: prompt,
      mode: "video",
      modelId: model.id,
      params: { duration: boundedDuration, refs },
      tags: [],
      favorite: false,
      useCount: 0,
      createdAt: now,
    };
    app.applyPrompt(record);
    onClose();
  };

  return (
    <Modal
      open={Boolean(media)}
      onClose={onClose}
      title="Image to video"
      sub={media ? `Starting frame · ${media.name}` : undefined}
      width={760}
      className="max-h-[92dvh] overflow-y-auto"
      footer={(
        <>
          <button className="btn btn-sm mr-auto" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={!model || !prompt.trim() || missingRequiredRoles.length > 0 || hasInvalidReferences} onClick={openInStudio}>Open in Studio <ArrowRight size={12} /></button>
        </>
      )}
    >
          <style>{`@media (pointer: coarse) { .video-handoff-field { font-size: 16px; } }`}</style>
          {media && <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--line)] p-2.5">
            <div className="h-16 w-16 flex-none overflow-hidden rounded-md bg-black/20">
              {(media.url || media.thumb) && <img src={media.url || media.thumb} alt={media.name} className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px]" title={media.name}>{media.name}</div>
              <div className="mono mt-1 text-[9px] text-[var(--faint)]">Starting image · {sourceRole.replaceAll("_", " ")}</div>
            </div>
          </div>}
          <div className="scroll min-h-0 space-y-4 overflow-auto">
            {models.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">No registered video model supports image or frame references.</p>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Video model</span>
                  <select className="video-handoff-field field h-9 w-full text-[12px]" value={model?.id ?? ""} onChange={(event) => {
                    const next = models.find((item) => item.id === event.target.value);
                    setModelId(event.target.value);
                    setExtraIds([]);
                    setExtraRoles({});
                    setSourceRole(next?.refs.first_frame ? "first_frame" : "reference");
                    setDuration(next?.duration?.default ?? 5);
                  }}>
                    {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Starting image role</span>
                    <select className="video-handoff-field field h-9 w-full text-[12px]" value={sourceRole} onChange={(event) => setSourceRole(event.target.value as RefRole)}>
                      {sourceRoleOptions.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Duration</span>
                    <select className="video-handoff-field field h-9 w-full text-[12px]" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                      {Array.from({ length: Math.max(1, (model?.duration?.max ?? 5) - (model?.duration?.min ?? 1) + 1) }, (_, index) => (model?.duration?.min ?? 1) + index).map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1.5">
                  <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Motion recipe</span>
                  <select className="video-handoff-field field h-9 w-full text-[12px]" value={motionRecipe} onChange={(event) => {
                    const next = event.target.value;
                    setMotionRecipe(next);
                    if (next !== "custom") setMotion(motionRecipes.find((recipe) => recipe.id === next)?.prompt ?? "");
                  }}>
                    {motionRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.label}</option>)}
                  </select>
                  <textarea className="video-handoff-field field min-h-[88px] w-full resize-y text-[12px] leading-relaxed" value={motion} onChange={(event) => { setMotionRecipe("custom"); setMotion(event.target.value); }} placeholder="Describe how the subject and scene move" />
                </label>
                <label className="block space-y-1.5">
                  <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Camera</span>
                  <select className="video-handoff-field field h-9 w-full text-[12px]" value={camera} onChange={(event) => setCamera(event.target.value)}>
                    {cameraMoves.map((move) => <option key={move} value={move}>{move}</option>)}
                  </select>
                </label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Additional image references</span>
                    <button className="mono text-[9px] text-[var(--accent)] disabled:opacity-40" disabled={!images.some((item) => !extraIds.includes(item.id)) || availableRoleSlots === 0} onClick={() => {
                      const image = images.find((item) => !extraIds.includes(item.id));
                      const role = roles.find((candidate) =>
                        (refCounts.get(candidate) ?? 0) < model!.refs[candidate] &&
                        (!model!.refs.exclusiveFrames || isFrameRole(candidate) === isFrameRole(sourceRole))
                      );
                      if (!image || !role) return;
                      setExtraIds((current) => [...current, image.id]);
                      setExtraRoles((current) => ({ ...current, [image.id]: role }));
                    }}>
                      Add reference
                    </button>
                  </div>
                  {extraIds.map((id) => {
                    const asset = images.find((item) => item.id === id);
                    return (
                      <div key={id} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-[var(--line)] p-2 sm:grid-cols-[minmax(0,1fr)_minmax(120px,auto)_auto]">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="h-9 w-9 flex-none overflow-hidden rounded bg-black/20">{asset && (asset.thumb || asset.url) && <img src={asset.thumb || asset.url} alt="" className="h-full w-full object-cover" />}</div>
                          <select className="video-handoff-field field h-8 min-w-0 flex-1 text-[11px]" value={id} onChange={(event) => {
                            const nextId = event.target.value;
                            setExtraIds((current) => current.map((value) => value === id ? nextId : value));
                            setExtraRoles((current) => {
                              const next = { ...current };
                              const role = next[id];
                              delete next[id];
                              if (role) next[nextId] = role;
                              return next;
                            });
                          }}>
                            {images.map((item) => <option key={item.id} value={item.id} disabled={extraIds.includes(item.id) && item.id !== id}>{item.name}</option>)}
                          </select>
                        </div>
                        <select className="video-handoff-field field h-8 text-[11px]" value={extraRole(id)} onChange={(event) => setExtraRoles((current) => ({ ...current, [id]: event.target.value as RefRole }))}>
                          {roleOptions(extraRole(id)).map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}
                        </select>
                        <button className="icon-btn" aria-label={`Remove ${asset?.name ?? "reference"}`} onClick={() => setExtraIds((current) => current.filter((value) => value !== id))}><X size={12} /></button>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  <span className="mono text-[9px] uppercase tracking-wide text-[var(--faint)]">Final prompt</span>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-black/10 p-3 text-[11px] leading-relaxed text-[var(--paper)]">{prompt || "Add a motion recipe to continue."}</pre>
                  {missingRequiredRoles.length > 0 && <p className="text-[10px] text-[var(--rose)]">This model requires: {missingRequiredRoles.map((role) => role.replaceAll("_", " ")).join(", ")}.</p>}
                  {hasInvalidReferences && <p className="text-[10px] text-[var(--rose)]">The selected reference roles exceed this model’s limits.</p>}
                </div>
              </>
            )}
          </div>
    </Modal>
  );
}
