/**
 * tailor-group#7 — CodeQL js/clear-text-storage-of-sensitive-data
 * (components/TopicActions.tsx:182). The Agent Console keeps the bearer key in
 * memory only and migrates keys earlier versions left in localStorage.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLegacyStoredKey,
  dismissRevealed,
  EMPTY_KEY_PANEL,
  forgetSessionKey,
  isNotJoinedError,
  LEGACY_AGENT_NAME_STORAGE_KEY,
  LEGACY_API_KEY_STORAGE_KEY,
  panelAfterDisconnect,
  rememberSessionKey,
  readLegacyStoredKey,
  restoreJoined,
  revealMigrated,
  revealOnRegister,
  sessionKey,
} from "./agent-key-session";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("legacy stored key migration", () => {
  it("reads a stored key without deleting it, so a reload before saving loses nothing", () => {
    const s = fakeStorage({
      [LEGACY_API_KEY_STORAGE_KEY]: " pact_sk_abc ",
      [LEGACY_AGENT_NAME_STORAGE_KEY]: "Bot-1",
      "pact-joined-t1": "1",
    });
    expect(readLegacyStoredKey(s)).toEqual({ apiKey: "pact_sk_abc", agentName: "Bot-1" });
    expect(readLegacyStoredKey(s)).toEqual({ apiKey: "pact_sk_abc", agentName: "Bot-1" });
    expect(s.data.get(LEGACY_API_KEY_STORAGE_KEY)).toBe(" pact_sk_abc ");
    expect(s.data.get(LEGACY_AGENT_NAME_STORAGE_KEY)).toBe("Bot-1");
  });

  it("clears both legacy entries only when asked, leaving the joined marker", () => {
    const s = fakeStorage({
      [LEGACY_API_KEY_STORAGE_KEY]: "pact_sk_abc",
      [LEGACY_AGENT_NAME_STORAGE_KEY]: "Bot-1",
      "pact-joined-t1": "1",
    });
    clearLegacyStoredKey(s);
    expect(s.data.has(LEGACY_API_KEY_STORAGE_KEY)).toBe(false);
    expect(s.data.has(LEGACY_AGENT_NAME_STORAGE_KEY)).toBe(false);
    expect(s.data.get("pact-joined-t1")).toBe("1"); // non-secret marker untouched
    expect(readLegacyStoredKey(s)).toBeNull();
  });

  it("returns null for an orphaned name with no key", () => {
    const s = fakeStorage({ [LEGACY_AGENT_NAME_STORAGE_KEY]: "Bot-1" });
    expect(readLegacyStoredKey(s)).toBeNull();
  });

  it("tolerates missing or throwing storage", () => {
    expect(readLegacyStoredKey(null)).toBeNull();
    expect(() => clearLegacyStoredKey(null)).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readLegacyStoredKey(throwing)).toBeNull();
    expect(() => clearLegacyStoredKey(throwing)).not.toThrow();
  });
});

describe("session key memory", () => {
  beforeEach(() => forgetSessionKey());

  it("remembers, replaces and forgets", () => {
    expect(sessionKey()).toBeNull();
    rememberSessionKey("pact_sk_1", "A");
    expect(sessionKey()).toEqual({ apiKey: "pact_sk_1", agentName: "A" });
    rememberSessionKey("pact_sk_2", "B");
    expect(sessionKey()).toEqual({ apiKey: "pact_sk_2", agentName: "B" });
    forgetSessionKey();
    expect(sessionKey()).toBeNull();
    rememberSessionKey("", "C");
    expect(sessionKey()).toBeNull();
  });
});

describe("TopicActions never persists the API key", () => {
  const src = readFileSync(new URL("../components/TopicActions.tsx", import.meta.url), "utf8");

  it("has no sessionStorage use and no direct localStorage writes", () => {
    expect(src).not.toMatch(/sessionStorage/);
    expect(src).not.toMatch(/localStorage\s*\.\s*setItem/);
    expect(src).not.toMatch(/["']pact-api-key["']/);
  });

  it("writes only the constant joined marker to storage", () => {
    const writes = [...src.matchAll(/\.setItem\((.*)\);$/gm)].map((m) => m[1]);
    expect(writes).toEqual(['joinedMarker(topicId), "1"']);
  });

  it("deletes the legacy stored key only on the user's confirmation", () => {
    const clears = [...src.matchAll(/clearLegacyStoredKey\(browserLocalStorage\(\)\)/g)];
    expect(clears).toHaveLength(1);
    const dismiss = src.slice(src.indexOf("const dismissRevealedKey"));
    expect(dismiss.slice(0, 400)).toMatch(/if \(next\.clearLegacy\) clearLegacyStoredKey\(browserLocalStorage\(\)\)/);
  });

  it("does not echo the key in the auto-clearing result banner", () => {
    expect(src).not.toMatch(/message:[^\n]*\$\{data\.apiKey\}/);
  });
});

describe("revealed keys: a registration never drops a migrated key (Bugbot, pact#84)", () => {
  const migrated = { apiKey: "pact_sk_old", reason: "migrated" as const };
  const registered = { apiKey: "pact_sk_new", reason: "registered" as const };

  it("registering while a migrated key is shown keeps it waiting", () => {
    expect(revealOnRegister({ shown: migrated, waiting: null }, "pact_sk_new")).toEqual({
      shown: registered,
      waiting: migrated,
    });
  });

  it("registering again keeps the migrated key that was already waiting", () => {
    expect(revealOnRegister({ shown: registered, waiting: migrated }, "pact_sk_newer")).toEqual({
      shown: { apiKey: "pact_sk_newer", reason: "registered" },
      waiting: migrated,
    });
  });

  it("dismissing the registered key brings the migrated one back without clearing storage", () => {
    expect(dismissRevealed({ shown: registered, waiting: migrated })).toEqual({
      shown: migrated,
      waiting: null,
      clearLegacy: false,
    });
  });

  it("only dismissing the migrated key clears the legacy copy", () => {
    expect(dismissRevealed({ shown: migrated, waiting: null })).toEqual({ shown: null, waiting: null, clearLegacy: true });
    expect(dismissRevealed({ shown: registered, waiting: null })).toEqual({ shown: null, waiting: null, clearLegacy: false });
  });

  it("nothing waits when no migrated key was on screen", () => {
    expect(revealOnRegister(EMPTY_KEY_PANEL, "pact_sk_new").waiting).toBeNull();
    expect(revealOnRegister({ shown: registered, waiting: null }, "pact_sk_newer").waiting).toBeNull();
  });

  it("disconnecting keeps or brings back the migrated key and nothing else", () => {
    expect(panelAfterDisconnect({ shown: migrated, waiting: null })).toEqual({ shown: migrated, waiting: null });
    expect(panelAfterDisconnect({ shown: registered, waiting: migrated })).toEqual({ shown: migrated, waiting: null });
    expect(panelAfterDisconnect({ shown: registered, waiting: null })).toEqual(EMPTY_KEY_PANEL);
  });
});

describe("moving between topics never drops a just-registered key (Bugbot, pact#84)", () => {
  const migrated = { apiKey: "pact_sk_old", reason: "migrated" as const };
  const registered = { apiKey: "pact_sk_new", reason: "registered" as const };
  const src = readFileSync(new URL("../components/TopicActions.tsx", import.meta.url), "utf8");

  it("a leftover stored key waits behind a registered key on screen", () => {
    expect(revealMigrated({ shown: registered, waiting: null }, "pact_sk_old")).toEqual({
      shown: registered,
      waiting: migrated,
    });
    expect(revealMigrated({ shown: registered, waiting: migrated }, "pact_sk_old")).toEqual({
      shown: registered,
      waiting: migrated,
    });
  });

  it("with no registered key on screen the leftover stored key is shown", () => {
    expect(revealMigrated(EMPTY_KEY_PANEL, "pact_sk_old")).toEqual({ shown: migrated, waiting: null });
    expect(revealMigrated({ shown: migrated, waiting: null }, "pact_sk_old")).toEqual({ shown: migrated, waiting: null });
  });

  it("TopicActions updates the panel as one state from the previous value", () => {
    expect(src).toMatch(/setKeyPanel\(\(prev\) => revealMigrated\(prev, legacy\.apiKey\)\)/);
    expect(src).toMatch(/setKeyPanel\(\(prev\) => revealOnRegister\(prev, data\.apiKey\)\)/);
    expect(src).not.toMatch(/setRevealedKey|setWaitingKey/);
  });
});

describe("joined marker belongs to no agent (Bugbot, pact#84)", () => {
  const src = readFileSync(new URL("../components/TopicActions.tsx", import.meta.url), "utf8");

  it("restores the joined console only while this tab still holds a key", () => {
    expect(restoreJoined(true, true)).toBe(true);
    expect(restoreJoined(false, true)).toBe(false);
    expect(restoreJoined(true, false)).toBe(false);
  });

  it("recognises only the not-a-member 403", () => {
    expect(isNotJoinedError(403, "Not registered for this topic")).toBe(true);
    expect(isNotJoinedError(403, "Forbidden")).toBe(false);
    expect(isNotJoinedError(401, "Not registered for this topic")).toBe(false);
    expect(isNotJoinedError(403, undefined)).toBe(false);
  });

  it("TopicActions clears the marker on disconnect, connect, register, 401 and the not-a-member 403", () => {
    expect([...src.matchAll(/writeJoined\(topicId, false\)/g)]).toHaveLength(5);
    // Set on every topic change, false included, so the last topic's Join
    // does not carry over.
    expect(src).toMatch(/setHasJoined\(restoreJoined\(!!current, readJoined\(topicId\)\)\)/);
  });
});
