import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Sparkles, X } from "lucide-react";
import { parseTokens, referencedIndexes, TTS_EMOTION_TAGS } from "@core";
import type { RefItem } from "../store";
import { cn } from "../lib";
import { Img } from "./Media";

function Highlighted({ value }: { value: string }) {
  const tokens = parseTokens(value);
  if (!tokens.length) return <>{value}</>;
  const out: React.ReactNode[] = [];
  let last = 0;
  tokens.forEach((t, i) => {
    if (t.start > last) out.push(value.slice(last, t.start));
    out.push(
      <span className="token" key={`${t.raw}-${i}`}>
        {t.raw}
      </span>
    );
    last = t.end;
  });
  out.push(value.slice(last));
  return <>{out}</>;
}

const PLACEHOLDERS: Record<string, string> = {
  image:
    "Describe the frame. Press @ to place a reference, e.g. “The jacket from @Image 1 on the model in @Image 2, same lighting.”",
  video:
    "Describe the shot. Use Shot 1 [0-3s]: … for multi-shot. Press @ to reference an image.",
  audio: "Write the line to speak. Use [excited] or [whispers] to direct the delivery.",
};

export function PromptEditor({
  value,
  onChange,
  refs,
  mode,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  refs: RefItem[];
  mode: string;
  disabled?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [focus, setFocus] = useState(false);

  const imageRefs = refs.filter((r) => r.role === "reference");
  const referenced = referencedIndexes(value, "image");
  const missing = referenced.filter((n) => n > imageRefs.length);
  const unused = imageRefs.map((r, i) => i + 1).filter((n) => !referenced.includes(n));

  const autoGrow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(132, el.scrollHeight)}px`;
  };

  useEffect(autoGrow, [value]);

  const filtered = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return imageRefs
      .map((r, i) => ({ ref: r, n: i + 1 }))
      .filter(({ ref }) => !q || ref.name.toLowerCase().includes(q));
  }, [mention, refs]);

  function handleChange(next: string, caret: number) {
    onChange(next);
    const before = next.slice(0, caret);
    const m = /(?:^|\s)@([\w .-]{0,28})$/.exec(before);
    if (m && imageRefs.length) {
      setMention({ start: before.lastIndexOf("@"), query: m[1] });
    } else {
      setMention(null);
    }
  }

  function insert(text: string, opts?: { replaceAt?: number }) {
    const el = taRef.current;
    const caret = el?.selectionStart ?? value.length;
    const start = opts?.replaceAt ?? caret;
    const next = value.slice(0, start) + text + value.slice(caret);
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + text.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function insertTag(tag: string) {
    insert(`${tag} `);
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "relative rounded-xl border bg-[var(--bg-elev)] transition-colors",
          focus ? "border-[var(--line-2)]" : "border-[var(--line)]"
        )}
        style={focus ? { boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent)" } : undefined}
      >
        <div ref={mirrorRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden px-3.5 py-3">
          <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-[var(--paper)]">
            <Highlighted value={value} />
            {value.endsWith("\n") ? <br /> : null}
          </div>
        </div>
        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          placeholder={PLACEHOLDERS[mode] ?? PLACEHOLDERS.image}
          aria-label="Prompt"
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? 0)}
          onKeyUp={(e) => {
            const el = e.currentTarget;
            const before = el.value.slice(0, el.selectionStart ?? 0);
            const m = /(?:^|\s)@([\w .-]{0,28})$/.exec(before);
            if (m && imageRefs.length) setMention({ start: before.lastIndexOf("@"), query: m[1] });
            else if (mention) setMention(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMention(null);
            if (mention && (e.key === "ArrowDown" || e.key === "Enter")) {
              e.preventDefault();
              if (filtered[0]) {
                insert(`[Image ${filtered[0].n}]`, { replaceAt: mention.start });
              }
            }
          }}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 120)}
          spellCheck
          className="prompt-input relative block min-h-[132px] w-full resize-none overflow-hidden bg-transparent px-3.5 py-3 text-[14px] leading-[1.7] outline-none"
          style={{ fontFamily: "var(--sans)" }}
        />

        {mention && filtered.length > 0 && (
          <div className="absolute left-3 right-3 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-[var(--line-2)] bg-[var(--panel-2)] p-1 shadow-2xl">
            <div className="label px-2 py-1.5">Insert reference</div>
            {filtered.map(({ ref, n }) => (
              <button
                key={ref.mediaId}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--panel-3)]"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (mention) insert(`[Image ${n}]`, { replaceAt: mention.start });
                }}
              >
                <span className="thumb-frame h-8 w-8 flex-none">
                  <Img src={ref.thumb} alt={ref.name} className="h-full w-full object-cover" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">{ref.name}</span>
                  <span className="mono block text-[9.5px] text-[var(--faint)]">[Image {n}]</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {imageRefs.length > 0 && unused.length > 0 && (
          <button
            className="chip transition-colors hover:border-[var(--line-2)] hover:text-[var(--paper)]"
            onClick={() => insert(`[Image ${unused[0]}] `)}
            title="Insert the next unreferenced image token"
          >
            <AtSign size={10} />
            Insert Image {unused[0]}
          </button>
        )}
        {referenced.map((n) => {
          const ref = imageRefs[n - 1];
          return (
            <span key={n} className={cn("chip", ref ? "chip-accent" : "text-[var(--rose)]")} title={ref?.name}>
              {ref ? (
                <>
                  <span className="h-3.5 w-3.5 overflow-hidden rounded-[2px]">
                    <Img src={ref.thumb} alt="" className="h-full w-full object-cover" />
                  </span>
                  Image {n}
                </>
              ) : (
                  <>Image {n} missing</>
              )}
            </span>
          );
        })}
        {missing.length > 0 && (
          <span className="text-[10.5px] text-[var(--rose)]">Attach {missing.length} more reference(s)</span>
        )}
        {mode === "audio" && (
          <div className="mt-1 flex w-full flex-wrap items-center gap-1">
            <span className="label mr-1">Tags</span>
            {TTS_EMOTION_TAGS.slice(0, 7).map((tag) => (
              <button key={tag} className="chip hover:border-[var(--line-2)] hover:text-[var(--paper)]" onClick={() => insertTag(tag)}>
                {tag.replace(/[[\]]/g, "")}
              </button>
            ))}
          </div>
        )}
        <span className="mono ml-auto text-[10px] text-[var(--faint)]">{value.length}</span>
        {value && (
          <button
            className="icon-btn h-6 w-6"
            aria-label="Clear prompt"
            onClick={() => onChange("")}
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

export function PromptHint({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted)]">
      <Sparkles size={12} className="mt-0.5 flex-none text-[var(--accent)]" />
      {text}
    </div>
  );
}
