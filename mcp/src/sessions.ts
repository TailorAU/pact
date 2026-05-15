// Local session state for the v2.0.3 fabric-onboarding / session-awareness surface.
// Mirror of cli/src/sessions.ts — duplicated rather than imported because each package
// has its own rootDir/tsconfig and is published independently. Keep these two files
// byte-equivalent when changing either side.

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
    return {};
  }
}

export function saveSessions(state: SessionState): void {
  writeFileSync(sessionsFilePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── Manifest cache ───────────────────────────────────────────────

export interface CachedManifest {
  fabricId: string;
  fetchedAt: string;
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
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      break;
    } catch (err) {
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > timeoutMs * 5) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Could not acquire pact lock '${name}' within ${timeoutMs}ms (held at ${lockPath}). ` +
            `Another PACT process is still running, or a previous one crashed — delete the lockfile if you're sure no other agent is active.`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

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
