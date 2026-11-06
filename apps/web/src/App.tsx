import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useApp } from "./store";
import { Shell } from "./components/Shell";
import { StudioView } from "./views/Studio";

const FilmView = lazy(() => import("./views/Film").then((m) => ({ default: m.FilmView })));
const PromptsView = lazy(() => import("./views/Prompts").then((m) => ({ default: m.PromptsView })));
const ReferencesView = lazy(() =>
  import("./views/References").then((m) => ({ default: m.ReferencesView }))
);
const LibraryView = lazy(() => import("./views/Library").then((m) => ({ default: m.LibraryView })));
const SettingsView = lazy(() => import("./views/Settings").then((m) => ({ default: m.SettingsView })));
import { CommandPalette } from "./components/Palette";
import { SavePromptModal } from "./components/SavePrompt";
import { ReferencePicker } from "./components/ReferencePicker";
import { Onboarding } from "./components/Onboarding";
import { Aperture, Button, Modal, Spinner, Toasts } from "./ui";
import { isTauri, onNativeDrop } from "./tauri";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center" style={{ background: "var(--bg)" }}>
        <Aperture size={44} />
        <div className="serif serif-display text-[20px]">Something in the darkroom slipped</div>
        <p className="max-w-[480px] text-[12.5px] leading-relaxed text-[var(--muted)]">
          {this.state.error.message}. Your jobs keep running in the engine. Reload the window to keep going.
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

function EngineBanner() {
  const app = useApp();
  if (app.engine === "online") return null;
  return (
    <div
      className="flex flex-none items-center gap-3 border-b border-[var(--line)] px-5 py-2.5"
      style={{ background: "var(--panel-2)" }}
      role="status"
    >
      <span
        className="h-2 w-2 flex-none rounded-full"
        style={{ background: app.engine === "asleep" ? "var(--faint)" : "var(--amber)" }}
      />
      <span className="text-[12px] text-[var(--muted)]">
        {app.engine === "asleep"
          ? "The engine is asleep. The queue is saved; outstanding tasks resume when it wakes."
          : "Reconnecting to the engine… jobs keep their place in the queue."}
      </span>
      {app.engine === "asleep" && isTauri() && (
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => void app.resumeEngine()}>
          Wake engine
        </Button>
      )}
      {app.engine === "reconnecting" && isTauri() && (
        <Button size="sm" className="ml-auto" onClick={() => void app.restartEngine()}>
          Restart engine
        </Button>
      )}
    </div>
  );
}

function ConfirmModal() {
  const app = useApp();
  const pending = app.pendingConfirm;
  return (
    <Modal
      open={!!pending}
      onClose={() => app.confirmGenerate(false)}
      title={pending?.title}
      width={460}
      footer={
        <>
          <Button onClick={() => app.confirmGenerate(false)}>{pending?.cancelLabel ?? "Not yet"}</Button>
          <Button variant="primary" onClick={() => app.confirmGenerate(true)}>
            {pending?.confirmLabel ?? "Generate anyway"}
          </Button>
        </>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">{pending?.body}</p>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘↵", "Generate"],
  ["⌘K", "Command palette"],
  ["⌘S", "Save prompt (in Studio)"],
  ["⌘\\", "Toggle inspector"],
  ["⌘1 / ⌘2 / ⌘3", "Image / Video / Audio mode"],
  ["?", "This shortcut list"],
  ["Esc", "Close dialog or focus view"],
];

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" width={420}>
      <div>
        {SHORTCUTS.map(([keys, action]) => (
          <div
            key={keys}
            className="flex items-center justify-between border-b border-[var(--line)] py-2 last:border-0"
          >
            <span className="text-[12.5px] text-[var(--muted)]">{action}</span>
            <span className="kbd">{keys}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function App() {
  const app = useApp();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    void app.load();
  }, []);

  useEffect(() => {
    const keyboard = () => { document.documentElement.dataset.inputMethod = "keyboard"; };
    const pointer = () => { document.documentElement.dataset.inputMethod = "pointer"; };
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onNativeDrop((paths) => void useApp.getState().importPaths(paths)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "?" && !typing) {
        if (document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (document.querySelector('[role="dialog"]') && !app.paletteOpen) return;
        app.setPalette(!app.paletteOpen);
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (meta && e.key === "Enter") {
        e.preventDefault();
        void app.generate();
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (app.view === "studio") app.setSavePrompt(true);
        return;
      }
      if (meta && e.key === "\\") {
        e.preventDefault();
        app.toggleInspector();
        return;
      }
      if (meta && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        app.setMode(e.key === "1" ? "image" : e.key === "2" ? "video" : "audio");
        app.setView("studio");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app.view, app.paletteOpen]);

  if (!app.ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5" style={{ background: "var(--bg)" }}>
        <Aperture size={54} />
        <div className="mono text-[9px] uppercase tracking-[0.24em] text-[var(--faint)]">Q Studio</div>
        <Spinner size={14} />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col">
        <EngineBanner />
        <div className="min-h-0 flex-1">
          <Shell>
            {app.view === "studio" && <StudioView />}
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner size={16} />
                </div>
              }
            >
              {app.view === "film" && <FilmView />}
              {app.view === "prompts" && <PromptsView />}
              {app.view === "references" && <ReferencesView />}
              {app.view === "library" && <LibraryView />}
              {app.view === "settings" && <SettingsView />}
            </Suspense>
          </Shell>
        </div>
      </div>
      <CommandPalette />
      <SavePromptModal />
      <ReferencePicker />
      <Onboarding />
      <ConfirmModal />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Toasts items={app.toasts} />
    </ErrorBoundary>
  );
}
