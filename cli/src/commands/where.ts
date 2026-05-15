import { Command } from 'commander';
import {
  loadSessions,
  loadManifestCache,
  saveManifestCache,
  manifestCacheAgeMs,
  updateSession,
  type CachedManifest,
} from '../sessions.js';
import { fetchManifest } from './manifest.js';

interface ObligationLike {
  agent_id?: string;
  agentId?: string;
  assigned_to?: string;
  assignedTo?: string;
  recipient?: string;
  description?: string;
  summary?: string;
  due_by?: string;
  dueBy?: string;
  [k: string]: unknown;
}

function pendingForCaller(manifest: unknown): ObligationLike[] {
  if (!manifest || typeof manifest !== 'object') return [];
  const m = manifest as Record<string, unknown>;
  // The server scopes the manifest to the caller, so pending_obligations is already filtered.
  const list = (m.pending_obligations ?? m.pendingObligations ?? m.obligations) as unknown;
  if (!Array.isArray(list)) return [];
  return list as ObligationLike[];
}

const CACHE_FRESH_MS = 60_000;

export function registerWhereCommand(program: Command): void {
  program
    .command('where')
    .description(
      'Print all active fabrics this agent is in, with role and any obligations pending against ' +
        'this caller (§4.4 / §6.5, v2.0.3). Offline-capable: uses ~/.pact/manifest-<id>.json cache ' +
        "if it's fresher than 60s. Pass --refresh to force a network fetch.",
    )
    .option('--refresh', 'Force a network fetch for every fabric instead of using the local manifest cache.')
    .option('--json', 'Output as JSON.')
    .action(async (opts: { refresh?: boolean; json?: boolean }) => {
      try {
        const sessions = loadSessions();
        const ids = Object.keys(sessions);
        const rows: Array<{
          fabricId: string;
          role?: string;
          phase?: string;
          obligations: ObligationLike[];
          source: 'cache' | 'fresh' | 'unknown';
          cacheAgeMs?: number;
        }> = [];

        for (const id of ids) {
          let cached: CachedManifest | null = loadManifestCache(id);
          let source: 'cache' | 'fresh' | 'unknown' = 'unknown';

          const age = manifestCacheAgeMs(cached);
          const stale = age === null || age > CACHE_FRESH_MS;

          if (opts.refresh || stale) {
            try {
              const manifest = await fetchManifest(id);
              cached = saveManifestCache(id, manifest);
              await updateSession(id, { lastManifestFetch: cached.fetchedAt });
              source = 'fresh';
            } catch {
              // Network failed — fall back to whatever cache we have.
              source = cached ? 'cache' : 'unknown';
            }
          } else if (cached) {
            source = 'cache';
          }

          const m = (cached?.manifest ?? {}) as Record<string, unknown>;
          const phase = typeof m.phase === 'string' ? m.phase : undefined;
          const role =
            sessions[id].role ??
            (typeof m.caller_role === 'string' ? (m.caller_role as string) : undefined) ??
            (typeof m.callerRole === 'string' ? (m.callerRole as string) : undefined);

          rows.push({
            fabricId: id,
            role,
            phase,
            obligations: pendingForCaller(cached?.manifest),
            source,
            cacheAgeMs: manifestCacheAgeMs(cached) ?? undefined,
          });
        }

        if (opts.json) {
          console.log(JSON.stringify({ fabrics: rows }, null, 2));
          return;
        }

        if (rows.length === 0) {
          console.log('Not currently in any fabrics. Run `pact onboard <fabric-id>` to join one.');
          return;
        }

        for (const row of rows) {
          const ageLabel =
            row.cacheAgeMs !== undefined
              ? ` (${Math.round(row.cacheAgeMs / 1000)}s old, ${row.source})`
              : ` (${row.source})`;
          console.log(`• ${row.fabricId}${ageLabel}`);
          console.log(`    role:     ${row.role ?? '-'}`);
          console.log(`    phase:    ${row.phase ?? '-'}`);
          if (row.obligations.length === 0) {
            console.log(`    pending:  (none)`);
          } else {
            console.log(`    pending:  ${row.obligations.length} obligation(s)`);
            for (const ob of row.obligations) {
              const desc = ob.description ?? ob.summary ?? JSON.stringify(ob);
              const due = ob.due_by ?? ob.dueBy;
              console.log(`      - ${desc}${due ? ` (due ${due})` : ''}`);
            }
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
