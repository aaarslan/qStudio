import { getModel } from "./models";
import type { JobSpec, Mode, ModelDef } from "./types";

export const UNITS_LABEL = "relative estimate, not Token Plan billing";

const TIER_UNITS: Record<string, number> = { "1K": 1, "2K": 2.5, "4K": 8 };
const RES_UNITS: Record<string, number> = { "480P": 1, "720P": 2, "1080P": 4.5 };

export function estimateUnits(spec: JobSpec, model: ModelDef = getModel(spec.modelId)): number {
  if (model.mode === "image") {
    const tier = TIER_UNITS[spec.tier] ?? TIER_UNITS["2K"];
    const n = Math.max(1, spec.n);
    const think = spec.thinking ? 1.4 : 1;
    return round1(tier * n * think);
  }
  if (model.mode === "video") {
    const res = RES_UNITS[spec.resolution] ?? RES_UNITS["720P"];
    const secs = spec.smartDuration ? 5 : Math.max(1, spec.duration);
    const audio = spec.audioTrack ? 1.25 : 1;
    return round1(res * secs * audio);
  }
  const chars = Math.max(1, spec.prompt.length);
  return round1(Math.max(0.5, chars / 200));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function needsConfirm(spec: JobSpec, model: ModelDef = getModel(spec.modelId)): string | null {
  if (model.mode === "image") {
    if (spec.tier === "4K") return "This is a 4K image job";
    if (spec.n > 4) return `This asks for ${spec.n} images`;
  }
  if (model.mode === "video" && !spec.smartDuration && spec.duration >= 25) {
    return `This is a ${spec.duration}s video job`;
  }
  if (model.mode === "video" && spec.resolution === "1080P" && spec.duration >= 12) {
    return `This is a ${spec.duration}s 1080P video job`;
  }
  return null;
}

export function promptVariables(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export function expandVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g, (full, name: string) => {
    const value = vars[name]?.trim();
    return value ? value : full;
  });
}

export interface DoctorHint {
  kind: "missing" | "vague" | "risk";
  message: string;
}

const LIGHT_WORDS = ["light", "lighting", "golden hour", "backlight", "softbox", "rim light", "dusk", "noon", "shadow", "neon", "window light"];
const LENS_WORDS = ["mm", "lens", "depth of field", "close-up", "wide shot", "macro", "aerial", "low angle"];
const TEXT_RISKS = ["watermark", "logo text", "captions", "subtitles"];

export function doctorLite(text: string, mode: Mode): DoctorHint[] {
  const hints: DoctorHint[] = [];
  const lower = text.toLowerCase();
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) {
    hints.push({ kind: "vague", message: "Very short prompt. Name the subject, setting, and mood in one or two sentences." });
  }
  if (mode === "image" || mode === "video") {
    if (!LIGHT_WORDS.some((w) => lower.includes(w))) {
      hints.push({ kind: "missing", message: "No lighting described. Add a light source and time of day." });
    }
    if (!LENS_WORDS.some((w) => lower.includes(w))) {
      hints.push({ kind: "missing", message: "No framing described. Add a shot size or lens, such as a wide shot or 85mm." });
    }
    if (!/no text|without text|no watermark/.test(lower) && !TEXT_RISKS.some((w) => lower.includes(w))) {
      hints.push({ kind: "risk", message: "Models often invent stray text. Add \"no text\" unless lettering is the point." });
    }
  }
  if (mode === "video" && !/shot|cut|camera|dolly|pan|track|single.?take/.test(lower)) {
    hints.push({ kind: "missing", message: "No camera direction. Say whether the camera moves, and whether there are cuts." });
  }
  if (mode === "audio" && !/slowly|warm|pause|close|whisper|instruction/.test(lower)) {
    hints.push({ kind: "missing", message: "TTS reads literally. Use the instruction field for pace and tone, or emotion tags like [whispers]." });
  }
  return hints;
}

export interface ModerationFinding {
  id: string;
  level: "high" | "medium";
  reason: string;
  matches: string[];
}

const MINOR_PATTERNS: RegExp[] = [
  /\b(child|children|kid|kids|minor|minors|underage|toddler|toddlers|preteen|teenager|teenage|juvenile)\b/i,
  /\bschool\s*(girl|boy|uniform)\b/i,
  /\byoung\s+(girl|boy)\b/i,
  /\b(lolita|loli|shota)\b/i,
];

