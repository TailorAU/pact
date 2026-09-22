/**
 * tailor-group#7 — CodeQL js/clear-text-storage-of-sensitive-data
 * (components/TopicActions.tsx:182). The Agent Console keeps the bearer key in
 * memory only and migrates keys earlier versions left in localStorage.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLegacyStoredKey,
  forgetSessionKey,
  LEGACY_AGENT_NAME_STORAGE_KEY,
  LEGACY_API_KEY_STORAGE_KEY,
  rememberSessionKey,
  readLegacyStoredKey,
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
    expect(dismiss.slice(0, 400)).toMatch(
      /if \(revealedKey\?\.reason === "migrated"\) clearLegacyStoredKey\(browserLocalStorage\(\)\)/
    );
  });

  it("does not echo the key in the auto-clearing result banner", () => {
    expect(src).not.toMatch(/message:[^\n]*\$\{data\.apiKey\}/);
  });
});
