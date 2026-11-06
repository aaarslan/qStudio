import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  Clapperboard,
  FolderOpen,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  Moon,
  Search,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Wand2,
} from "lucide-react";
import { useApp } from "../store";
import { api } from "../api";
import { cn } from "../lib";
import { KindGlyph } from "./Media";

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const app = useApp();
  const open = app.paletteOpen;
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const keepFocusInDialog = (event: FocusEvent) => {
        if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) inputRef.current?.focus();
      };
      document.addEventListener("focusin", keepFocusInDialog);
      setQ("");
      setActive(0);
      inputRef.current?.focus();
      return () => {
        document.removeEventListener("focusin", keepFocusInDialog);
        previousFocusRef.current?.focus();
      };
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const items: Item[] = useMemo(() => {
    const close = () => app.setPalette(false);
    const nav: Item[] = [
      { id: "v-studio", label: "Go to Studio", group: "Navigate", icon: <Sparkles size={13} />, run: () => { app.setView("studio"); close(); } },
      { id: "v-film", label: "Go to Film", group: "Navigate", icon: <Clapperboard size={13} />, run: () => { app.setView("film"); close(); } },
      { id: "v-prompts", label: "Go to Prompts", group: "Navigate", icon: <BookMarked size={13} />, run: () => { app.setView("prompts"); close(); } },
      { id: "v-refs", label: "Go to References", group: "Navigate", icon: <Images size={13} />, run: () => { app.setView("references"); close(); } },
      { id: "v-lib", label: "Go to Library", group: "Navigate", icon: <LayoutGrid size={13} />, run: () => { app.setView("library"); close(); } },
      { id: "v-set", label: "Go to Settings", group: "Navigate", icon: <Settings2 size={13} />, run: () => { app.setView("settings"); close(); } },
    ];
    const create: Item[] = [
      { id: "m-image", label: "New image", hint: "⌘1", group: "Create", icon: <ImageIcon size={13} />, run: () => { app.setMode("image"); app.setView("studio"); close(); } },
      { id: "m-video", label: "New video", hint: "⌘2", group: "Create", icon: <Square size={13} />, run: () => { app.setMode("video"); app.setView("studio"); close(); } },
      { id: "m-audio", label: "New audio", hint: "⌘3", group: "Create", icon: <Wand2 size={13} />, run: () => { app.setMode("audio"); app.setView("studio"); close(); } },
      { id: "save", label: "Save current prompt", hint: "⌘S", group: "Create", icon: <Sparkles size={13} />, run: () => { app.setSavePrompt(true); close(); } },
    ];
    const sys: Item[] = [
      {
        id: "theme",
        label: app.settings.theme === "dark" ? "Switch to Daylight theme" : "Switch to Darkroom theme",
        group: "System",
        icon: app.settings.theme === "dark" ? <Sun size={13} /> : <Moon size={13} />,
        run: () => { app.setTheme(app.settings.theme === "dark" ? "light" : "dark"); close(); },
      },
      {
        id: "demo",
        label: app.settings.demoMode ? "Turn off demo mode" : "Turn on demo mode",
        group: "System",
        icon: <Sparkles size={13} />,
        run: () => { void app.saveSettings({ demoMode: !app.settings.demoMode }); close(); },
      },
      { id: "out", label: "Open output folder", group: "System", icon: <FolderOpen size={13} />, run: () => { void api.openOutput(); close(); } },
    ];

    const needle = q.trim().toLowerCase();
    const all = [...nav, ...create, ...sys];

    const promptItems: Item[] = app.prompts
      .filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.text.toLowerCase().includes(needle) || p.tags.some((t) => t.toLowerCase().includes(needle)))
      .slice(0, 8)
      .map((p) => ({
        id: `p-${p.id}`,
        label: p.title,
        hint: p.modelId,
        group: "Prompts",
        icon: <BookMarked size={13} />,
        run: () => { app.applyPrompt(p); close(); },
      }));

    const refItems: Item[] = app.media
      .filter((m) => needle && (m.name.toLowerCase().includes(needle) || (m.prompt ?? "").toLowerCase().includes(needle)))
      .slice(0, 6)
      .map((m) => ({
        id: `r-${m.id}`,
        label: m.name,
        hint: m.kind,
        group: "References",
        icon: <span className="text-[var(--faint)]"><KindGlyph kind={m.kind} size={12} /></span>,
        run: () => { app.useAsReference(m); close(); },
      }));

    const filmItems: Item[] = app.shots
      .filter(
        (s) =>
          needle &&
          (s.title.toLowerCase().includes(needle) ||
            s.action.toLowerCase().includes(needle) ||
            s.dialogue.toLowerCase().includes(needle))
      )
      .slice(0, 6)
      .map((s) => ({
        id: `f-${s.id}`,
        label: s.title,
        hint: app.worlds.find((w) => w.id === s.worldId)?.title ?? "Film",
        group: "Film shots",
        icon: <Clapperboard size={13} />,
        run: () => { app.openFilmShot(s.worldId, s.id); close(); },
      }));

    return [
      ...all.filter((i) => !needle || i.label.toLowerCase().includes(needle)),
      ...promptItems,
      ...refItems,
      ...filmItems,
    ];
  }, [q, app.prompts, app.media, app.shots, app.worlds, app.settings.theme, app.settings.demoMode]);

  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[85] flex items-start justify-center bg-[rgba(4,4,5,0.62)] px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && app.setPalette(false)}
    >
      <div
        ref={dialogRef}
        className="dialog command-palette w-full max-w-[640px] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            app.setPalette(false);
            return;
          }
          if (e.key !== "Tab") return;
          const tabbable = dialogRef.current?.querySelectorAll<HTMLElement>("input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])");
          if (!tabbable?.length) {
            e.preventDefault();
            dialogRef.current?.focus();
            return;
          }
          const first = tabbable[0];
          const last = tabbable[tabbable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-[var(--line)] px-4">
          <Search size={14} className="text-[var(--faint)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-palette-options"
            aria-activedescendant={activeIndex >= 0 ? `command-palette-option-${activeIndex}` : undefined}
            aria-label="Search commands"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => items.length ? Math.min(items.length - 1, a + 1) : 0);
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => items.length ? Math.max(0, Math.min(items.length - 1, a) - 1) : 0);
              }
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                items[activeIndex]?.run();
              }
            }}
            placeholder="Search actions, prompts, references and shots…"
            className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--faint)]"
          />
          <span className="kbd">esc</span>
        </div>
        <div id="command-palette-options" role="listbox" aria-label="Command results" className="scroll max-h-[54vh] overflow-auto p-1.5">
          {items.length === 0 && (
            <div className="px-4 py-8 text-center text-[12px] text-[var(--muted)]">Nothing matches that.</div>
          )}
          {items.map((item, i) => {
            const showGroup = i === 0 || items[i - 1].group !== item.group;
            return (
              <div key={item.id}>
                {showGroup && <div className="label px-2.5 pb-1 pt-2.5">{item.group}</div>}
                <button
                  id={`command-palette-option-${i}`}
                  ref={activeIndex === i ? activeOptionRef : undefined}
                  role="option"
                  tabIndex={-1}
                  aria-selected={activeIndex === i}
                  onMouseEnter={() => setActive(i)}
                  onClick={item.run}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    activeIndex === i ? "bg-[var(--panel-3)]" : "hover:bg-[var(--panel-2)]"
                  )}
                >
                  <span className="text-[var(--muted)]">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.label}</span>
                  {item.hint && <span className="mono truncate text-[9.5px] text-[var(--faint)]">{item.hint}</span>}
                  {activeIndex === i && <span className="kbd">↵</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
