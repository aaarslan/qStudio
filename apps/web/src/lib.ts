export function cn(...args: (string | false | null | undefined)[]) {
  return args.filter(Boolean).join(" ");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export function fmtBytes(n?: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDuration(secs?: number): string {
  if (!secs || !Number.isFinite(secs)) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function elapsed(from?: string, to?: string): string {
  if (!from) return "0:00";
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function statusMeta(status: string): { label: string; dot: string; text: string } {
  switch (status) {
    case "queued":
      return { label: "Queued", dot: "dot", text: "text-[var(--muted)]" };
    case "running":
      return { label: "Running", dot: "dot dot-live", text: "text-[var(--amber)]" };
    case "succeeded":
      return { label: "Done", dot: "dot dot-ok", text: "text-[var(--jade)]" };
    case "failed":
      return { label: "Failed", dot: "dot dot-err", text: "text-[var(--rose)]" };
    case "canceled":
      return { label: "Canceled", dot: "dot", text: "text-[var(--faint)]" };
    default:
      return { label: status, dot: "dot", text: "text-[var(--muted)]" };
  }
}

export function kindIcon(kind: string): string {
  return kind === "video" ? "▸" : kind === "audio" ? "∿" : "◻";
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
