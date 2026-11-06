import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, Minus, Plus, X } from "lucide-react";
import { cn, copyText } from "./lib";

/* ------------------------------- button ------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "default", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-ghost",
        variant === "danger" && "text-[var(--rose)]",
        size === "sm" && "btn-sm",
        className
      )}
      {...rest}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      data-active={active}
      className={cn("icon-btn", active && "active", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------ segmented ----------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accent,
  className,
}: {
  value: T;
  options: { id: T; label: React.ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("seg", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          tabIndex={value === o.id ? 0 : -1}
          aria-selected={value === o.id}
          title={o.title}
          disabled={o.disabled}
          data-on={value === o.id}
          data-accent={accent && value === o.id}
          className={cn("seg-item", o.disabled && "opacity-40")}
          onClick={() => !o.disabled && onChange(o.id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const enabled = options.filter((option) => !option.disabled);
            if (!enabled.length) return;
            const current = enabled.findIndex((option) => option.id === o.id);
            const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
            const next = enabled[index];
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)');
            buttons?.[index]?.focus();
            onChange(next.id);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- fields ------------------------------- */

export function Label({
  children,
  className,
  htmlFor,
}: {
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  if (htmlFor) {
    return <label htmlFor={htmlFor} className={cn("label mb-2 block", className)}>{children}</label>;
  }
  return <div className={cn("label mb-2", className)}>{children}</div>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("field", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("field resize-none", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("field", props.className)} />;
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left transition-opacity",
        disabled && "opacity-40"
      )}
    >
      <span className="min-w-0">
        <span className="block text-[12.5px] text-[var(--paper)]">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-[var(--faint)]">{hint}</span>}
      </span>
      <span
        aria-hidden
        className="relative h-[19px] w-[33px] flex-none rounded-full border transition-colors"
        style={{
          background: checked ? "var(--accent)" : "var(--panel-3)",
          borderColor: checked ? "var(--accent)" : "var(--line-2)",
        }}
      >
        <span
          className="absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-transform"
          style={{ transform: `translateX(${checked ? 15 : 2}px)` }}
        />
      </span>
    </button>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="mr-auto text-[12px] text-[var(--muted)]">{label}</span>}
      <div className="flex items-center rounded-lg border border-[var(--line)] bg-[var(--bg-elev)]">
        <button
          aria-label="Decrease"
          className="icon-btn h-7 w-7"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus size={12} />
        </button>
        <span className="mono w-7 text-center text-[12px]">{value}</span>
        <button
          aria-label="Increase"
          className="icon-btn h-7 w-7"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={ariaLabel}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--panel-3)] accent-[var(--accent)]"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="mono min-w-[46px] text-right text-[11.5px] text-[var(--muted)]">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

/* ------------------------------- modal -------------------------------- */

export function Modal({
  open,
  onClose,
  children,
  width = 620,
  title,
  sub,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  title?: React.ReactNode;
  sub?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])'
      );
      (target ?? panelRef.current)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="dialog-backdrop flex items-start justify-center overflow-auto p-3 sm:p-6 md:p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn("dialog flex max-h-[calc(100dvh-1.5rem)] w-full flex-col outline-none sm:max-h-[calc(100dvh-3rem)] md:max-h-[calc(100dvh-5rem)]", className)}
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || sub) && (
          <div className="flex flex-none items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-4 sm:px-6">
            <div className="min-w-0 break-words">
              {title && <div id={titleId} className="serif text-[20px] leading-tight">{title}</div>}
              {sub && <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">{sub}</div>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1 flex-none">
              <X size={16} />
            </IconButton>
          </div>
        )}
        <div className="scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        {footer && (
          <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------- misc --------------------------------- */

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="spin inline-block rounded-full border-2 border-[var(--line-2)] border-t-[var(--accent)]"
      style={{ width: size, height: size }}
    />
  );
}

export function CopyButton({ text, label = "Copy", small }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={cn("btn", small && "btn-sm", "gap-1.5")}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  right,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1.5 py-1 text-[11.5px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={12} className={cn("transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-max max-w-[240px] -translate-x-1/2 rounded-md border border-[var(--line-2)] bg-[var(--panel-3)] px-2 py-1 text-[10.5px] leading-snug text-[var(--paper)] shadow-lg group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function Empty({
  icon,
  title,
  sub,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      {icon && <div className="mb-4 text-[var(--faint)]">{icon}</div>}
      <div className="serif text-[19px] text-[var(--paper)]">{title}</div>
      {sub && <div className="mt-1.5 max-w-[380px] text-[12.5px] leading-relaxed text-[var(--muted)]">{sub}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Aperture({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle cx="24" cy="24" r="19" stroke="var(--line-2)" strokeWidth="1.2" />
      {Array.from({ length: 6 }, (_, i) => (
        <path
          key={i}
          d="M24 24 L24 5 A19 19 0 0 1 40.5 14.5 Z"
          stroke="var(--line-2)"
          strokeWidth="1.1"
          transform={`rotate(${i * 60} 24 24)`}
        />
      ))}
      <circle cx="24" cy="24" r="3.4" fill="var(--accent)" />
    </svg>
  );
}

/* ------------------------------ toasts -------------------------------- */

export function Toasts({ items }: { items: { id: string; message: string; kind: string }[] }) {
  return createPortal(
    <div
      className="pointer-events-none fixed right-4 top-[66px] z-[90] flex w-[min(92vw,380px)] flex-col items-end gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "err" ? "alert" : "status"}
          className="rise-in pointer-events-auto flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] shadow-lg backdrop-blur"
          style={{
            background: "color-mix(in srgb, var(--panel) 92%, transparent)",
            borderColor: "var(--line-2)",
          }}
        >
          <span
            className="dot"
            style={{
              background:
                t.kind === "ok" ? "var(--jade)" : t.kind === "err" ? "var(--rose)" : "var(--accent)",
            }}
          />
          <span className="leading-snug">{t.message}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}

/* ------------------------------ hooks --------------------------------- */

export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatch(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return match;
}

export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [onOutside]);
  return ref;
}
