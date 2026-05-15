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

export function registerJoinCommand(program: Command): void {
  program
    .command('join <docId>')
    .description('Join a resource (document, transaction, topic) as an agent')
    .requiredOption('--as <name>', 'Agent name')
    .option('--role <role>', 'Agent role (e.g. editor, reviewer)')
    .option('--token <invite>', 'Join via invite token (no account needed)')
    .option('--heartbeat', 'After joining, fire a one-shot POST /_heartbeat (v2.0.3 §4.4). Not a daemon — one ping then exit.')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { as: string; role?: string; token?: string; heartbeat?: boolean; json?: boolean }) => {
      try {
        const result = opts.token
          ? await api.joinWithToken(docId, opts.as, opts.token)
          : await api.join(docId, opts.as, opts.role);

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Joined document ${docId} as "${opts.as}"`);
          console.log(`  Registration ID: ${result.registrationId}`);
          if ('apiKey' in result && result.apiKey) {
            console.log(`  Scoped API Key:  ${result.apiKey}`);
          }
        }

        if (opts.heartbeat) {
          try {
            await fireHeartbeat(docId);
            if (!opts.json) console.log('  Heartbeat sent.');
          } catch (hbErr) {
            // Don't fail the whole command — the join already succeeded.
            console.error(`  Heartbeat failed (non-fatal): ${(hbErr as Error).message}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('leave <docId>')
    .description('Leave a document')
    .action(async (docId: string) => {
      try {
        await api.leave(docId);
        console.log(`Left document ${docId}.`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
