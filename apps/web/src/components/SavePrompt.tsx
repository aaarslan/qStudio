import { useEffect, useState } from "react";
import { titleFromPrompt } from "@core";
import { useApp } from "../store";
import { Button, Input, Label, Modal, Switch } from "../ui";

export function SavePromptModal() {
  const app = useApp();
  const open = app.savePromptOpen;
  const mode = app.activeMode;
  const draft = app.drafts[mode];
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [favorite, setFavorite] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(titleFromPrompt(draft.spec.prompt));
      setTags("");
      setNotes("");
      setFavorite(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => app.setSavePrompt(false)}
      width={560}
      title="Save this prompt"
      sub="Parameters are stored with it. Any [Image N] tokens stay as placeholders you can remap later."
      footer={
        <>
          <Button variant="ghost" onClick={() => app.setSavePrompt(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              void app.savePrompt({
                title: title.trim(),
                tags: tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
                favorite,
                notes: notes.trim() || undefined,
              })
            }
          >
            Save prompt
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="save-prompt-title">Title</Label>
          <Input
            id="save-prompt-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Editorial portrait, late light"
          />
        </div>
        <div>
          <Label htmlFor="save-prompt-tags">Tags</Label>
          <Input
            id="save-prompt-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="portrait, editorial, film"
          />
          <div className="mt-1 text-[10px] text-[var(--faint)]">Comma separated.</div>
        </div>
        <div>
          <Label htmlFor="save-prompt-notes">Notes</Label>
          <textarea
            id="save-prompt-notes"
            className="field min-h-[64px] resize-none text-[12.5px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What to change next time, which references pair well…"
          />
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-3">
          <div className="label mb-1.5">
            {mode} · {draft.spec.modelId}
          </div>
          <div className="max-h-[110px] overflow-auto text-[12px] leading-relaxed text-[var(--muted)]">
            {draft.spec.prompt || "—"}
          </div>
        </div>
        <Switch checked={favorite} onChange={setFavorite} label="Favourite" hint="Pin it at the top of your prompt gallery." />
      </div>
    </Modal>
  );
}
