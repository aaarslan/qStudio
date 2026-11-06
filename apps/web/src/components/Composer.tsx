import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Clapperboard, ImagePlus, Images, Play, Plus, ShieldAlert, Sparkles, Stethoscope, Trash2, X } from "lucide-react";
import {
  MODELS,
  TTS_EMOTION_TAGS,
  compileStoryboard,
  doctorLite,
  estimateUnits,
  getModel,
  moderationRisks,
  promptVariables,
  sizeFor,
  splitScript,
  storyboardDuration,
} from "@core";
import type { ModelDef, RefRole } from "@core";
import { useApp } from "../store";
import type { RefItem } from "../store";
import { cn } from "../lib";
import { api } from "../api";
import {
  Button,
  Disclosure,
  Label,
  Modal,
  Segmented,
  Select,
  Slider,
  Stepper,
  Switch,
} from "../ui";
import { Img } from "./Media";
import { PromptEditor, PromptHint } from "./PromptEditor";

const ASPECT_LIST = [
  { id: "1:1", w: 1, h: 1 },
  { id: "4:3", w: 4, h: 3 },
  { id: "3:4", w: 3, h: 4 },
  { id: "16:9", w: 16, h: 9 },
  { id: "9:16", w: 9, h: 16 },
  { id: "3:2", w: 3, h: 2 },
  { id: "2:3", w: 2, h: 3 },
  { id: "21:9", w: 21, h: 9 },
];

function AspectShape({ ratio, active }: { ratio: string; active: boolean }) {
  const [w, h] = ratio.split(":").map(Number);
  const max = 17;
  const scale = max / Math.max(w, h);
  return (
    <span
      className="inline-block rounded-[2px] border transition-colors"
      style={{
        width: Math.max(6, Math.round(w * scale)),
        height: Math.max(6, Math.round(h * scale)),
        borderColor: active ? "var(--accent)" : "var(--line-2)",
        background: active ? "var(--accent-soft)" : "transparent",
      }}
    />
  );
}

export function ModelPicker({
  open,
  onClose,
  mode,
  current,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  mode: string;
  current: string;
  onPick: (id: string) => void;
}) {
  const models = MODELS.filter((m) => m.mode === mode);
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={700}
      title={`Choose a ${mode} model`}
      sub="Only models available through the Token Plan. Free-text model IDs won’t draw down the plan."
    >
      <div className="grid gap-2">
        {models.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              onPick(m.id);
              onClose();
            }}
            className={cn(
              "group flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
              current === m.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] hover:border-[var(--line-2)] hover:bg-[var(--panel-2)]"
            )}
          >
            <span
              className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border"
              style={{
                borderColor: current === m.id ? "var(--accent)" : "var(--line-2)",
                color: "var(--accent)",
              }}
            >
              {current === m.id && <Check size={11} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium">{m.label}</span>
                <span className="mono text-[9.5px] text-[var(--faint)]">{m.id}</span>
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-[var(--muted)]">{m.blurb}</span>
              <span className="mt-2 flex flex-wrap gap-1">
                {m.chips.map((c) => (
                  <span key={c} className="chip">
                    {c}
                  </span>
                ))}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function RefSlot({
  refItem,
  imageIndex,
  model,
  onChangeRole,
  onRemove,
  onDragStart,
  onDrop,
  dragging,
}: {
  refItem: RefItem;
  imageIndex: number;
  model: ModelDef;
  onChangeRole: (r: RefRole) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  dragging: boolean;
}) {
  const roles: RefRole[] = ["reference"];
  if (model.refs.first_frame) roles.push("first_frame");
  if (model.refs.last_frame) roles.push("last_frame");
  if (model.refs.audio) roles.push("audio");
  if (model.refs.video) roles.push("video");

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        "group relative w-[76px] flex-none overflow-hidden rounded-lg border bg-[var(--bg-elev)] transition-opacity",
        dragging ? "opacity-40" : "opacity-100"
      )}
      style={{ borderColor: "var(--line)" }}
    >
      <div className="relative h-[76px] w-full cursor-grab active:cursor-grabbing">
        <Img src={refItem.thumb} alt={refItem.name} className="h-full w-full object-cover" />
        <span
          className="absolute left-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-mono text-[9px] font-medium text-white"
          style={{ background: "rgba(0,0,0,.62)", backdropFilter: "blur(4px)" }}
        >
          {refItem.role === "reference"
            ? `I${imageIndex}`
            : refItem.role === "first_frame"
              ? "F1"
              : refItem.role === "last_frame"
                ? "F2"
                : refItem.role === "audio"
                  ? "A1"
                  : "V1"}
        </span>
        <button
          className="absolute right-1 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-white opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: "rgba(0,0,0,.62)" }}
          onClick={onRemove}
          aria-label="Remove reference"
        >
          <X size={10} />
        </button>
      </div>
      <div className="px-1.5 py-1">
        {roles.length > 1 ? (
          <select
            value={refItem.role}
            onChange={(e) => onChangeRole(e.target.value as RefRole)}
            className="mono w-full cursor-pointer appearance-none bg-transparent text-[9px] uppercase tracking-wide text-[var(--muted)] outline-none"
            title="Reference role"
            aria-label="Reference role"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r === "reference" ? "Ref" : r === "first_frame" ? "First" : r === "last_frame" ? "Last" : r === "audio" ? "Audio" : "Video"}
              </option>
            ))}
          </select>
        ) : (
          <span className="mono block truncate text-[9px] uppercase tracking-wide text-[var(--muted)]">
            {refItem.role === "reference" ? "Reference" : refItem.role.replace("_", " ")}
          </span>
        )}
      </div>
    </div>
  );
}

