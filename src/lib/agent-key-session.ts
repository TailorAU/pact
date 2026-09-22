/**
 * tailor-group#7 — credential lifetime for the browser Agent Console
 * (components/TopicActions.tsx). CodeQL js/clear-text-storage-of-sensitive-data
 * flagged the bearer `pact_sk_*` key being written to localStorage, where any
 * script on the origin (or anyone with the device profile) can read it
 * indefinitely.
 *
 * Design: the key lives only in React state for the life of the page. It is
 * never written to localStorage or sessionStorage. At registration the server
 * returns the plaintext once (it is hashed at rest — lib/auth.ts), so the
 * console shows it in a persistent "copy your key now" panel until the user
 * dismisses it. Keys saved by earlier versions are migrated out: read once
 * into memory, deleted from storage, and shown in the same panel so the user
 * can save the only copy they may have.
 *
 * Pure and DOM-free so it is unit-tested in the node Vitest environment.
 */

/** localStorage entries written by earlier console versions. Never written now. */
export const LEGACY_API_KEY_STORAGE_KEY = "pact-api-key";
export const LEGACY_AGENT_NAME_STORAGE_KEY = "pact-agent-name";

type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;

/**
 * Take (read and delete) a key an earlier console version left in storage.
 * Both entries are removed even when only the name is present. Storage that
 * is missing or throws (private mode, blocked site data) yields null.
 */
export function takeLegacyStoredKey(
  storage: LegacyStorage | null | undefined
): { apiKey: string; agentName: string } | null {
  if (!storage) return null;
  let apiKey = "";
  let agentName = "";
  try {
    apiKey = (storage.getItem(LEGACY_API_KEY_STORAGE_KEY) || "").trim();
    agentName = (storage.getItem(LEGACY_AGENT_NAME_STORAGE_KEY) || "").trim();
  } catch {
    // Unreadable storage: nothing to migrate, but still try to delete below.
  }
  for (const k of [LEGACY_API_KEY_STORAGE_KEY, LEGACY_AGENT_NAME_STORAGE_KEY]) {
    try {
      storage.removeItem(k);
    } catch {
      // Best effort — a storage that cannot be written cannot be leaking a new write either.
    }
  }
  return apiKey ? { apiKey, agentName } : null;
}

/** window.localStorage, or null where it is absent or its accessor throws. */
export function browserLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The key for this tab's JavaScript lifetime: module memory, so client-side
 * navigation between topic pages keeps the agent connected, while a reload,
 * a new tab or closing the tab forgets it. Written only from client event
 * handlers and effects, never during server rendering.
 */
let current: { apiKey: string; agentName: string } | null = null;

export function rememberSessionKey(apiKey: string, agentName: string): void {
  current = apiKey ? { apiKey, agentName } : null;
}

export function sessionKey(): { apiKey: string; agentName: string } | null {
  return current;
}

export function forgetSessionKey(): void {
  current = null;
}
