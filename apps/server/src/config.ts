import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { REGIONS, TOKEN_PLAN_BASE } from "@qstudio/core";
import type { Settings } from "@qstudio/core";

const exec = promisify(execFile);

export const APP_DIR =
  process.env.QSTUDIO_HOME ??
  (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Q Studio")
    : path.join(os.homedir(), ".qstudio"));

export const DATA_DIR = path.join(APP_DIR, "data");
export const THUMB_DIR = path.join(APP_DIR, "thumbs");
export const SECRET_FILE = path.join(APP_DIR, "secret.json");
const CONFIG_FILE = path.join(APP_DIR, "config.json");

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  outputRoot: path.join(os.homedir(), "Pictures", "Q Studio"),
  demoMode: false,
  baseUrl: TOKEN_PLAN_BASE,
  profile: "token-plan",
  region: "singapore",
  referenceTransport: "auto",
  concurrencyImages: 2,
  concurrencyVideo: 1,
};

export function ensureDirs() {
  for (const dir of [APP_DIR, DATA_DIR, THUMB_DIR, DEFAULT_SETTINGS.outputRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadSettings(): Settings {
  ensureDirs();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<Settings>;
    const merged = { ...DEFAULT_SETTINGS, ...raw };
    if (!raw.baseUrl) merged.baseUrl = effectiveBaseUrl(merged);
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  ensureDirs();
  fs.mkdirSync(APP_DIR, { recursive: true });
  atomicWrite(CONFIG_FILE, JSON.stringify(settings, null, 2));
}

function atomicWrite(file: string, data: string) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, data, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

export function effectiveBaseUrl(settings: Settings): string {
  if (settings.profile === "payg") return REGIONS[settings.region] ?? REGIONS.singapore;
  return TOKEN_PLAN_BASE;
}

/* ------------------------------------------------------------------ */
/* API key storage: env > macOS Keychain > 0600 file                   */
/* ------------------------------------------------------------------ */

const KEYCHAIN_SERVICE = process.env.QSTUDIO_KEYCHAIN_SERVICE ?? "Q Studio";
const KEYCHAIN_ACCOUNT = process.env.QSTUDIO_KEYCHAIN_ACCOUNT ?? "token-plan";

function securityQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function keychainCommand(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("security", ["-i"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Keychain request timed out."));
    }, 15_000);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.on("error", () => {});
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `security exited with code ${code}`));
    });
    child.stdin.end(`${command}\n`);
  });
}

export type KeySource = "keychain" | "env" | "file" | "none";

export interface StoredKey {
  key: string;
  source: KeySource;
}

async function keychainRead(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await exec("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
    ]);
    const key = stdout.trim();
    return key || null;
  } catch {
    return null;
  }
}

async function keychainWrite(key: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await keychainCommand(
      `add-generic-password -U -s ${securityQuote(KEYCHAIN_SERVICE)} -a ${securityQuote(
        KEYCHAIN_ACCOUNT
      )} -w ${securityQuote(key)}`
    );
    return true;
  } catch {
    return false;
  }
}

async function keychainDelete(): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    await exec("security", [
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
    ]);
  } catch {
    /* not present */
  }
}

function fileRead(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SECRET_FILE, "utf8")) as { key?: string };
    return raw.key?.trim() || null;
  } catch {
    return null;
  }
}

function fileWrite(key: string) {
  ensureDirs();
  atomicWrite(SECRET_FILE, JSON.stringify({ key }));
}

export async function getStoredKey(): Promise<StoredKey | null> {
  const env = process.env.QWEN_TOKEN_PLAN_KEY ?? process.env.DASHSCOPE_API_KEY;
  if (env) return { key: env.trim(), source: "env" };
  const kc = await keychainRead();
  if (kc) return { key: kc, source: "keychain" };
  const file = fileRead();
  if (file) return { key: file, source: "file" };
  return null;
}

export async function setStoredKey(key: string, remember: boolean): Promise<KeySource> {
  if (remember) {
    const ok = await keychainWrite(key);
    if (ok) {
      fs.rmSync(SECRET_FILE, { force: true });
      return "keychain";
    }
    await keychainDelete();
  }
  fileWrite(key);
  return "file";
}

export async function clearStoredKey(): Promise<void> {
  await keychainDelete();
  fs.rmSync(SECRET_FILE, { force: true });
}

export function maskKey(key: string): string {
  if (key.length <= 10) return "••••";
  return `${key.slice(0, 7)}••••${key.slice(-4)}`;
}

export function keyKind(key: string): "token-plan" | "payg" | "unknown" {
  if (key.startsWith("sk-sp-")) return "token-plan";
  if (key.startsWith("sk-ws-") || key.startsWith("sk-")) return "payg";
  return "unknown";
}
