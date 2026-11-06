import { useState } from "react";
import { ArrowRight, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { useApp } from "../store";
import { Aperture, Button } from "../ui";

export function Onboarding() {
  const app = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  if (!app.onboardingOpen) return null;

  const save = async (demo: boolean) => {
    setBusy(true);
    if (demo && !key.trim()) {
      await app.saveSettings({ demoMode: true });
      app.dismissOnboarding();
    } else if (key.trim()) {
      const saved = await app.saveKey(key.trim(), true);
      if (saved) {
        await app.saveSettings({ profile: key.trim().startsWith("sk-sp-") ? "token-plan" : "payg" });
      }
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(4,4,5,0.82)] p-6 backdrop-blur-md">
      <div className="dialog grid w-full max-w-[880px] grid-cols-1 overflow-hidden md:grid-cols-[0.9fr_1.1fr]" role="dialog" aria-modal="true" aria-label="Set up Q Studio">
        <div className="relative hidden flex-col justify-between overflow-hidden p-7 md:flex" style={{ background: "linear-gradient(150deg, #171310, #0c0c0d 62%)" }}>
          <div
            className="absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(120% 90% at 18% 6%, rgba(255,107,61,.30), transparent 55%), radial-gradient(80% 70% at 86% 88%, rgba(124,156,255,.14), transparent 60%)",
            }}
          />
          <div className="relative">
            <Aperture size={40} />
          </div>
          <div className="relative">
            <div className="mono mb-2 text-[9px] uppercase tracking-[0.2em] text-[#9a9791]">A local darkroom</div>
            <div className="serif serif-display text-[30px] leading-[1.1] text-[#f2f0eb]">
              Compose.
              <br />
              Watch.
              <br />
              Keep.
            </div>
            <p className="mt-3 max-w-[240px] text-[11.5px] leading-relaxed text-[#9a9791]">
              Images, edits, video and voice from one prompt bench — every output saved to disk with its
              path, and every asset ready to become the next reference.
            </p>
          </div>
          <div className="relative mono text-[9px] uppercase tracking-[0.16em] text-[#6b6862]">
            Token Plan · Singapore
          </div>
        </div>

        <div className="p-7">
          <div className="serif serif-display text-[24px]">Welcome to Q Studio</div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
            Add your Token Plan key to use the real models, or explore the whole studio in demo mode first.
          </p>

          <div className="mt-5">
            <div className="label mb-2">Token Plan API key</div>
            <div className="relative">
              <KeyRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <input
                className="field field-mono h-10 pl-8"
                type="password"
                placeholder="sk-sp-…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && key.trim()) void save(false);
                }}
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
              <ShieldCheck size={10} />
              Stored in macOS Keychain. Sent only to the QwenCloud host.
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Button variant="primary" className="h-10" disabled={!key.trim() || busy} onClick={() => void save(false)}>
              {busy ? "Saving…" : "Save key and start"} <ArrowRight size={13} />
            </Button>
            <Button className="h-10" disabled={busy} onClick={() => void save(true)}>
              <Sparkles size={13} /> Explore in demo mode
            </Button>
          </div>

          <div className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-3 text-[10.5px] leading-relaxed text-[var(--faint)]">
            Q Studio runs locally, on your click, with a small capped queue — no server, no scheduled calls. The Token
            Plan is licensed for interactive use in agent tools, so every job can also be copied as a cURL
            request and replayed inside yours.
          </div>

          <button className="mt-4 text-[10.5px] text-[var(--faint)] underline decoration-[var(--line-2)] underline-offset-2 hover:text-[var(--muted)]" onClick={app.dismissOnboarding}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