const INTIMACY_DEMEANOR: RegExp[] = [
  /\bpredatory\b/i,
  /\bseductive(ly)?\b/i,
  /\bsultry\b/i,
  /\bteasing(ly)?\b/i,
  /\bhusky\b/i,
  /\bara\s*~?\s*ara\b/i,
  /\bgood\s+(boy|girl)\b/i,
  /\bknowing\s+smile\b/i,
  /\bsmirk\b/i,
  /\bglossy\s+lips\b/i,
  /\blips\s+curving\b/i,
  /\bhips?\s+swaying\b/i,
  /\bcross(ing|es|ed)?\s+(her|his)\s+legs\b/i,
  /\bwhispers?\b/i,
];

const INTIMACY_DOMINANCE: RegExp[] = [
  /\bdominat\w*\b/i,
  /\bsubmiss\w*\b/i,
  /\bobedien\w*\b/i,
  /\bin\s+(command|complete\s+control|total\s+control)\b/i,
  /\b(entirely|completely)\s+in\s+control\b/i,
  /\bown(s|ing)?\s+the\s+(room|viewer)\b/i,
  /\beyes\s+on\s+me\b/i,
  /\bnowhere\s+else\b/i,
  /\bworship\w*\b/i,
  /\bat\s+(her|his)\s+feet\b/i,
];

const INTIMACY_VIEWER_CONTACT: RegExp[] = [
  /\bfirst[-\s]person\s+pov\b/i,
  /\bPOV\b/,
  /\bviewer'?s\s+own\s+eyes\b/i,
  /\btoward\s+the\s+(viewer|camera)\b/i,
  /\binto\s+the\s+lens\b/i,
  /\b(face|eyes|body)\s+fills?\s+the\s+frame\b/i,
  /\bfills?\s+the\s+frame\b/i,
  /\b(far\s+)?too\s+close\b/i,
  /\bleans?\s+(down\s+)?toward\s+the\s+(camera|lens|viewer)\b/i,
  /\btilts?\s+the\s+viewer'?s\s+chin\b/i,
  /\bchin\s+up\s+toward\b/i,
  /\bperch(es|ing|ed)?\s+on\b/i,
  /\bdirectly\s+in\s+front\s+of\s+the\s+viewer\b/i,
  /\bentire\s+field\s+of\s+vision\b/i,
  /\bclose\s+to\s+the\s+(viewer|lens)\b/i,
  /\btoward\s+the\s+viewer'?s\s+face\b/i,
];

const INTIMACY_BODY: RegExp[] = [
  /\b(nude|naked|topless)\b/i,
  /\b(lingerie|underwear|cleavage)\b/i,
  /\bbare\s+skin\b/i,
  /\b(skin[-\s]tight|body[-\s]hugging)\b/i,
  /\bbikini\b/i,
];

const VIOLENCE_PATTERNS: RegExp[] = [
  /\bgor(e|y)\b/i,
  /\bcorpse\b/i,
  /\bdead\s+body\b/i,
  /\btortur\w*\b/i,
  /\bsuicid\w*\b/i,
  /\bself[-\s]harm\b/i,
  /\bbehead\w*\b/i,
  /\bdismember\w*\b/i,
  /\bmassacre\b/i,
  /\bmurder\w*\b/i,
  /\bstab\w*\b/i,
  /\bstrangl\w*\b/i,
  /\bgunshot\b/i,
  /\bblood(y|ied)?\b/i,
  /\bbleeding\b/i,
];

const IMPERSONATION_PATTERNS: RegExp[] = [
  /\bdeepfake\b/i,
  /\bface[-\s]?swap\b/i,
  /\bimpersonat\w*\b/i,
  /\b(celebrity|public\s+figure|real\s+person|politician)\b/i,
];

function collectHits(patterns: RegExp[], text: string): string[] {
  const hits: string[] = [];
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m) {
      const clean = m[0].replace(/\s+/g, " ").trim();
      if (clean && !hits.some((h) => h.toLowerCase() === clean.toLowerCase())) hits.push(clean);
    }
  }
  return hits;
}

