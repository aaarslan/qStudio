import type { PromptRecipe as PromptRecipeValue } from "@core";

import { compilePromptRecipe } from "@core";
export { compilePromptRecipe, initialPromptRecipe } from "@core";

const fields: { key: keyof Pick<PromptRecipeValue, "identity" | "wardrobe" | "pose" | "expression" | "lighting" | "background" | "camera">; label: string; hint: string; rows: number }[] = [
  { key: "identity", label: "Identity and subject", hint: "Describe the subject, identity, and details that should remain recognizable.", rows: 4 },
  { key: "wardrobe", label: "Wardrobe", hint: "Clothing, materials, colors, and styling.", rows: 2 },
  { key: "pose", label: "Pose", hint: "Body position, gesture, and movement.", rows: 2 },
  { key: "expression", label: "Expression", hint: "Mood, gaze, and facial expression.", rows: 2 },
  { key: "lighting", label: "Lighting", hint: "Light source, direction, softness, and color.", rows: 2 },
  { key: "background", label: "Background", hint: "Setting and environmental detail.", rows: 2 },
  { key: "camera", label: "Camera and framing", hint: "Lens, angle, distance, and composition.", rows: 2 },
];

export function PromptRecipe({
  value,
  onChange,
  referenceCount,
  isVisual,
}: {
  value: PromptRecipeValue;
  onChange: (recipe: PromptRecipeValue) => void;
  referenceCount: number;
  isVisual: boolean;
}) {
  const finalText = compilePromptRecipe(value, referenceCount, isVisual);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className={field.key === "identity" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
            <span className="label">{field.label}</span>
            <textarea
              className="field min-h-0 text-[12px] leading-[1.55] [@media(pointer:coarse)]:text-base"
              rows={field.rows}
              value={value[field.key]}
              placeholder={field.hint}
              aria-label={field.label}
              onChange={(event) => onChange({ ...value, [field.key]: event.currentTarget.value })}
            />
          </label>
        ))}
      </div>
      <fieldset className="rounded-xl border border-[var(--line)] p-3">
        <legend className="label px-1">Keep consistent across variations</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {([
            ["preserveFace", "Face"],
            ["preserveProportions", "Proportions"],
            ["preserveOutfit", "Outfit"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
              <input
                type="checkbox"
                className="min-h-5 min-w-5"
                checked={value[key]}
                onChange={(event) => onChange({ ...value, [key]: event.currentTarget.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <section className="space-y-1.5" aria-labelledby="compiled-prompt-label">
        <div id="compiled-prompt-label" className="label">Final prompt</div>
        <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-3 text-[11px] leading-[1.6] text-[var(--muted)]">{finalText}</pre>
      </section>
    </div>
  );
}
