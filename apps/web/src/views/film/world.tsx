import { useState } from "react";
import { Clapperboard, Plus, Trash2, X } from "lucide-react";
import { getModel } from "@core";
import type { Entity, World } from "@core";
import { useApp } from "../../store";
import { Button, IconButton, Input, Label, Segmented, Select, Spinner, Textarea } from "../../ui";
import { Img, KindGlyph } from "../../components/Media";
import { truncate } from "../../lib";
import { BlurArea, BlurInput, PaletteField } from "./shared";

export function WorldColumn({
  world,
  entities,
  onClose,
}: {
  world: World;
  entities: Entity[];
  onClose?: () => void;
}) {
  const app = useApp();
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [breaking, setBreaking] = useState(false);
  const scriptValue = scriptDraft ?? world.scriptText;
  return (
    <aside className="scroll flex w-[318px] max-w-full flex-none flex-col gap-5 border-r border-[var(--line)] px-4 py-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label className="mb-0">World</Label>
          {onClose && (
            <IconButton label="Close World Bible" className="ml-auto" onClick={onClose}>
              <X size={14} />
            </IconButton>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Select
            value={world.id}
            aria-label="Active world"
            onChange={(e) => app.setActiveWorld(e.target.value)}
          >
            {app.worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </Select>
          <IconButton label="New world" onClick={() => void app.createWorld("Untitled film")}>
            <Plus size={14} />
          </IconButton>
          <IconButton label="Delete world" onClick={() => void app.deleteWorld(world.id)}>
            <Trash2 size={14} />
          </IconButton>
        </div>
        <BlurInput value={world.title} placeholder="Title" onCommit={(v) => void app.patchWorld(world.id, { title: v })} />
        <BlurArea
          value={world.logline}
          placeholder="Logline. One sentence the whole film answers to."
          rows={2}
          onCommit={(v) => void app.patchWorld(world.id, { logline: v })}
        />
        <div className="flex flex-col gap-2">
          <div>
            <Label>Frame</Label>
            <Select
              value={world.aspect}
              aria-label="Film aspect ratio"
              onChange={(e) => void app.patchWorld(world.id, { aspect: e.target.value })}
            >
              {["16:9", "21:9", "4:3", "1:1", "9:16", "3:4"].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
          <PaletteField
            label="Film palette"
            value={world.palette}
            onCommit={(next) => void app.patchWorld(world.id, { palette: next })}
          />
        </div>
        <BlurArea
          label="Look"
          value={world.look}
          placeholder="Grain, lenses, contrast. Compiled into every shot."
          rows={2}
          onCommit={(v) => void app.patchWorld(world.id, { look: v })}
        />
        <BlurArea
          label="Rules"
          value={world.rules}
          placeholder="Hard rules, for example: practicals only after dark."
          rows={2}
          onCommit={(v) => void app.patchWorld(world.id, { rules: v })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Script</Label>
        <Textarea
          value={scriptValue}
          rows={7}
          aria-label="Script text"
          placeholder={"EXT. QUIET DOCK - NIGHT\n\nRain on empty benches. A figure boards.\n\nFIGURE\nLast crossing tonight."}
          onChange={(e) => setScriptDraft(e.target.value)}
          onBlur={() => {
            if (scriptDraft !== null && scriptDraft !== world.scriptText) {
              void app.patchWorld(world.id, { scriptText: scriptDraft });
            }
            setScriptDraft(null);
          }}
        />
        <Button
          size="sm"
          disabled={breaking || !scriptValue.trim()}
          onClick={async () => {
            setBreaking(true);
            await app.breakdownWorld(world.id, scriptValue);
            setBreaking(false);
          }}
        >
          {breaking ? <Spinner size={11} /> : <Clapperboard size={12} />} Break into scenes and shots
        </Button>
        <p className="text-[11px] leading-snug text-[var(--faint)]">
          Breakdown is a local parse. It spends no credits and renders nothing.
        </p>
      </div>

      <WorldBible world={world} entities={entities} />
    </aside>
  );
}

function WorldBible({ world, entities }: { world: World; entities: Entity[] }) {
  const app = useApp();
  const [kind, setKind] = useState<"character" | "location" | "prop">("character");
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const groups: { kind: Entity["kind"]; label: string }[] = [
    { kind: "character", label: "Characters" },
    { kind: "location", label: "Locations" },
    { kind: "prop", label: "Hero props" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>World Bible</Label>
        <span className="mono text-[9.5px] text-[var(--faint)]">{entities.length} entries</span>
      </div>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void app.createEntity(world.id, { kind, name: name.trim() });
          setName("");
        }}
      >
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { id: "character", label: "Character" },
            { id: "location", label: "Location" },
            { id: "prop", label: "Prop" },
          ]}
        />
        <div className="flex gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="New bible entry name" />
          <Button size="sm" type="submit" disabled={!name.trim()} className="flex-none">
            <Plus size={12} /> Add
          </Button>
        </div>
      </form>
      {groups.map((group) => {
        const items = entities.filter((e) => e.kind === group.kind);
        if (!items.length) return null;
        return (
          <div key={group.kind} className="flex flex-col gap-1.5">
            <div className="mono mt-1 text-[9.5px] uppercase tracking-[0.12em] text-[var(--faint)]">{group.label}</div>
            {items.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                open={openId === entity.id}
                onToggle={() => setOpenId(openId === entity.id ? null : entity.id)}
              />
            ))}
          </div>
        );
      })}
      {!entities.length && (
        <p className="text-[11.5px] leading-snug text-[var(--muted)]">
          Create each character once. Attach canonical views from your library. Every shot that casts them inherits
          those views automatically.
        </p>
      )}
    </div>
  );
}

