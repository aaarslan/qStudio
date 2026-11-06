import { useEffect, useState } from "react";
import { useApp } from "../store";
import { useMediaQuery } from "../ui";
import { cn } from "../lib";
import { Composer } from "../components/Composer";
import { Stage } from "../components/Stage";
import { Inspector } from "../components/Inspector";

export function StudioView() {
  const app = useApp();
  const wide = useMediaQuery("(min-width: 1180px)");
  const compact = useMediaQuery("(max-width: 760px)");
  const [compactPane, setCompactPane] = useState<"compose" | "preview">("compose");

  useEffect(() => {
    if (compact && app.activeJobId) setCompactPane("preview");
  }, [compact, app.activeJobId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {compact && (
        <div className="flex flex-none justify-center border-b border-[var(--line)] py-1.5">
          <div className="seg mx-3 flex w-full max-w-[420px]" role="group" aria-label="Studio view">
            <button
              type="button"
              className="seg-item flex-1 justify-center"
              data-on={compactPane === "compose"}
              aria-pressed={compactPane === "compose"}
              onClick={() => setCompactPane("compose")}
            >
              Compose
            </button>
            <button
              type="button"
              className="seg-item flex-1 justify-center"
              data-on={compactPane === "preview"}
              aria-pressed={compactPane === "preview"}
              onClick={() => setCompactPane("preview")}
            >
              Preview
            </button>
          </div>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {(!compact || compactPane === "compose") && (
          <aside className={cn("flex min-h-0 flex-none flex-col", compact ? "w-full min-w-0" : "w-[352px] border-r border-[var(--line)] 2xl:w-[384px]")}>
            <Composer />
          </aside>
        )}
        {(!compact || compactPane === "preview") && (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Stage />
          </section>
        )}
        {app.inspectorOpen && wide && (
          <aside className="flex min-h-0 w-[320px] flex-none flex-col border-l border-[var(--line)] 2xl:w-[344px]">
            <Inspector />
          </aside>
        )}
      </div>
      {app.inspectorOpen && !wide && (
        <>
          <div className="fixed inset-x-0 bottom-0 top-[56px] z-30 bg-black/50" onClick={app.toggleInspector} />
          <div className="fixed bottom-0 right-0 top-[56px] z-40 flex w-[min(340px,calc(100vw-62px))] flex-col border-l border-[var(--line-2)] bg-[var(--panel)] shadow-2xl">
            <Inspector />
          </div>
        </>
      )}
    </div>
  );
}