export function moderationRisks(
  text: string,
  opts: { promptExtend?: boolean } = {}
): ModerationFinding[] {
  const scanSource = text.split(/\bnegative\s+prompt\b/i)[0] ?? text;
  const findings: ModerationFinding[] = [];

  const demeanor = collectHits(INTIMACY_DEMEANOR, scanSource);
  const dominance = collectHits(INTIMACY_DOMINANCE, scanSource);
  const contact = collectHits(INTIMACY_VIEWER_CONTACT, scanSource);
  const body = collectHits(INTIMACY_BODY, scanSource);
  const intimacyHits = [...demeanor, ...dominance, ...contact, ...body];
  if (intimacyHits.length >= 3 || body.length >= 2) {
    const high =
      intimacyHits.length >= 7 ||
      (contact.length >= 2 && intimacyHits.length >= 5) ||
      body.length >= 2;
    findings.push({
      id: "intimacy",
      level: high ? "high" : "medium",
      reason:
        "Sustained intimate, viewer-directed closeness or dominance-flavoured direction. QwenCloud output checks commonly reject frames built from beats like these even when the text itself is accepted. Soften or cut the physical escalation and teasing lines, or try a shorter, less escalating shot.",
      matches: intimacyHits.slice(0, 5),
    });
  }

  const minorHits = collectHits(MINOR_PATTERNS, scanSource);
  const ageMatch = /\b(\d{1,2})\s*[- ]year[- ]old\b/i.exec(scanSource);
  if (ageMatch && Number(ageMatch[1]) < 18) minorHits.push(ageMatch[0]);
  if (minorHits.length > 0) {
    const high = intimacyHits.length >= 3 || /\b(lolita|loli|shota)\b/i.test(scanSource);
    findings.push({
      id: "minor",
      level: high ? "high" : "medium",
      reason:
        "Youth-related wording alongside a depicted person. Output checks are strict here regardless of intent. If everyone depicted is an adult, say so plainly and drop youth-coded descriptors.",
      matches: minorHits.slice(0, 5),
    });
  }

  const violenceHits = collectHits(VIOLENCE_PATTERNS, scanSource);
  if (violenceHits.length >= 1) {
    findings.push({
      id: "violence",
      level: violenceHits.length >= 3 ? "high" : "medium",
      reason:
        "Graphic violence or gore wording. Checks on generated frames are strict even for news, history, or action-genre intent. Reduce the graphic detail if the beat can survive without it.",
      matches: violenceHits.slice(0, 5),
    });
  }

  const impersonationHits = collectHits(IMPERSONATION_PATTERNS, scanSource);
  if (impersonationHits.length >= 1) {
    findings.push({
      id: "impersonation",
      level: /\b(deepfake|face[-\s]?swap)\b/i.test(scanSource) ? "high" : "medium",
      reason:
        "Real-person likeness wording. Generated likenesses of real people are commonly rejected. Use an original character instead.",
      matches: impersonationHits.slice(0, 5),
    });
  }

  findings.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));

  if (opts.promptExtend && findings.length > 0) {
    findings.push({
      id: "prompt-extend",
      level: "medium",
      reason:
        "Prompt rewrite is on, so QwenCloud expands this text before generating and the expanded result is what gets output-checked. If a job is rejected, retry with prompt rewrite off so the model renders exactly what you wrote.",
      matches: [],
    });
  }

  return findings;
}

export interface StoryboardShot {
  title: string;
  prompt: string;
  seconds: number;
}

export function compileStoryboard(shots: StoryboardShot[]): string {
  let at = 0;
  const parts = shots
    .filter((s) => s.prompt.trim() && s.seconds > 0)
    .map((s, i) => {
      const from = at;
      at += Math.round(s.seconds);
      const label = s.title.trim() ? `${s.title.trim()}. ` : "";
      return `Shot ${i + 1} [${from}-${at}s]: ${label}${s.prompt.trim()}`;
    });
  return parts.join(" ");
}

export function storyboardDuration(shots: StoryboardShot[]): number {
  return shots.reduce((sum, s) => sum + (s.seconds > 0 ? Math.round(s.seconds) : 0), 0);
}
