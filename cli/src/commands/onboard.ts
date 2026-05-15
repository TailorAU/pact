import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { getBaseUrl, getAuthHeader } from '../config.js';
import { updateSession } from '../sessions.js';

interface OnboardResponse {
  fabric_id?: string;
  fabricId?: string;
  membership_status?: string;
  membershipStatus?: string;
  role?: string;
  declared_constraints?: unknown[];
  constraint_conflicts?: unknown[];
  conflicts?: unknown[];
  [k: string]: unknown;
}

export function registerOnboardCommand(program: Command): void {
  program
    .command('onboard <fabricId>')
    .description(
      'Atomically onboard into a fabric (§15.6, v2.0.3). Declares constraints up-front: ' +
        'either the agent is admitted with constraints recorded, or rejected with no membership ' +
        'created (no half-joined state).',
    )
    .option('--constraints <file>', 'Path to a JSON file containing the constraints array or constraints object to declare during onboarding.')
    .option('--verifier <did>', 'Optional verifier DID to bind the onboarding handshake to (mirrors §17 nonce binding).')
    .option('--json', 'Output the raw onboarding response as JSON.')
    .action(async (fabricId: string, opts: { constraints?: string; verifier?: string; json?: boolean }) => {
      try {
        let constraints: unknown = undefined;
        if (opts.constraints) {
          const raw = readFileSync(opts.constraints, 'utf8');
          constraints = JSON.parse(raw);
        }

        const body: Record<string, unknown> = {};
        if (constraints !== undefined) body.constraints = constraints;
        if (opts.verifier) body.verifier_id = opts.verifier;

        const baseUrl = getBaseUrl();
        const auth = getAuthHeader();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (auth) headers[auth.key] = auth.value;

        const res = await fetch(`${baseUrl}/api/pact/${encodeURIComponent(fabricId)}/_onboard`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        const text = await res.text();
        let parsed: OnboardResponse | null = null;
        try {
          parsed = text ? (JSON.parse(text) as OnboardResponse) : null;
        } catch {
          parsed = null;
        }

        if (!res.ok) {
          // Rejection path — print conflicts and exit non-zero. No membership written.
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, status: res.status, body: parsed ?? text }, null, 2));
          } else {
            console.error(`✗ onboarding rejected (HTTP ${res.status}) — no membership created.`);
            const conflicts = parsed?.constraint_conflicts ?? parsed?.conflicts;
            if (Array.isArray(conflicts) && conflicts.length > 0) {
              console.error('  Constraint conflicts:');
              for (const c of conflicts) {
                console.error(`    • ${typeof c === 'string' ? c : JSON.stringify(c)}`);
              }
            } else if (parsed && (parsed as Record<string, unknown>).detail) {
              console.error(`  ${(parsed as Record<string, unknown>).detail}`);
            } else if (text) {
              console.error(`  ${text.slice(0, 300)}`);
            }
          }
          process.exit(1);
        }

        const resolvedId = parsed?.fabric_id ?? parsed?.fabricId ?? fabricId;
        const status = parsed?.membership_status ?? parsed?.membershipStatus ?? 'onboarded';

        // Atomic-success path: persist the membership locally.
        await updateSession(resolvedId, {
          joinedAt: new Date().toISOString(),
          role: typeof parsed?.role === 'string' ? parsed.role : undefined,
        });

        if (opts.json) {
          console.log(JSON.stringify(parsed ?? { ok: true }, null, 2));
        } else {
          console.log(`✓ onboarded into fabric ${resolvedId}`);
          console.log(`  Membership status: ${status}`);
          if (parsed?.role) console.log(`  Role: ${parsed.role}`);
          if (Array.isArray(parsed?.declared_constraints)) {
            console.log(`  Declared constraints: ${parsed.declared_constraints.length}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
