import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { fmtDuration } from "../lib";
import { useMediaQuery } from "../ui";

function seedFrom(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Waveform({
  src,
  seed,
  compact,
}: {
  src: string;
  seed: string;
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubberFocused, setScrubberFocused] = useState(false);
  const scrubberId = useId();
  const narrow = useMediaQuery("(max-width: 480px)");

  const bars = useMemo(() => {
    const rnd = seedFrom(seed);
    const n = narrow ? 24 : compact ? 40 : 84;
    return Array.from({ length: n }, (_, i) => {
      const env = Math.sin((i / n) * Math.PI) * 0.55 + 0.45;
      return Math.max(0.12, Math.min(1, (0.35 + rnd() * 0.75) * env));
    });
  }, [seed, compact, narrow]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("error", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("error", onPause);
    };
  }, []);

  const pct = duration ? Math.min(1, time / duration) : 0;

  return (
    <div className={compact ? "" : "w-full"}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="audio-play flex h-10 w-10 flex-none items-center justify-center rounded-full border border-[var(--line-2)] bg-[var(--panel-2)] text-[var(--paper)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          onClick={async () => {
            const el = audioRef.current;
            if (!el) return;
            if (el.paused) {
              try {
                await el.play();
              } catch {
                setPlaying(false);
              }
            } else {
              el.pause();
            }
          }}
          aria-label={playing ? "Pause audio" : "Play audio"}
          aria-pressed={playing}
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
        <div className="waveform-track relative flex h-11 min-w-0 flex-1 items-center gap-[2px]" data-focused={scrubberFocused}>
          <div className="pointer-events-none flex h-full w-full items-center gap-[1px] sm:gap-[2px]" aria-hidden="true">
            {bars.map((h, i) => {
              const pos = i / bars.length;
              return (
                <span
                  key={i}
                  className="flex-1 rounded-[1px] transition-colors"
                  style={{
                    height: `${Math.round(h * 100)}%`,
                    background: pos <= pct ? "var(--accent)" : "var(--line-2)",
                    minWidth: 1,
                  }}
                />
              );
            })}
          </div>
          <input
            id={scrubberId}
            className="waveform-scrubber absolute inset-0 h-full w-full cursor-pointer"
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(time, duration)}
            disabled={!duration}
            aria-label="Seek audio"
            aria-valuetext={`${fmtDuration(time)} of ${fmtDuration(duration)}`}
            onChange={(event) => {
              const nextTime = Number(event.currentTarget.value);
              const el = audioRef.current;
              if (el) el.currentTime = nextTime;
              setTime(nextTime);
            }}
            onFocus={() => setScrubberFocused(true)}
            onBlur={() => setScrubberFocused(false)}
          />
        </div>
        <div className="mono w-[62px] flex-none text-right text-[10px] text-[var(--muted)] sm:w-[74px] sm:text-[10.5px]">
          {fmtDuration(time)} / {fmtDuration(duration)}
        </div>
      </div>
    </div>
  );
}

export function VideoPlayer({
  src,
  poster,
  className,
  videoRef,
}: {
  src: string;
  poster?: string;
  className?: string;
  videoRef?: React.Ref<HTMLVideoElement>;
}) {
  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      controls
      playsInline
      loop
      preload="metadata"
      className={className ?? "max-h-full max-w-full rounded-lg"}
    />
  );
}

export function KindGlyph({ kind, size = 12 }: { kind: string; size?: number }) {
  if (kind === "video")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="1.5" y="3" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6.6 6.2l3.4 1.8-3.4 1.8V6.2z" fill="currentColor" />
      </svg>
    );
  if (kind === "audio")
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2 6v4M5 4v8M8 2.5v11M11 5v6M14 6.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="6" cy="6" r="1.2" fill="currentColor" />
      <path d="M3 12l3.2-3.2 2.1 2.1L11 8l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function MediaGlyph({ kind }: { kind: string }) {
  return (
    <span className="flex h-full w-full items-center justify-center text-[var(--faint)]">
      <KindGlyph kind={kind} size={22} />
    </span>
  );
}

export function Img({
  src,
  alt,
  className,
  onClick,
}: {
  src?: string;
  alt: string;
  className?: string;
  onClick?: React.MouseEventHandler;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={className} onClick={onClick}>
        <span className="flex h-full w-full items-center justify-center text-[10px] text-[var(--faint)]">—</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" className={className} onClick={onClick} onError={() => setFailed(true)} />;
}
