// Local session state for the v2.0.3 fabric-onboarding / session-awareness surface.
// All state lives under ~/.pact/ so the CLI and the MCP server can share the same
// canonical view of "what fabrics is this agent in right now". Schema is intentionally
// permissive — the server is the source of truth, this cache is best-effort.

import { homedir } from 'node:os';
import { join as joinPath } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';

export interface SessionEntry {
  joinedAt?: string;        // ISO 8601
  role?: string;
  lastReadEventId?: string;
  lastManifestFetch?: string; // ISO 8601 — when manifest was last cached
}

export type SessionState = Record<string, SessionEntry>;

// ── Paths ────────────────────────────────────────────────────────

export function getSessionsDir(): string {
  const dir = joinPath(homedir(), '.pact');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getLocksDir(): string {
  const dir = joinPath(getSessionsDir(), 'locks');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function sessionsFilePath(): string {
  return joinPath(getSessionsDir(), 'sessions.json');
}

function manifestCachePath(fabricId: string): string {
  // Encode forward slashes / colons to keep the filename portable across platforms.
  const safe = fabricId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return joinPath(getSessionsDir(), `manifest-${safe}.json`);
}

// ── Sessions state ───────────────────────────────────────────────

export function loadSessions(): SessionState {
  const path = sessionsFilePath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SessionState;
    }
    return {};
  } catch {
    // Corrupt file — return empty rather than crash. The caller can re-write a clean copy.
    return {};
  }
}

export function saveSessions(state: SessionState): void {
  writeFileSync(sessionsFilePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── Manifest cache ───────────────────────────────────────────────

export interface CachedManifest {
  fabricId: string;
  fetchedAt: string; // ISO 8601
  manifest: unknown;
}

export function loadManifestCache(fabricId: string): CachedManifest | null {
  const path = manifestCachePath(fabricId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as CachedManifest;
  } catch {
    return null;
  }
}

export function saveManifestCache(fabricId: string, manifest: unknown): CachedManifest {
  const entry: CachedManifest = {
    fabricId,
    fetchedAt: new Date().toISOString(),
    manifest,
  };
  writeFileSync(manifestCachePath(fabricId), JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return entry;
}

export function manifestCacheAgeMs(cached: CachedManifest | null): number | null {
  if (!cached) return null;
  const t = Date.parse(cached.fetchedAt);
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

// ── Lockfile (advisory, 5s timeout) ──────────────────────────────

export async function acquireLock<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const lockPath = joinPath(getLocksDir(), `${name.replace(/[^a-zA-Z0-9._-]/g, '_')}.lock`);
  const timeoutMs = 5000;
  const start = Date.now();

  while (true) {
    try {
      // O_EXCL via writeFileSync flag 'wx' — fails if file already exists.
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      break;
    } catch (err) {
      // Stale lock detection: if the file is older than 5× timeout, take it.
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > timeoutMs * 5) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // File disappeared between EEXIST and stat — retry the write.
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Could not acquire pact lock '${name}' within ${timeoutMs}ms (held at ${lockPath}). ` +
            `Another \`pact\` invocation is still running, or a previous one crashed — delete the lockfile if you're sure no other agent is active.`,
        );
      }
      // Brief back-off before retry.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Lock already gone — fine.
    }
  }
}

// ── Convenience: update one fabric's session entry under lock ────

export async function updateSession(
  fabricId: string,
  patch: Partial<SessionEntry>,
): Promise<SessionEntry> {
  return acquireLock('sessions', () => {
    const state = loadSessions();
    const existing = state[fabricId] ?? {};
    const next: SessionEntry = { ...existing, ...patch };
    state[fabricId] = next;
    saveSessions(state);
    return next;
  });
}
