export interface EngineInfo {
  baseUrl: string;
  token: string;
  running: boolean;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getEngineInfo(): Promise<EngineInfo | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<EngineInfo>("get_engine_info");
}

export async function engineCommand(command: "start_engine" | "stop_engine" | "restart_engine"): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(command);
}

export async function onEngineState(cb: (info: EngineInfo) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<EngineInfo>("engine-state", (event) => cb(event.payload));
  return unlisten;
}

export async function pickFolder(current?: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, defaultPath: current });
  return typeof picked === "string" ? picked : null;
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    if (isTauri()) {
      const mod = await import("@tauri-apps/plugin-notification");
      let granted = await mod.isPermissionGranted();
      if (!granted) granted = (await mod.requestPermission()) === "granted";
      if (granted) mod.sendNotification({ title, body });
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
  }
}

export async function onNativeDrop(cb: (paths: string[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop" && event.payload.paths.length) {
      cb(event.payload.paths);
    }
  });
  return unlisten;
}
