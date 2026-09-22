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
 * dismisses it. Keys saved by earlier versions are migrated out: read into
 * memory and shown in the same panel so the user can save the only copy they
 * may have; the stored entry is deleted only when the user confirms they have
 * saved it, so a reload or navigation before then does not lose the key.
 *
 * Pure and DOM-free so it is unit-tested in the node Vitest environment.
 */

/** localStorage entries written by earlier console versions. Never written now. */
export const LEGACY_API_KEY_STORAGE_KEY = "pact-api-key";
export const LEGACY_AGENT_NAME_STORAGE_KEY = "pact-agent-name";

type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;

/**
 * Read (without deleting) a key an earlier console version left in storage.
 * The entry is deliberately kept until the user confirms they have saved the
 * key (clearLegacyStoredKey): PACT stores only a hash, so this may be the only
 * copy and deleting it on sight would lose the credential if the user reloads
 * or navigates away before copying it. Storage that is missing or throws
 * (private mode, blocked site data) yields null.
 */
export function readLegacyStoredKey(
  storage: LegacyStorage | null | undefined
): { apiKey: string; agentName: string } | null {
  if (!storage) return null;
  try {
    const apiKey = (storage.getItem(LEGACY_API_KEY_STORAGE_KEY) || "").trim();
    const agentName = (storage.getItem(LEGACY_AGENT_NAME_STORAGE_KEY) || "").trim();
    return apiKey ? { apiKey, agentName } : null;
  } catch {
    return null;
  }
}

/**
 * Delete both legacy entries. Called only once the user has confirmed they
 * saved the migrated key (or when there is no key, only an orphaned name).
 * Best effort: a storage that cannot be written cannot be leaking a new write.
 */
export function clearLegacyStoredKey(storage: LegacyStorage | null | undefined): void {
  if (!storage) return;
  for (const k of [LEGACY_API_KEY_STORAGE_KEY, LEGACY_AGENT_NAME_STORAGE_KEY]) {
    try {
      storage.removeItem(k);
    } catch {
      // Blocked storage: nothing more to do.
    }
  }
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

/** A key shown once for the user to copy, with why it is being shown. */
export type RevealedKey = { apiKey: string; reason: "registered" | "migrated" } | null;

/**
 * The copy panel: the key on screen, and a migrated key waiting behind a
 * registered one. One state, so every transition sees both halves.
 */
export type KeyPanel = { shown: RevealedKey; waiting: RevealedKey };

export const EMPTY_KEY_PANEL: KeyPanel = { shown: null, waiting: null };

/**
 * A key an earlier version left in localStorage, found on mount or on moving
 * to another topic. A just-registered key has no reissue path, so it stays on
 * screen and the migrated key waits behind it; otherwise the migrated key is
 * shown until the user confirms saving it.
 */
export function revealMigrated(panel: KeyPanel, legacyApiKey: string): KeyPanel {
  const migrated: RevealedKey = { apiKey: legacyApiKey, reason: "migrated" };
  if (panel.shown?.reason === "registered") return { shown: panel.shown, waiting: migrated };
  return { shown: migrated, waiting: null };
}

/**
 * Registering while a migrated legacy key is still on screen must not drop
 * it: the stored legacy copy is deleted only when the user confirms saving it
 * (dismissRevealed). The new key is shown first; the migrated one waits and
 * comes back when the new one is dismissed.
 */
export function revealOnRegister(panel: KeyPanel, registeredKey: string): KeyPanel {
  return {
    shown: { apiKey: registeredKey, reason: "registered" },
    waiting: panel.shown?.reason === "migrated" ? panel.shown : panel.waiting,
  };
}

/**
 * Dismissing the shown key. Only dismissing the migrated key deletes the
 * legacy stored copy; dismissing a registered key brings back a migrated key
 * that was waiting, so it is still confirmed (and cleared) in turn.
 */
export function dismissRevealed(panel: KeyPanel): KeyPanel & { clearLegacy: boolean } {
  if (panel.shown?.reason === "migrated") return { ...EMPTY_KEY_PANEL, clearLegacy: true };
  return { shown: panel.waiting, waiting: null, clearLegacy: false };
}

/**
 * Disconnecting. A migrated key stays on screen (or comes back, if a
 * registration had superseded it) until the user confirms they saved it.
 */
export function panelAfterDisconnect(panel: KeyPanel): KeyPanel {
  return { shown: panel.shown?.reason === "migrated" ? panel.shown : panel.waiting, waiting: null };
}

/**
 * The per-topic joined marker is not tied to an agent, so it may restore the
 * joined console only while this tab still holds a key. After a reload the
 * key is gone; whoever connects next must Join (joining is idempotent).
 */
export function restoreJoined(hasSessionKey: boolean, markerSet: boolean): boolean {
  return hasSessionKey && markerSet;
}

/** A 403 meaning the agent is not a member of the topic: Join must come back. */
export function isNotJoinedError(status: number, message: string | undefined): boolean {
  return status === 403 && /not registered for this topic/i.test(message ?? "");
}