function EntityCard({ entity, open, onToggle }: { entity: Entity; open: boolean; onToggle: () => void }) {
  const app = useApp();
  const voices = getModel("qwen-audio-3.0-tts-plus").voices ?? [];
  const firstMedia = entity.canonicalMediaIds
    .map((id) => app.media.find((m) => m.id === id))
    .find(Boolean);
  return (
    <div className="card px-3 py-2.5">
      <button className="flex w-full items-center gap-2.5 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="thumb-frame block h-9 w-9 flex-none">
          {firstMedia ? (
            <Img src={firstMedia.thumb ?? firstMedia.url} alt={entity.name} />
          ) : (
            <KindGlyph kind="image" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{entity.name}</span>
          <span className="mono block text-[9px] text-[var(--faint)]">
            {entity.canonicalMediaIds.length} canonical · v{entity.version}
          </span>
        </span>
        {!entity.canonicalMediaIds.length && <span className="chip chip-accent flex-none">No refs</span>}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[var(--line)] pt-3">
          <BlurInput value={entity.name} placeholder="Name" onCommit={(v) => void app.patchEntity(entity.id, { name: v })} />
          <BlurArea
            label="Description"
            value={entity.description}
            rows={2}
            placeholder="Face, build, distinguishing details."
            onCommit={(v) => void app.patchEntity(entity.id, { description: v })}
          />
          {entity.kind === "character" && (
            <>
              <BlurArea
                label="Wardrobe"
                value={entity.wardrobe}
                rows={2}
                placeholder="What they wear unless a shot says otherwise."
                onCommit={(v) => void app.patchEntity(entity.id, { wardrobe: v })}
              />
              <div>
                <Label>Voice</Label>
                <Select
                  value={entity.voiceId ?? ""}
                  aria-label="Character voice"
                  onChange={(e) => void app.patchEntity(entity.id, { voiceId: e.target.value || undefined })}
                >
                  <option value="">Not cast</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}{v.note ? ` · ${v.note}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}
          <BlurInput
            label="Avoid"
            value={entity.negative}
            placeholder="different face, changed hair"
            onCommit={(v) => void app.patchEntity(entity.id, { negative: v })}
          />
          <CanonicalRefs entity={entity} />
          <Button size="sm" variant="danger" onClick={() => void app.deleteEntity(entity.id)}>
            <Trash2 size={12} /> Remove from bible
          </Button>
        </div>
      )}
    </div>
  );
}

function CanonicalRefs({ entity }: { entity: Entity }) {
  const app = useApp();
  const [pick, setPick] = useState("");
  const images = app.media.filter((m) => m.kind === "image" && !entity.canonicalMediaIds.includes(m.id));
  const move = (index: number, delta: number) => {
    const next = entity.canonicalMediaIds.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    void app.patchEntity(entity.id, { canonicalMediaIds: next });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Canonical views, in order</Label>
      <div className="flex flex-wrap gap-1.5">
        {entity.canonicalMediaIds.map((id, i) => {
          const media = app.media.find((m) => m.id === id);
          return (
            <span key={id} className="group relative block h-12 w-12">
              <span className="thumb-frame block h-12 w-12">
                <Img src={media?.thumb ?? media?.url} alt={media?.name ?? id} />
              </span>
              <span className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 px-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <button aria-label="Move earlier" onClick={() => move(i, -1)}>‹</button>
                <button
                  aria-label="Remove view"
                  onClick={() =>
                    void app.patchEntity(entity.id, {
                      canonicalMediaIds: entity.canonicalMediaIds.filter((x) => x !== id),
                    })
                  }
                >
                  ×
                </button>
                <button aria-label="Move later" onClick={() => move(i, 1)}>›</button>
              </span>
            </span>
          );
        })}
        {!entity.canonicalMediaIds.length && (
          <span className="text-[11px] text-[var(--faint)]">None yet. Renders will invent this subject from text.</span>
        )}
      </div>
      <div className="flex gap-1.5">
        <Select value={pick} aria-label="Library image" onChange={(e) => setPick(e.target.value)}>
          <option value="">Library image…</option>
          {images.map((m) => (
            <option key={m.id} value={m.id}>
              {truncate(m.name, 34)}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          className="flex-none"
          disabled={!pick}
          onClick={() => {
            void app.patchEntity(entity.id, { canonicalMediaIds: [...entity.canonicalMediaIds, pick] });
            setPick("");
          }}
        >
          <Plus size={12} /> View
        </Button>
      </div>
    </div>
  );
}