export function Composer() {
  const app = useApp();
  const mode = app.activeMode;
  const draft = app.drafts[mode];
  const model = getModel(draft.spec.modelId);
  const modRisks = moderationRisks(draft.spec.prompt, {
    promptExtend: Boolean(model.features.promptExtend && draft.spec.promptExtend),
  });
  const [modelOpen, setModelOpen] = useState(false);
  const [narration, setNarration] = useState("");
  const [narrationVoice, setNarrationVoice] = useState("longanhuan_v3.6");
  const [shots, setShots] = useState<{ title: string; prompt: string; seconds: number }[]>([
    { title: "", prompt: "", seconds: 3 },
    { title: "", prompt: "", seconds: 4 },
  ]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /^(image|video|audio)\//.test(f.type));
    if (!list.length) return;
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const { media } = await api.upload(file);
        app.addRefs([media]);
      } catch (err) {
        app.toast((err as Error).message, "err");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (app.view !== "studio") return;
      const target = e.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [app.view, app.activeMode, app.drafts]);

  const regenerateSize = (aspect: string, tier: string) => {
    app.patchSpec({ aspect, tier, size: sizeFor(model, aspect, tier) });
  };

  const maxN = draft.spec.sequential ? model.n.sequentialMax ?? model.n.max : model.n.max;

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
        <div className="fade-in pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
          <div className="rounded-xl border border-[var(--line-2)] bg-[var(--panel)] px-4 py-3 text-[12.5px]">
            Drop to attach as a reference
          </div>
        </div>
      )}

      <div className="scroll min-h-0 flex-1">
        <div className="space-y-5 p-4">
          {/* mode */}
          <div>
            <Segmented
              value={mode}
              accent
              options={[
                { id: "image", label: "Image" },
                { id: "video", label: "Video" },
                { id: "audio", label: "Audio" },
              ]}
              onChange={(m) => app.setMode(m)}
              className="w-full [&>button]:flex-1"
            />
          </div>

          {/* model */}
          <button
            className="group flex w-full items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 text-left transition-colors hover:border-[var(--line-2)]"
            onClick={() => setModelOpen(true)}
          >
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel-2)] text-[var(--accent)]">
              <Sparkles size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium">{model.label}</span>
                <ChevronDown size={12} className="flex-none text-[var(--faint)]" />
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-[var(--muted)]">{model.bestFor}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {model.chips.slice(0, 4).map((c) => (
                  <span key={c} className="chip">
                    {c}
                  </span>
                ))}
              </span>
            </span>
          </button>

          {/* prompt */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>{mode === "audio" ? "Script" : "Prompt"}</Label>
              <button
                className="mono text-[9.5px] uppercase tracking-wider text-[var(--faint)] transition-colors hover:text-[var(--paper)]"
                onClick={() => app.setSavePrompt(true)}
              >
                Save prompt
              </button>
            </div>
            <PromptEditor
              value={draft.spec.prompt}
              onChange={(v) => app.patchSpec({ prompt: v })}
              refs={draft.refs}
              mode={mode}
            />
            {draft.spec.prompt.trim() && modRisks.length > 0 && (
              <div
                role="alert"
                className="mt-2 rounded-xl border px-3 py-2.5"
                style={{
                  borderColor: `color-mix(in srgb, var(--${modRisks.some((r) => r.level === "high") ? "rose" : "amber"}) 45%, transparent)`,
                  background: `color-mix(in srgb, var(--${modRisks.some((r) => r.level === "high") ? "rose" : "amber"}) 8%, var(--panel))`,
                }}
              >
                <div
                  className="flex items-center gap-1.5 text-[12px] font-medium"
                  style={{ color: `var(--${modRisks.some((r) => r.level === "high") ? "rose" : "amber"})` }}
                >
                  <ShieldAlert size={13} className="flex-none" />
                  {modRisks.some((r) => r.level === "high")
                    ? "This request will likely be content moderated"
                    : "This request may be content moderated"}
                </div>
                <ul className="mt-1.5 space-y-2">
                  {modRisks.map((risk) => (
                    <li key={risk.id} className="text-[11px] leading-relaxed text-[var(--muted)]">
                      {risk.reason}
                      {risk.matches.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {risk.matches.map((m) => (
                            <span key={m} className="chip mono max-w-full truncate" title={m}>
                              “{m}”
                            </span>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--faint)]">
                  Local text check only. QwenCloud also inspects your reference media and the generated
                  frames, so a quiet scan is not a guarantee. Output rejections (
                  <span className="mono">DataInspectionFailed</span>) arrive only after generation
                  finishes — for a long video, test the riskiest shot short and at 480P first. Generate
                  still works if you choose to proceed.
                </p>
              </div>
            )}
            {promptVariables(draft.spec.prompt).length > 0 && (
              <div className="mt-2 grid gap-1.5">
                {promptVariables(draft.spec.prompt).map((name) => (
                  <label key={name} className="flex items-center gap-2">
                    <span className="mono w-28 flex-none truncate text-[9.5px] uppercase tracking-wider text-[var(--faint)]">
                      {`{{${name}}}`}
                    </span>
                    <input
                      className="field h-8 text-[12px]"
                      value={app.varsByMode[mode][name] ?? ""}
                      placeholder={`Value for ${name}`}
                      aria-label={`Value for ${name}`}
                      onChange={(e) => app.setVar(name, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            )}
            {draft.spec.prompt.trim() && doctorLite(draft.spec.prompt, mode).length > 0 && (
              <div className="mt-2">
                <Disclosure
                  title={
                    <span className="flex items-center gap-1.5">
                      <Stethoscope size={11} /> Prompt Doctor (local checks)
                    </span>
                  }
                >
                  <ul className="space-y-1.5">
                    {doctorLite(draft.spec.prompt, mode).map((hint) => (
                      <li key={hint.message} className="text-[11px] leading-relaxed text-[var(--muted)]">
                        <span className="mono mr-1.5 text-[9px] uppercase tracking-wider text-[var(--amber)]">
                          {hint.kind}
                        </span>
                        {hint.message}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              </div>
            )}
            {mode === "video" && model.family === "wan-video" && (
              <div className="mt-2">
                <Disclosure
                  title={
                    <span className="flex items-center gap-1.5">
                      <Clapperboard size={11} /> Storyboard
                    </span>
                  }
                >
                  <div className="space-y-2">
                    {storyboardDuration(shots) > 0 && (
                      <div
                        className="flex h-6 w-full overflow-hidden rounded-md border border-[var(--line)]"
                        role="img"
                        aria-label={`Storyboard timeline, ${storyboardDuration(shots)} seconds total`}
                      >
                        {shots
                          .filter((s) => s.seconds > 0)
                          .map((s, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-center border-r border-[var(--line)] last:border-r-0"
                              style={{
                                flexGrow: s.seconds,
                                flexBasis: 0,
                                background: i % 2 ? "var(--panel-3)" : "var(--accent-soft)",
                              }}
                              title={`Shot ${i + 1}: ${s.seconds}s`}
                            >
                              <span className="mono px-1 text-[8.5px] text-[var(--muted)]">
                                {i + 1}·{s.seconds}s
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                    {shots.map((shot, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="mono mt-2 w-10 flex-none text-[9px] text-[var(--faint)]">S{i + 1}</span>
                        <input
                          className="field h-8 w-16 flex-none text-[11px]"
                          type="number"
                          min={1}
                          max={30}
                          value={shot.seconds}
                          aria-label={`Shot ${i + 1} seconds`}
                          onChange={(e) =>
                            setShots(shots.map((s, j) => (j === i ? { ...s, seconds: Number(e.target.value) } : s)))
                          }
                        />
                        <textarea
                          className="field min-h-[34px] resize-none text-[12px]"
                          value={shot.prompt}
                          placeholder={`Shot ${i + 1}: what happens on screen…`}
                          aria-label={`Shot ${i + 1} action`}
                          onChange={(e) =>
                            setShots(shots.map((s, j) => (j === i ? { ...s, prompt: e.target.value } : s)))
                          }
                        />
                        <button
                          className="icon-btn h-8 w-8 flex-none"
                          aria-label={`Remove shot ${i + 1}`}
                          onClick={() => setShots(shots.filter((_, j) => j !== i))}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShots([...shots, { title: "", prompt: "", seconds: 3 }])}
                      >
                        <Plus size={11} /> Shot
                      </Button>
                      <Button
                        size="sm"
                        disabled={!compileStoryboard(shots)}
                        onClick={() =>
                          app.patchSpec({
                            prompt: compileStoryboard(shots),
                            duration: Math.min(30, Math.max(2, storyboardDuration(shots))),
                            smartDuration: false,
                          })
                        }
                      >
                        Use as prompt ({storyboardDuration(shots)}s)
                      </Button>
                    </div>
                  </div>
                </Disclosure>
              </div>
            )}
            {mode === "video" && model.refs.audio > 0 && (
              <div className="mt-2">
                <Disclosure
                  title={
                    <span className="flex items-center gap-1.5">
                      <Sparkles size={11} /> Narration chain (TTS → audio reference)
                    </span>
                  }
                >
                  <div className="space-y-2">
                    <textarea
                      className="field min-h-[52px] resize-none text-[12.5px]"
                      placeholder="One narration line for this shot…"
                      value={narration}
                      onChange={(e) => setNarration(e.target.value)}
                      aria-label="Narration line"
                    />
                    <div className="flex items-center gap-2">
                      <Select
                        value={narrationVoice}
                        onChange={(e) => setNarrationVoice(e.target.value)}
                        aria-label="Narration voice"
                      >
                        {(MODELS.find((m) => m.mode === "audio")?.voices ?? []).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        disabled={!narration.trim() || !!app.pendingNarrationJobId}
                        onClick={() => void app.narrateForVideo(narration, narrationVoice)}
                      >
                        {app.pendingNarrationJobId ? "Synthesising…" : "Generate + attach"}
                      </Button>
                    </div>
                    <p className="text-[10px] leading-relaxed text-[var(--faint)]">
                      Queues a normal TTS job. When it lands, the audio attaches itself here as the
                      reference; press Generate when you are ready. Wan 3.0 sends it as
                      reference_audio.
                    </p>
                  </div>
                </Disclosure>
              </div>
            )}
            {mode === "image" && model.features.negativePrompt && (
              <div className="mt-2">
                <Disclosure title="Negative prompt">
                  <textarea
                    className="field min-h-[58px] resize-none text-[12.5px]"
                    value={draft.spec.negativePrompt ?? ""}
                    placeholder="Low quality, distorted limbs, warped text…"
                    onChange={(e) => app.patchSpec({ negativePrompt: e.target.value })}
                  />
                </Disclosure>
              </div>
            )}
            {mode === "video" && model.family === "wan-video" && (
              <div className="mt-2">
                <PromptHint text="Wan 3.0 reads Shot 1 [0-3s]: … in the prompt. Reference images are Image 1, Image 2 — videos and audio are counted separately." />
              </div>
            )}
          </div>

          {/* references */}
          {mode !== "audio" &&
            model.refs.reference + model.refs.first_frame + model.refs.last_frame + model.refs.audio + model.refs.video > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="mb-0">References</Label>
                <span className="mono text-[9.5px] text-[var(--faint)]">
                  {draft.refs.filter((r) => r.role === "reference").length}/{model.refs.reference} img
                  {model.refs.audio + model.refs.video > 0 ? " · av" : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {draft.refs.map((r, i) => (
                  <RefSlot
                    key={`${r.mediaId}-${r.role}`}
                    refItem={r}
                    imageIndex={
                      r.role === "reference"
                        ? draft.refs.filter((x) => x.role === "reference").findIndex((x) => x.mediaId === r.mediaId) + 1
                        : 0
                    }
                    model={model}
                    onChangeRole={(role) => app.setRefRole(i, role)}
                    onRemove={() => app.removeRef(i)}
                    onDragStart={() => setDragIndex(i)}
                    onDrop={() => {
                      if (dragIndex !== null) app.moveRef(dragIndex, i);
                      setDragIndex(null);
                    }}
                    dragging={dragIndex === i}
                  />
                ))}
                {uploading > 0 &&
                  Array.from({ length: uploading }).map((_, i) => (
                    <div key={i} className="shimmer h-[98px] w-[76px] flex-none rounded-lg border border-[var(--line)]" />
                  ))}
                <button
                  className="flex h-[98px] w-[76px] flex-none flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--line-2)] text-[var(--faint)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={15} />
                  <span className="mono text-[8.5px] uppercase tracking-wide">Add</span>
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button className="btn btn-sm" onClick={() => app.picker.openPicker("append")}>
                  <Images size={12} /> From gallery
                </button>
                {draft.refs.length > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => app.clearRefs()}>
                    Clear
                  </button>
                )}
                <span className="ml-auto text-[10px] leading-tight text-[var(--faint)]">
                  {model.refs.first_frame > 0
                    ? "Drop an image, then set its role"
                    : model.refs.reference > 0
                      ? "Optional — drop, paste, or pick"
                      : "This model is text-only"}
                </span>
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
          )}

          {/* canvas / parameters */}
          {mode === "image" && (
            <div className="space-y-3">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="mb-0">Canvas</Label>
                  <span className="mono text-[10px] text-[var(--faint)]">{draft.spec.size.replace("*", " × ")}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {ASPECT_LIST.map((a) => {
                    const on = draft.spec.aspect === a.id;
                    return (
                      <button
                        key={a.id}
                        onClick={() => regenerateSize(a.id, draft.spec.tier)}
                        className={cn(
                          "flex h-[46px] flex-col items-center justify-center gap-1 rounded-lg border transition-colors",
                          on
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--line)] hover:border-[var(--line-2)]"
                        )}
                      >
                        <AspectShape ratio={a.id} active={on} />
                        <span className={cn("mono text-[9px]", on ? "text-[var(--accent)]" : "text-[var(--faint)]")}>
                          {a.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-[var(--muted)]">Resolution</span>
                <Segmented
                  value={draft.spec.tier}
                  options={(model.sizes?.tiers ?? ["2K"]).map((t) => ({ id: t, label: t }))}
                  onChange={(tier) => regenerateSize(draft.spec.aspect, tier)}
                />
              </div>
              <Stepper
                label="Images"
                value={draft.spec.n}
                min={1}
                max={maxN}
                onChange={(n) => app.patchSpec({ n })}
              />
              {model.features.sequential && (
                <Switch
                  label="Image set"
                  hint="Keep character and style consistent across the batch."
                  checked={!!draft.spec.sequential}
                  onChange={(v) => app.patchSpec({ sequential: v, n: v ? Math.min(4, model.n.sequentialMax ?? 4) : Math.min(draft.spec.n, model.n.max) })}
                />
              )}
            </div>
          )}

          {mode === "video" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-[var(--muted)]">Resolution</span>
                <Segmented
                  value={draft.spec.resolution}
                  options={(model.resolutions ?? ["720P"]).map((r) => ({ id: r, label: r }))}
                  onChange={(resolution) => app.patchSpec({ resolution })}
                />
              </div>
              <div>
                <Label>Aspect</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(model.ratios ?? ["16:9"]).map((r) => {
                    const on = draft.spec.ratio === r;
                    return (
                      <button
                        key={r}
                        onClick={() => app.patchSpec({ ratio: r })}
                        className={cn(
                          "flex h-[42px] flex-col items-center justify-center gap-1 rounded-lg border transition-colors",
                          on
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                            : "border-[var(--line)] hover:border-[var(--line-2)]"
                        )}
                      >
                        {r === "adaptive" ? (
                          <span className="text-[9.5px] text-[var(--muted)]">auto</span>
                        ) : (
                          <AspectShape ratio={r} active={on} />
                        )}
                        <span className={cn("mono text-[8.5px]", on ? "text-[var(--accent)]" : "text-[var(--faint)]")}>
                          {r}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {model.duration && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[12px] text-[var(--muted)]">Duration</span>
                    <span className="mono text-[10.5px] text-[var(--faint)]">
                      {draft.spec.smartDuration ? "auto" : `${draft.spec.duration}s`}
                    </span>
                  </div>
                  <Slider
                    min={model.duration.min}
                    max={model.duration.max}
                    value={draft.spec.duration}
                    onChange={(duration) => app.patchSpec({ duration })}
                    format={(v) => `${v}s`}
                    ariaLabel="Clip duration"
                  />
                  {model.duration.smart && (
                    <div className="mt-1">
                      <Switch
                        label="Smart duration"
                        hint="Let Wan choose the length (duration = -1)."
                        checked={!!draft.spec.smartDuration}
                        onChange={(v) => app.patchSpec({ smartDuration: v })}
                      />
                    </div>
                  )}
                </div>
              )}
              {model.features.audioTrack && (
                <Switch
                  label="Generate audio"
                  hint="Native dialogue, ambience and music."
                  checked={draft.spec.audioTrack !== false}
                  onChange={(audioTrack) => app.patchSpec({ audioTrack })}
                />
              )}
            </div>
          )}

          {mode === "audio" && (
            <div className="space-y-3">
              <div>
                <Label>Voice</Label>
                <div className="flex gap-2">
                  <Select
                    aria-label="Voice"
                    value={draft.spec.voice}
                    onChange={(e) => app.patchSpec({ voice: e.target.value })}
                  >
                    {(model.voices ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                        {v.note ? ` — ${v.note}` : ""}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 flex-none"
                    title="Queues a one-line TTS job in this voice"
                    onClick={() => draft.spec.voice && void app.previewVoice(draft.spec.voice)}
                  >
                    Preview
                  </Button>
                </div>
                <p className="mt-1 text-[10px] text-[var(--faint)]">
                  Preview queues a real one-line TTS job; play it from the stage when it lands.
                </p>
              </div>
              <div>
                <Label>Emotion tags</Label>
                <div className="flex flex-wrap gap-1">
                  {TTS_EMOTION_TAGS.map((tag) => (
                    <button
                      key={tag}
                      className="chip"
                      onClick={() =>
                        app.patchSpec({
                          prompt: draft.spec.prompt ? `${draft.spec.prompt} ${tag} ` : `${tag} `,
                        })
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              {splitScript(draft.spec.prompt).length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={app.submitting}
                  onClick={() => void app.generateScriptLines()}
                >
                  Generate each line separately ({splitScript(draft.spec.prompt).length} jobs)
                </Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Format</Label>
                  <Segmented
                    className="w-full [&>button]:flex-1"
                    value={draft.spec.format ?? "mp3"}
                    options={[{ id: "mp3", label: "MP3" }, { id: "wav", label: "WAV" }]}
                    onChange={(format) => app.patchSpec({ format })}
                  />
                </div>
                <div>
                  <Label>Rate</Label>
                  <Select
                    aria-label="Sample rate"
                    value={String(draft.spec.sampleRate ?? 24000)}
                    onChange={(e) => app.patchSpec({ sampleRate: Number(e.target.value) })}
                  >
                    <option value="24000">24 kHz</option>
                    <option value="48000">48 kHz</option>
                    <option value="16000">16 kHz</option>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Delivery</Label>
                <textarea
                  className="field min-h-[64px] resize-none text-[12.5px]"
                  placeholder="Speak slowly, close to the mic, warm and reflective."
                  aria-label="Voice delivery instructions"
                  value={draft.spec.instruction ?? ""}
                  onChange={(e) => app.patchSpec({ instruction: e.target.value })}
                />
              </div>
              <Switch
                label="Script is SSML"
                hint="Converts a safe SSML subset (break, prosody, emphasis) to plain text plus delivery hints before sending. The Request panel shows exactly what was sent."
                checked={!!draft.spec.ssml}
                onChange={(ssml) => app.patchSpec({ ssml })}
              />
            </div>
          )}

          {/* advanced */}
          <Disclosure title="Advanced">
            <div className="space-y-2.5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3">
              {model.features.promptExtend && (
                <Switch
                  label="Prompt rewriting"
                  hint="Expands short prompts. Adds a few seconds."
                  checked={draft.spec.promptExtend}
                  onChange={(promptExtend) => app.patchSpec({ promptExtend })}
                />
              )}
              {model.features.promptExtendMode && draft.spec.promptExtend && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-[var(--muted)]">Rewrite mode</span>
                  <Segmented
                    value={draft.spec.promptExtendMode ?? "direct"}
                    options={[
                      { id: "direct", label: "Direct" },
                      { id: "agent", label: "Agent", disabled: draft.refs.length > 0, title: "Agent mode is text-to-image only" },
                    ]}
                    onChange={(v) => app.patchSpec({ promptExtendMode: v as "direct" | "agent" })}
                  />
                </div>
              )}
              {model.features.thinking && (
                <Switch
                  label="Thinking"
                  hint="Better reasoning about the prompt, slower."
                  checked={draft.spec.thinking !== false}
                  onChange={(thinking) => app.patchSpec({ thinking })}
                />
              )}
              {model.features.seed && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-[var(--muted)]">Seed</span>
                  <span className="flex items-center gap-1.5">
                    <button
                      className={app.seedLocked ? "chip chip-accent" : "chip"}
                      aria-pressed={app.seedLocked}
                      title="Locked: the first run stamps a seed and every later run reuses it"
                      onClick={() => app.setSeedLocked(!app.seedLocked)}
                    >
                      {app.seedLocked ? "Locked" : "Lock"}
                    </button>
                    <input
                      className="field field-mono h-8 w-28 py-0 text-right text-[11px]"
                      placeholder="random"
                      aria-label="Seed"
                      value={draft.spec.seed ?? ""}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        app.patchSpec({ seed: v === "" ? null : Number(v) });
                      }}
                    />
                  </span>
                </div>
              )}
              <Switch
                label="Watermark"
                hint="Off by default. Off is the documented API default."
                checked={draft.spec.watermark}
                onChange={(watermark) => app.patchSpec({ watermark })}
              />
              {model.features.colorPalette && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[12px] text-[var(--muted)]">Brand palette</span>
                    <span className="mono text-[9.5px] text-[var(--faint)]">
                      {(draft.spec.colorPalette ?? []).length}/10
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(draft.spec.colorPalette ?? []).map((c, i) => (
                      <span key={`${c}-${i}`} className="group relative">
                        <input
                          type="color"
                          value={c}
                          onChange={(e) => {
                            const next = [...(draft.spec.colorPalette ?? [])];
                            next[i] = e.target.value;
                            app.patchSpec({ colorPalette: next });
                          }}
                          className="h-7 w-7 cursor-pointer rounded border border-[var(--line-2)] bg-transparent p-0"
                        />
                        <button
                          className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--rose)] text-white group-hover:flex"
                          onClick={() =>
                            app.patchSpec({ colorPalette: (draft.spec.colorPalette ?? []).filter((_, j) => j !== i) })
                          }
                        >
                          <X size={8} />
                        </button>
                      </span>
                    ))}
                    {(draft.spec.colorPalette ?? []).length < 10 && (
                      <button
                        className="h-7 w-7 rounded border border-dashed border-[var(--line-2)] text-[var(--faint)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        onClick={() =>
                          app.patchSpec({
                            colorPalette: [...(draft.spec.colorPalette ?? []), "#888888"],
                          })
                        }
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Disclosure>
        </div>
      </div>

      {/* footer */}
      <div className="border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_88%,transparent)] p-3 backdrop-blur">
        <div className="mb-2 flex items-center gap-2 overflow-hidden">
          <span className="mono truncate text-[9.5px] uppercase tracking-wider text-[var(--faint)]">
            {model.label}
            {mode === "image" ? ` · ${draft.spec.size.replace("*", "×")} · ${draft.spec.n}` : ""}
            {mode === "video" ? ` · ${draft.spec.resolution} · ${draft.spec.smartDuration ? "auto" : `${draft.spec.duration}s`}` : ""}
            {mode === "audio" ? ` · ${draft.spec.format?.toUpperCase()} · ${(draft.spec.voice ?? "").split("_")[0]}` : ""}
          </span>
          {mode !== "audio" && (
            <button
              className="chip ml-auto"
              disabled={app.submitting}
              title="Run this prompt once on each model in this mode"
              onClick={() => void app.generateAB()}
            >
              Compare models
            </button>
          )}
          <span className={mode === "audio" ? "chip ml-auto" : "chip"} title={app.usage.label}>
            ~{estimateUnits(draft.spec, model)} units
          </span>
          {app.settings.demoMode && <span className="chip chip-accent">Demo</span>}
        </div>
        <Button
          variant="primary"
          className="h-10 w-full text-[13px]"
          disabled={app.submitting || app.engine === "asleep"}
          onClick={() => void app.generate()}
        >
          <Play size={13} />
          {app.submitting ? "Queuing…" : app.engine === "asleep" ? "Engine asleep" : "Generate"}
          <span className="mono ml-1 rounded border border-white/25 px-1 text-[9px] opacity-80">⌘↵</span>
        </Button>
      </div>

      <ModelPicker
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        mode={mode}
        current={model.id}
        onPick={(id) => app.switchModel(id)}
      />
    </div>
  );
}
