import { Command } from 'commander';
import * as api from '../api.js';
import { getBaseUrl, getAuthHeader } from '../config.js';

async function fireHeartbeat(fabricId: string): Promise<void> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers[auth.key] = auth.value;
  const res = await fetch(`${baseUrl}/api/pact/${encodeURIComponent(fabricId)}/_heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: 'cli', oneShot: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} from _heartbeat: ${text.slice(0, 200)}`);
  }
}

export function registerNegotiateCommands(program: Command): void {
  const negotiate = program
    .command('negotiate')
    .description('Structured negotiation primitives (Extended conformance — see spec §13.5.3)');

  negotiate
    .command('list <docId>')
    .description('List active negotiations on a resource')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { json?: boolean }) => {
      try {
        const result = await api.listNegotiations(docId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const items = Array.isArray(result) ? result : [];
          if (items.length === 0) {
            console.log('No active negotiations.');
            return;
          }
          for (const n of items) {
            const r = n as Record<string, unknown>;
            console.log(`${r.id ?? r.negotiationId} — section ${r.sectionId ?? '?'} — round ${r.round ?? '?'}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  negotiate
    .command('position <negotiationId>')
    .description('Submit your position for the current round')
    .requiredOption('--doc <docId>', 'Document / resource ID')
    .requiredOption('--content <text>', 'Your position for this round')
    .option('--heartbeat', 'After submitting, fire a one-shot POST /_heartbeat (v2.0.3 §4.4). Not a daemon — one ping then exit.')
    .option('--json', 'Output as JSON')
    .action(async (negotiationId: string, opts: { doc: string; content: string; heartbeat?: boolean; json?: boolean }) => {
      try {
        const result = await api.submitNegotiationPosition(opts.doc, negotiationId, opts.content);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = (result ?? {}) as Record<string, unknown>;
          console.log(`Position submitted for negotiation ${negotiationId}${r.round ? ` (round ${r.round})` : ''}.`);
        }
        if (opts.heartbeat) {
          try {
            await fireHeartbeat(opts.doc);
            if (!opts.json) console.log('  Heartbeat sent.');
          } catch (hbErr) {
            console.error(`  Heartbeat failed (non-fatal): ${(hbErr as Error).message}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  negotiate
    .command('synthesis <negotiationId>')
    .description("Fetch the Mediator's synthesis for the current round")
    .requiredOption('--doc <docId>', 'Document / resource ID')
    .option('--json', 'Output as JSON')
    .action(async (negotiationId: string, opts: { doc: string; json?: boolean }) => {
      try {
        const result = await api.getNegotiationSynthesis(opts.doc, negotiationId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = (result ?? {}) as Record<string, unknown>;
          if (r.summary) console.log(r.summary);
          else console.log(JSON.stringify(result, null, 2));
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
