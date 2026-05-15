import { Command } from 'commander';
import { getBaseUrl, getAuthHeader } from '../config.js';
import { loadSessions } from '../sessions.js';

interface StatusResponse {
  fabric_id?: string;
  fabricId?: string;
  phase?: string;
  members?: unknown[];
  latest_event_id?: string;
  latestEventId?: string;
  pending_obligations?: unknown[];
  pendingObligations?: unknown[];
  [k: string]: unknown;
}

async function fetchStatus(fabricId: string): Promise<StatusResponse> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();
  const headers: Record<string, string> = {};
  if (auth) headers[auth.key] = auth.value;
  const res = await fetch(`${baseUrl}/api/pact/${encodeURIComponent(fabricId)}/_status`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} fetching status for ${fabricId}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as StatusResponse;
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status [fabricId]')
    .description(
      'Snapshot the state of one fabric or all known fabrics (§4.4, v2.0.3). With a fabricId, ' +
        'calls GET /api/pact/{fabricId}/_status. With --all or no id, prints a one-row-per-fabric summary ' +
        'from local session state (~/.pact/sessions.json).',
    )
    .option('--all', 'Show all locally-known fabrics from ~/.pact/sessions.json (default when no fabricId is given).')
    .option('--json', 'Output as JSON.')
    .action(async (fabricId: string | undefined, opts: { all?: boolean; json?: boolean }) => {
      try {
        if (fabricId && !opts.all) {
          const status = await fetchStatus(fabricId);
          if (opts.json) {
            console.log(JSON.stringify(status, null, 2));
            return;
          }
          const id = status.fabric_id ?? status.fabricId ?? fabricId;
          const phase = status.phase ?? '?';
          const members = Array.isArray(status.members) ? status.members.length : '?';
          const latest = status.latest_event_id ?? status.latestEventId ?? '?';
          const pending = Array.isArray(status.pending_obligations)
            ? status.pending_obligations.length
            : Array.isArray(status.pendingObligations)
              ? status.pendingObligations.length
              : 0;
          console.log(`Fabric ${id}`);
          console.log(`  Phase:               ${phase}`);
          console.log(`  Members:             ${members}`);
          console.log(`  Latest event id:     ${latest}`);
          console.log(`  Pending obligations: ${pending}`);
          return;
        }

        // --all / no-id path: local state summary, no network.
        const sessions = loadSessions();
        const ids = Object.keys(sessions);
        if (opts.json) {
          console.log(JSON.stringify(sessions, null, 2));
          return;
        }
        if (ids.length === 0) {
          console.log('No fabrics in local state (~/.pact/sessions.json). Run `pact onboard <fabric-id>` to join one.');
          return;
        }
        const idCol = Math.max(9, ...ids.map((i) => i.length));
        console.log(`${'fabric-id'.padEnd(idCol)}  role            joined-at                 last-event`);
        for (const id of ids) {
          const e = sessions[id];
          const role = (e.role ?? '-').padEnd(15);
          const joined = (e.joinedAt ?? '-').padEnd(25);
          const last = e.lastReadEventId ?? '-';
          console.log(`${id.padEnd(idCol)}  ${role} ${joined} ${last}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
