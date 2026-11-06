import type React from "react";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  FolderOpen,
  KeyRound,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useApp } from "../store";
import { api } from "../api";
import { isTauri, pickFolder } from "../tauri";
import type { UsageRecord } from "@core";
import { fmtBytes } from "../lib";
import { Button, Disclosure, Label, Modal, Segmented, Stepper, Switch } from "../ui";

function Card({
  title,
  sub,
  children,
  right,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="serif text-[17px] leading-tight">{title}</h2>
          {sub && <p className="mt-1 max-w-[520px] text-[11.5px] leading-relaxed text-[var(--muted)]">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function SettingsView() {
  const app = useApp();
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const [output, setOutput] = useState(app.settings.outputRoot);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof api.storage>> | null>(null);
  const [prune, setPrune] = useState<{
    label: string;
    body: Parameters<typeof api.prune>[0];
  } | null>(null);
  const [olderDays, setOlderDays] = useState(30);
  const [cap, setCap] = useState(String(app.settings.monthlyCapUnits ?? 0));

  const loadStorage = () => {
    void api.storage().then(setStorage).catch(() => {});
  };
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logNote, setLogNote] = useState("");

  useEffect(() => {
    setOutput(app.settings.outputRoot);
    setCap(String(app.settings.monthlyCapUnits ?? 0));
  }, [app.settings.outputRoot, app.settings.monthlyCapUnits]);

  useEffect(() => {
    if (app.engine !== "online") return;
    loadStorage();
    void api.usage().then((r) => setUsage(r.entries)).catch(() => {});
    void api
      .logs()
      .then((r) => {
        setLogLines(r.lines);
        setLogNote(r.note ?? "");
      })
      .catch(() => {});
  }, [app.engine]);

  return (
    <div className="scroll h-full">
      <div className="mx-auto max-w-[780px] space-y-4 px-6 py-7">
        <Card
          title="API key"
          sub="A Token Plan key starts with sk-sp-. It is stored in your macOS Keychain and sent only to the QwenCloud endpoint you select."
          right={
            <span className="flex items-center gap-1.5">
              <span
                className="dot"
                style={{ background: app.key.present ? "var(--jade)" : "var(--rose)" }}
              />
              <span className="mono text-[9.5px] uppercase tracking-wider text-[var(--muted)]">
                {app.key.present ? `Connected · ${app.key.prefix}` : "No key"}
              </span>
            </span>
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <KeyRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <input
                className="field field-mono h-9 pl-8"
                type={reveal ? "text" : "password"}
                placeholder="sk-sp-…"
                aria-label="QwenCloud API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && key.trim()) {
                    setSaving(true);
                    const saved = await app.saveKey(key.trim(), remember);
                    if (saved) {
                      const isToken = key.trim().startsWith("sk-sp-");
                      await app.saveSettings({ profile: isToken ? "token-plan" : "payg" });
                      setKey("");
                    }
                    setSaving(false);
                  }
                }}
              />
              <button
                className="mono absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-wider text-[var(--faint)] hover:text-[var(--paper)]"
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? "hide" : "show"}
              </button>
            </div>
            <Button
              variant="primary"
              className="h-9"
              disabled={!key.trim() || saving}
              onClick={async () => {
                setSaving(true);
                const saved = await app.saveKey(key.trim(), remember);
                if (saved) {
                  const isToken = key.trim().startsWith("sk-sp-");
                  await app.saveSettings({ profile: isToken ? "token-plan" : "payg" });
                  setKey("");
                }
                setSaving(false);
              }}
            >
              <Check size={13} /> {saving ? "Saving…" : "Save key"}
            </Button>
            {app.key.present && (
              <Button
                className="h-9 text-[var(--rose)]"
                onClick={() => {
                  void app.deleteKey();
                }}
              >
                <Trash2 size={12} /> Remove
              </Button>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-4">
            <Switch
              label="Remember in Keychain"
              hint="If off, the key is written to a 0600 file in the app support folder instead."
              checked={remember}
              onChange={setRemember}
            />
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
            <ShieldCheck size={11} />
            {app.key.present
              ? `Source: ${app.key.source} · server-side only, never in localStorage`
              : "No key yet. The app runs in demo mode until you add one."}
          </div>
          {app.key.source === "env" && (
            <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--muted)]">
              A key is coming from <span className="mono">QWEN_TOKEN_PLAN_KEY</span> (or{" "}
              <span className="mono">DASHSCOPE_API_KEY</span>) and overrides the Keychain. Unset it and
              restart the server to use a key saved here.
            </div>
          )}
        </Card>

        <Card
          title="Connection"
          sub="Token Plan is Singapore-only and uses its own host. Pay-as-you-go keys are region-specific."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Profile</Label>
              <Segmented
                className="w-full [&>button]:flex-1"
                value={app.settings.profile}
                options={[
                  { id: "token-plan", label: "Token Plan" },
                  { id: "payg", label: "Pay-as-you-go" },
                ]}
                onChange={(profile) => void app.saveSettings({ profile })}
              />
            </div>
            <div>
              <Label>Region</Label>
              <select
                className="field h-9 text-[12px]"
                aria-label="API region"
                value={app.settings.region}
                disabled={app.settings.profile === "token-plan"}
                onChange={(e) => void app.saveSettings({ region: e.target.value })}
              >
                <option value="singapore">Singapore (ap-southeast-1)</option>
                <option value="beijing">China North 2 (cn-beijing)</option>
                <option value="frankfurt">Germany (eu-central-1)</option>
                <option value="hong-kong">Hong Kong (cn-hongkong)</option>
                <option value="tokyo">Japan (ap-northeast-1)</option>
                <option value="virginia">US (us-east-1)</option>
              </select>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2">
            <div className="label mb-1">Base URL</div>
            <code className="mono break-all text-[10.5px] text-[var(--muted)]">{app.baseUrl}</code>
          </div>
          <div className="mt-4">
            <Label>Reference transport</Label>
            <select
              className="field h-9 text-[12px]"
              aria-label="Reference transport"
              value={app.settings.referenceTransport}
              onChange={(e) => void app.saveSettings({ referenceTransport: e.target.value as any })}
            >
              <option value="auto">Auto — base64 for images, upload for audio/video</option>
              <option value="base64">Always inline base64</option>
              <option value="oss">Always upload to QwenCloud temporary storage</option>
            </select>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--faint)]">
              QwenCloud accepts inline base64 for images. Video and audio references need a public URL:
              a clip generated in the last 24 hours reuses its hosted URL automatically; anything else
              needs the temporary-upload API (`oss://`, 48h), which the Token Plan gateway does not
              provide. Uploading local video or audio requires a pay-as-you-go key.
            </p>
          </div>
          <div className="mt-4">
            <Switch
              label="Demo mode"
              hint="Compose and preview the full UI without calling the API. Demo media is generated locally (SVG stills, ffmpeg clips and tones)."
              checked={app.settings.demoMode}
              onChange={(demoMode) => void app.saveSettings({ demoMode })}
            />
          </div>
        </Card>

        <Card
          title="Storage"
          sub="Generated files are written into dated folders. The absolute path appears under every output."
          right={
            <Button size="sm" variant="ghost" onClick={() => void api.openOutput()}>
              <FolderOpen size={12} /> Open
            </Button>
          }
        >
          <Label htmlFor="output-folder">Output folder</Label>
          <div className="flex gap-2">
            <input
              id="output-folder"
              className="field field-mono h-9"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            />
            {isTauri() && (
              <Button
                className="h-9"
                onClick={async () => {
                  const picked = await pickFolder(output);
                  if (picked) {
                    setOutput(picked);
                    await app.saveSettings({ outputRoot: picked });
                  }
                }}
              >
                Choose…
              </Button>
            )}
            <Button
              className="h-9"
              disabled={!output.trim() || output === app.settings.outputRoot}
              onClick={() => void app.saveSettings({ outputRoot: output.trim() })}
            >
              Save
            </Button>
          </div>
          <div className="mono mt-3 space-y-1 text-[10px] leading-relaxed text-[var(--faint)]">
            <div>{app.settings.outputRoot}/images/YYYY-MM-DD/</div>
            <div>{app.settings.outputRoot}/videos/YYYY-MM-DD/</div>
            <div>{app.settings.outputRoot}/audio/YYYY-MM-DD/</div>
            <div>{app.settings.outputRoot}/references/YYYY-MM-DD/</div>
          </div>
          {storage && (
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <div className="mono space-y-1 text-[10.5px] leading-relaxed text-[var(--muted)]">
                <div>
                  {storage.mediaCount} files · {fmtBytes(storage.mediaBytes)} (images{" "}
                  {fmtBytes(storage.byKind.image)} · video {fmtBytes(storage.byKind.video)} · audio{" "}
                  {fmtBytes(storage.byKind.audio)})
                </div>
                <div>
                  Thumbnails {fmtBytes(storage.thumbsBytes)} · database {fmtBytes(storage.dbBytes)} ·{" "}
                  {storage.demoCount} demo outputs · {storage.deadJobs} failed/canceled job records
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={storage.demoCount === 0}
                  onClick={() =>
                    setPrune({
                      label: `Delete ${storage.demoCount} demo outputs and their files? Real generations and uploads are untouched.`,
                      body: { demo: true },
                    })
                  }
                >
                  Prune demo outputs
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={storage.thumbsBytes === 0}
                  onClick={() =>
                    setPrune({
                      label: `Clear ${fmtBytes(storage.thumbsBytes)} of thumbnails and cached frames? They regenerate on demand.`,
                      body: { thumbs: true },
                    })
                  }
                >
                  Clear thumbnails
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={storage.deadJobs === 0}
                  onClick={() =>
                    setPrune({
                      label: `Remove ${storage.deadJobs} failed/canceled job records? Media files are untouched.`,
                      body: { deadJobs: true },
                    })
                  }
                >
                  Clear dead jobs
                </Button>
                <span className="flex items-center gap-1.5">
                  <input
                    className="field field-mono h-8 w-20 text-[11px]"
                    type="number"
                    min={1}
                    value={olderDays}
                    onChange={(e) => setOlderDays(Math.max(1, Number(e.target.value) || 30))}
                    aria-label="Older than days"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setPrune({
                        label: `Delete generated files older than ${olderDays} days? Favourites and uploads are kept. This cannot be undone.`,
                        body: { olderThanDays: olderDays },
                      })
                    }
                  >
                    Prune older generated
                  </Button>
                </span>
              </div>
            </div>
          )}
        </Card>

        <Card title="Behaviour" sub="Keep concurrency low while testing — video jobs settle Credits when they finish.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stepper
              label="Image concurrency"
              value={app.settings.concurrencyImages}
              min={1}
              max={4}
              onChange={(v) => void app.saveSettings({ concurrencyImages: v })}
            />
            <Stepper
              label="Video / audio concurrency"
              value={app.settings.concurrencyVideo}
              min={1}
              max={2}
              onChange={(v) => void app.saveSettings({ concurrencyVideo: v })}
            />
          </div>
          <div className="mt-4">
            <Label>Monthly soft cap (units, 0 = off)</Label>
            <input
              className="field field-mono h-9 w-40"
              type="number"
              min={0}
              aria-label="Monthly soft cap in units"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              onBlur={() => {
                const value = Math.max(0, Math.min(1_000_000, Number(cap) || 0));
                setCap(String(value));
                if (value !== (app.settings.monthlyCapUnits ?? 0)) void app.saveSettings({ monthlyCapUnits: value });
              }}
            />
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--faint)]">
              Units are a {app.usage.label}. This month so far: {app.usage.monthUnits} units. Hitting the cap
              asks before each new job; it never cancels running work.
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--muted)]">Theme</span>
            <Segmented
              value={app.settings.theme}
              options={[
                { id: "dark", label: "Darkroom" },
                { id: "light", label: "Daylight" },
              ]}
              onChange={(t) => app.setTheme(t)}
            />
          </div>
        </Card>

        <Card
          title="Engine"
          sub="The local generation engine. In the desktop app it starts and stops with the window or the tray menu."
          right={
            isTauri() ? (
              <Button size="sm" variant="ghost" onClick={() => void app.restartEngine()}>
                Restart engine
              </Button>
            ) : undefined
          }
        >
          <div className="mono space-y-1 text-[10.5px] leading-relaxed text-[var(--muted)]">
            <div>Status: {app.engine}</div>
            <div>ffmpeg: {app.tools.ffmpeg ?? "not found (brew install ffmpeg)"}</div>
            <div>ffprobe: {app.tools.ffprobe ?? "not found"}</div>
            <div>sips: {app.tools.sips ? "available" : "unavailable"}</div>
            {app.integrity.orphanedTakes > 0 && (
              <div className="text-[var(--amber)]">
                Data check: {app.integrity.orphanedTakes} film take(s) lost their job and saved media link.
              </div>
            )}
            {app.integrity.missingTakeMedia > 0 && (
              <div className="text-[var(--rose)]">
                Data check: {app.integrity.missingTakeMedia} film take(s) point at missing media.
              </div>
            )}
            {app.integrity.warnings.map((warning) => (
              <div key={warning} className="text-[var(--amber)]">
                {warning}
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Disclosure title="Engine log (last 300 lines)">
              {logNote ? (
                <p className="text-[11px] text-[var(--faint)]">{logNote}</p>
              ) : (
                <pre className="mono max-h-[300px] overflow-auto rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] p-2.5 text-[9.5px] leading-[1.6] text-[var(--muted)]">
                  {logLines.join("\n") || "No log lines yet."}
                </pre>
              )}
            </Disclosure>
          </div>
        </Card>

        <Card
          title="Usage"
          sub={`Estimated units per finished job (${app.usage.label}). This month: ${app.usage.monthUnits} units${app.usage.capUnits ? ` of ${app.usage.capUnits}` : ""}.`}
        >
          {usage.length === 0 ? (
            <p className="text-[11.5px] text-[var(--faint)]">No finished jobs yet.</p>
          ) : (
            <div className="max-h-[260px] overflow-auto">
              {usage.slice(0, 40).map((entry) => (
                <div
                  key={entry.id}
                  className="mono flex items-baseline gap-2 border-b border-[var(--line)] py-1.5 text-[10px] text-[var(--muted)] last:border-0"
                >
                  <span className="w-36 flex-none">{entry.createdAt.slice(0, 16).replace("T", " ")}</span>
                  <span className="w-44 flex-none truncate">{entry.modelId}</span>
                  <span className="w-20 flex-none">{entry.units} units</span>
                  <span className="min-w-0 truncate text-[var(--faint)]">{entry.filePath ?? entry.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="About this build" sub="A local, single-user studio. No telemetry, no cloud database, no background automation.">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Outputs", app.stats.media],
              ["Jobs", app.stats.jobs],
              ["Prompts", app.stats.prompts],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-2.5">
                <div className="mono text-[17px]">{value}</div>
                <div className="label mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-3.5 text-[11px] leading-relaxed text-[var(--muted)]">
            <span className="text-[var(--paper)]">Token Plan terms.</span> QwenCloud licenses the Token Plan for
            interactive use inside programming and agent tools and prohibits custom application backends or
            non-interactive batch use. Q Studio runs on this machine, on your explicit click, with a capped local
            queue,
            and it exposes the exact request as cURL so any job can be replayed inside your agent tool. If you
            need unattended or multi-user use, switch this profile to a pay-as-you-go key.
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
            <a
              className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--paper)]"
              href="https://docs.qwencloud.com/token-plan/best-practices/integrate-multimodal-gen"
              target="_blank"
              rel="noreferrer"
            >
              Multimodal integration guide <ExternalLink size={10} />
            </a>
            <a
              className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--paper)]"
              href="https://home.qwencloud.com/analytics/token-plan/individual"
              target="_blank"
              rel="noreferrer"
            >
              Token Plan usage <ArrowUpRight size={10} />
            </a>
          </div>
        </Card>
      </div>
      <Modal
        open={!!prune}
        onClose={() => setPrune(null)}
        title="Prune storage"
        width={440}
        footer={
          <>
            <Button onClick={() => setPrune(null)}>Keep everything</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!prune) return;
                const body = prune.body;
                setPrune(null);
                try {
                  const result = await api.prune(body);
                  app.toast(
                    `Freed ${fmtBytes(result.freedBytes)} (${result.removedMedia} files, ${result.removedJobs} jobs).`,
                    "ok"
                  );
                  loadStorage();
                  await app.refresh();
                } catch (err) {
                  app.toast((err as Error).message, "err");
                }
              }}
            >
              Prune
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">{prune?.label}</p>
      </Modal>
    </div>
  );
}
