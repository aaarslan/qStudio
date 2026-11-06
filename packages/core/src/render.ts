import type { LocalExportStatus } from "./types";

export interface FilmRenderAudio {
  id: string;
  name: string;
  path: string;
  gain: number;
}

export interface FilmRenderClip {
  id: string;
  mediaId: string;
  name: string;
  kind: "image" | "video";
  path: string;
  durationSeconds: number;
  trimIn?: number;
  trimOut?: number;
  hasAudio: boolean;
  audio: FilmRenderAudio[];
}

export interface FilmRenderGraph {
  version: 1;
  title: string;
  width: number;
  height: number;
  fps: number;
  clips: FilmRenderClip[];
}

export function compileFilmRenderGraph(input: {
  title: string;
  clips: FilmRenderClip[];
  width?: number;
  height?: number;
  fps?: number;
}): FilmRenderGraph {
  const width = Math.max(320, Math.round(input.width ?? 1280));
  const height = Math.max(180, Math.round(input.height ?? 720));
  const fps = Math.min(60, Math.max(12, Math.round(input.fps ?? 24)));
  return {
    version: 1,
    title: input.title.trim() || "Film preview",
    width: width % 2 === 0 ? width : width + 1,
    height: height % 2 === 0 ? height : height + 1,
    fps,
    clips: input.clips.map((clip) => {
      const trimIn = Math.max(0, clip.trimIn ?? 0);
      const trimOut = clip.trimOut && clip.trimOut > trimIn ? clip.trimOut : undefined;
      const durationSeconds =
        clip.kind === "image"
          ? clip.durationSeconds
          : trimOut !== undefined
            ? trimOut - trimIn
            : clip.durationSeconds;
      return {
        ...clip,
        trimIn,
        trimOut,
        durationSeconds: Math.max(0.1, durationSeconds),
        audio: clip.audio.map((audio) => ({
          ...audio,
          gain: Math.max(0, Math.min(1, audio.gain ?? 1)),
        })),
      };
    }),
  };
}

export function filmGraphDuration(graph: FilmRenderGraph): number {
  return Math.round(graph.clips.reduce((sum, clip) => sum + clip.durationSeconds, 0) * 10) / 10;
}

export function filmGraphSummary(graph: FilmRenderGraph) {
  return {
    clips: graph.clips.length,
    audioClips: graph.clips.reduce((sum, clip) => sum + clip.audio.length, 0),
    seconds: filmGraphDuration(graph),
    resolution: `${graph.width}x${graph.height}`,
    fps: graph.fps,
  };
}

export function canvasForAspect(aspect: string, longestEdge = 1280) {
  const match = /^(\d+):(\d+)$/.exec(aspect.trim());
  const widthRatio = match ? Math.max(1, Number(match[1])) : 16;
  const heightRatio = match ? Math.max(1, Number(match[2])) : 9;
  const edge = Math.max(320, Math.round(longestEdge));
  const rawWidth = widthRatio >= heightRatio ? edge : (edge * widthRatio) / heightRatio;
  const rawHeight = heightRatio >= widthRatio ? edge : (edge * heightRatio) / widthRatio;
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return {
    width: even(rawWidth),
    height: even(rawHeight),
  };
}

export interface LocalExport {
  id: string;
  worldId: string;
  title: string;
  status: LocalExportStatus;
  progress: number;
  graph: FilmRenderGraph;
  mediaId?: string;
  skipped: string[];
  note?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}
