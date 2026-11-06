import type React from "react";
import {
  Aperture as ApertureIcon,
  BookMarked,
  Clapperboard,
  Images,
  LayoutGrid,
  Moon,
  Search,
  Settings2,
  Sun,
} from "lucide-react";
import { useApp } from "../store";
import type { View } from "../store";
import { cn } from "../lib";
import { Aperture, IconButton, Tip } from "../ui";

const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "studio", label: "Studio", icon: <ApertureIcon size={17} /> },
  { id: "film", label: "Film", icon: <Clapperboard size={17} /> },
  { id: "prompts", label: "Prompts", icon: <BookMarked size={17} /> },
  { id: "references", label: "References", icon: <Images size={17} /> },
  { id: "library", label: "Library", icon: <LayoutGrid size={17} /> },
];

const TITLES: Record<View, { title: string; sub: string }> = {
  studio: { title: "Studio", sub: "Compose, watch, keep." },
  film: { title: "Film", sub: "Worlds, scenes and shots that hold together." },
  prompts: { title: "Prompts", sub: "Reusable recipes, ready for new references." },
  references: { title: "References", sub: "Everything you can point a prompt at." },
  library: { title: "Library", sub: "Everything you’ve developed." },
  settings: { title: "Settings", sub: "Key, storage and behaviour." },
};

export function Shell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const meta = TITLES[app.view];

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="flex w-[62px] flex-none flex-col items-center border-r border-[var(--line)] py-3">
        <button
          className="mb-5 flex h-10 w-10 items-center justify-center"
          onClick={() => app.setView("studio")}
          title="Q Studio"
          aria-label="Q Studio home"
        >
          <Aperture size={30} />
        </button>
        <nav className="flex flex-col gap-0.5" aria-label="Views">
          {NAV.map((item) => (
            <Tip key={item.id} text={item.label}>
              <button
                className="rail-btn"
                data-on={app.view === item.id}
                aria-label={item.label}
                aria-current={app.view === item.id ? "page" : undefined}
                onClick={() => app.setView(item.id)}
              >
                {item.icon}
              </button>
            </Tip>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Tip
            text={
              app.engine === "online"
                ? "Engine online"
                : app.engine === "asleep"
                  ? "Engine asleep — click to wake"
                  : "Engine reconnecting…"
            }
          >
            <button
              onClick={() => {
                if (app.engine === "asleep") void app.resumeEngine();
                else app.setView("settings");
              }}
              className="flex h-7 w-7 items-center justify-center"
              aria-label="Engine status"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background:
                    app.engine === "online" ? "var(--jade)" : app.engine === "asleep" ? "var(--faint)" : "var(--amber)",
                  boxShadow: `0 0 8px ${app.engine === "online" ? "var(--jade)" : app.engine === "asleep" ? "transparent" : "var(--amber)"}`,
                }}
              />
            </button>
          </Tip>
          <Tip text={app.key.present ? `Key ${app.key.prefix}` : "Demo mode"}>
            <button
              onClick={() => app.setView("settings")}
              className="mb-1 flex h-7 w-7 items-center justify-center"
              aria-label="Key status"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: app.key.present ? "var(--jade)" : app.settings.demoMode ? "var(--amber)" : "var(--rose)",
                  boxShadow: `0 0 8px ${app.key.present ? "var(--jade)" : app.settings.demoMode ? "var(--amber)" : "var(--rose)"}`,
                }}
              />
            </button>
          </Tip>
          <Tip text="Settings">
            <button
              className="rail-btn"
              data-on={app.view === "settings"}
              aria-label="Settings"
              aria-current={app.view === "settings" ? "page" : undefined}
              onClick={() => app.setView("settings")}
            >
              <Settings2 size={17} />
            </button>
          </Tip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="chrome-header flex h-[56px] flex-none items-center gap-4 border-b border-[var(--line)] px-5">
          <div className="flex items-baseline gap-3">
            <span className="mono hidden text-[9px] uppercase tracking-[0.22em] text-[var(--faint)] min-[380px]:inline">Q Studio</span>
            <span className="hidden h-3 w-px bg-[var(--line-2)] min-[380px]:inline" />
            <h1 className="serif text-[17px] leading-none">{meta.title}</h1>
            <span className="hidden text-[11.5px] text-[var(--muted)] lg:inline">{meta.sub}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {!app.key.present && (
              <button
                onClick={() => app.setView("settings")}
                className="chip chip-accent mr-1 hidden sm:inline-flex"
              >
                <span className="dot" style={{ background: "var(--accent)" }} />
                Demo
              </button>
            )}
            <button
              onClick={() => app.setPalette(true)}
              className="flex h-8 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2.5 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--line-2)] hover:text-[var(--paper)]"
            >
              <Search size={12} />
              <span className="hidden md:inline">Search</span>
              <span className="kbd ml-2">⌘K</span>
            </button>
            <IconButton
              label={app.settings.theme === "dark" ? "Light theme" : "Dark theme"}
              onClick={() => app.setTheme(app.settings.theme === "dark" ? "light" : "dark")}
            >
              {app.settings.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </IconButton>
          </div>
        </header>

        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
