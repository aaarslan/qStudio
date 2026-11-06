import { useEffect, useMemo, useState } from "react";
import { BookOpen, Clapperboard, PanelRight, Plus } from "lucide-react";
import type { Entity, Scene, Shot } from "@core";
import { useApp } from "../store";
import { Button, Empty, Input, useMediaQuery } from "../ui";
import { WorldColumn } from "./film/world";
import { byOrder } from "./film/shared";
import { ShotBoard } from "./film/board";
import { FilmStrip } from "./film/player";
import { ShotEditor } from "./film/editors";

export function FilmView() {
  const app = useApp();
  const [newWorldTitle, setNewWorldTitle] = useState("");
  const [drawer, setDrawer] = useState<"world" | "shot" | null>(null);
  const narrow = useMediaQuery("(max-width: 1279px)");
  const world = app.worlds.find((w) => w.id === app.activeWorldId) ?? app.worlds[0] ?? null;

  useEffect(() => {
    if (narrow && app.activeShotId) setDrawer("shot");
  }, [app.activeShotId, narrow]);

  useEffect(() => {
    if (!narrow) setDrawer(null);
  }, [narrow]);

  const film = useMemo(() => {
    if (!world) return { entities: [] as Entity[], scenes: [] as Scene[], shots: [] as Shot[] };
    return {
      entities: app.entities.filter((e) => e.worldId === world.id),
      scenes: byOrder(app.scenes.filter((s) => s.worldId === world.id)),
      shots: app.shots.filter((s) => s.worldId === world.id),
    };
  }, [app.entities, app.scenes, app.shots, world]);

  if (!world) {
    return (
      <div className="scroll h-full">
        <Empty
          icon={<Clapperboard size={34} />}
          title="No film yet"
          sub="A world holds the cast, the rooms, the palette and the rules. Shots inside it stay consistent because they compile from the same bible."
          action={
            <form
              className="flex w-full max-w-[420px] flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void app.createWorld(newWorldTitle);
                setNewWorldTitle("");
              }}
            >
              <Input
                value={newWorldTitle}
                onChange={(e) => setNewWorldTitle(e.target.value)}
                placeholder="Film title, for example Night Ferry"
                className="w-full min-w-0 max-w-[280px]"
                aria-label="Film title"
              />
              <Button variant="primary" type="submit" className="shrink-0">
                <Plus size={13} /> New world
              </Button>
            </form>
          }
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      {(!narrow || drawer === "world") && (
        <div
          className={
            narrow
              ? "absolute inset-y-0 left-0 z-40 w-[318px] max-w-[88vw] border-r border-[var(--line)] bg-[var(--panel)] shadow-2xl"
              : "flex flex-none"
          }
        >
          <WorldColumn
            world={world}
            entities={film.entities}
            onClose={narrow ? () => setDrawer(null) : undefined}
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <ShotBoard world={world} scenes={film.scenes} shots={film.shots} entities={film.entities} />
        <FilmStrip world={world} scenes={film.scenes} shots={film.shots} />
      </div>
      {(!narrow || drawer === "shot") && (
        <div
          className={
            narrow
              ? "absolute inset-y-0 right-0 z-40 w-[348px] max-w-[92vw] border-l border-[var(--line)] bg-[var(--panel)] shadow-2xl"
              : "flex flex-none"
          }
        >
          <ShotEditor
            world={world}
            scenes={film.scenes}
            shots={film.shots}
            entities={film.entities}
            onClose={narrow ? () => setDrawer(null) : undefined}
          />
        </div>
      )}
      {narrow && (
        <div className="absolute bottom-[68px] left-3 z-30 flex gap-1.5 rounded-lg border border-[var(--line-2)] bg-[color-mix(in_srgb,var(--panel)_94%,transparent)] p-1 shadow-xl backdrop-blur">
          <Button size="sm" variant={drawer === "world" ? "primary" : "ghost"} onClick={() => setDrawer(drawer === "world" ? null : "world")}>
            <BookOpen size={12} /> Bible
          </Button>
          <Button size="sm" variant={drawer === "shot" ? "primary" : "ghost"} onClick={() => setDrawer(drawer === "shot" ? null : "shot")}>
            <PanelRight size={12} /> Shot
          </Button>
        </div>
      )}
    </div>
  );
}
