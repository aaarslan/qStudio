import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Upload } from "lucide-react";
import { referencedIndexes } from "@core";
import type { MediaAsset } from "@core";
import { useApp } from "../store";
import { api } from "../api";
import { Button, Modal, Segmented } from "../ui";
import { MediaTile } from "./MediaCard";

export function ReferencePicker() {
  const app = useApp();
  const picker = app.picker;
  const [kind, setKind] = useState<"all" | "image" | "video" | "audio">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picker.open) return;
    setSelected([]);
    setQ("");
    setKind(picker.pendingPrompt ? "image" : "all");
  }, [picker.open, picker.pendingPrompt]);

  const list = useMemo(() => {
    let out = app.media;
    if (kind !== "all") out = out.filter((m) => m.kind === kind);
    if (q.trim()) {
      const n = q.toLowerCase();
      out = out.filter((m) => m.name.toLowerCase().includes(n) || (m.prompt ?? "").toLowerCase().includes(n));
    }
    return out;
  }, [app.media, kind, q]);

  const needed = picker.pendingPrompt ? referencedIndexes(picker.pendingPrompt.text, "image") : [];

  const close = () => {
    picker.closePicker();
  };

  const confirm = () => {
    const assets = selected
      .map((id) => app.media.find((m) => m.id === id))
      .filter(Boolean) as MediaAsset[];
    if (picker.pendingPrompt) {
      app.applyPrompt(picker.pendingPrompt, { refAssets: assets });
    } else if (assets.length) {
      app.addRefs(assets, picker.role);
    }
    close();
  };

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading((n) => n + arr.length);
    const added: string[] = [];
    for (const file of arr) {
      try {
        const { media } = await api.upload(file);
        added.push(media.id);
      } catch (err) {
        app.toast((err as Error).message, "err");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    await app.refresh();
    if (added.length) setSelected((cur) => [...cur, ...added]);
  };

  return (
    <Modal
      open={picker.open}
      onClose={close}
      width={1000}
      title={picker.pendingPrompt ? "Map references to this prompt" : "Choose references"}
      sub={
        picker.pendingPrompt
          ? needed.length
            ? `This prompt refers to ${needed.map((n) => `[Image ${n}]`).join(", ")}. Select them in that order.`
            : "This prompt has no image tokens yet — pick a set and it will be attached in order."
          : "Selected files become Image 1, Image 2 … in the order you tap them."
      }
      footer={
        <>
          <span className="mono mr-auto text-[10px] text-[var(--faint)]">{selected.length} selected</span>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={selected.length === 0} onClick={confirm}>
            {picker.pendingPrompt ? "Load prompt + references" : "Add to composer"}
          </Button>
        </>
      }
    >
      {picker.pendingPrompt && (
        <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3 text-[12px] leading-[1.65] text-[var(--muted)]">
          {picker.pendingPrompt.text}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <div className="relative min-w-[160px] flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input
            className="field h-8 pl-7 text-[12px]"
            placeholder="Search references"
            aria-label="Search references"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Upload size={12} /> Upload
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="scroll grid max-h-[48vh] grid-cols-3 gap-2 overflow-auto pr-1 sm:grid-cols-4 md:grid-cols-6">
        {uploading > 0 &&
          Array.from({ length: uploading }).map((_, i) => (
            <div key={i} className="shimmer aspect-square rounded-lg border border-[var(--line)]" />
          ))}
        {list.map((m) => (
          <MediaTile
            key={m.id}
            media={m}
            selected={selected.includes(m.id)}
            order={selected.indexOf(m.id) + 1}
            onClick={() =>
              setSelected((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]))
            }
          />
        ))}
        {!list.length && uploading === 0 && (
          <div className="col-span-full py-10 text-center text-[12px] text-[var(--muted)]">
            No references yet. Upload something to get started.
          </div>
        )}
      </div>
    </Modal>
  );
}
