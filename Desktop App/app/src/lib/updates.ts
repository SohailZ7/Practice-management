import type { Session } from "./api";
import { record } from "./diagnostics";

export type UpdateInfo = { version: string; notes: string };
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** A fresh token (the feed needs the signed-in user's), then ask the feed. null = up to date or not the real app. */
export async function checkForUpdate(session: Session): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const token = (await session.refresh?.(session.accessToken)) ?? session.accessToken;
  try {
    return await invoke<UpdateInfo | null>("check_update", { baseUrl: session.baseUrl, token });
  } catch (e) {
    record({ kind: "update", code: "check_failed", detail: String(e) });
    throw e;
  }
}

/** Downloads, verifies and installs, then the app relaunches itself. Only call when nothing is recording. */
export async function installUpdate(session: Session): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const token = (await session.refresh?.(session.accessToken)) ?? session.accessToken;
  try {
    await invoke("install_update", { baseUrl: session.baseUrl, token });
  } catch (e) {
    record({ kind: "update", code: "install_failed", detail: String(e) });
    throw e;
  }
}

/** Never update while a visit is recording or being sent; wait and say so. */
export const canInstallNow = (busy: boolean): boolean => !busy;
