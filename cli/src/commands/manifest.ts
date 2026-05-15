import { Command } from 'commander';
import { getBaseUrl, getAuthHeader } from '../config.js';
import { saveManifestCache, updateSession } from '../sessions.js';

interface ManifestResponse {
  fabric_id?: string;
  fabricId?: string;
  members?: unknown[];
  obligations?: unknown[];
  pending_obligations?: unknown[];
  caller_role?: string;
  callerRole?: string;
  phase?: string;
  [k: string]: unknown;
}

export async function fetchManifest(fabricId: string): Promise<ManifestResponse> {
  const baseUrl = getBaseUrl();
  const auth = getAuthHeader();
  const headers: Record<string, string> = {};
  if (auth) headers[auth.key] = auth.value;
  const res = await fetch(`${baseUrl}/api/pact/${encodeURIComponent(fabricId)}/manifest`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} fetching manifest for ${fabricId}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as ManifestResponse;
}

export function registerManifestCommand(program: Command): void {
  program
    .command('manifest <fabricId>')
    .description(
      'Fetch the caller-scoped active-session manifest (§4.4, v2.0.3) and cache it under ~/.pact/. ' +
        'The manifest is the per-caller view of the fabric: members, current phase, obligations, ' +
        'and any data this caller is authorised to see.',
    )
    .option('--json', 'Output the raw manifest as JSON.')
    .action(async (fabricId: string, opts: { json?: boolean }) => {
      try {
        const manifest = await fetchManifest(fabricId);
        const cached = saveManifestCache(fabricId, manifest);
        await updateSession(fabricId, { lastManifestFetch: cached.fetchedAt });

        if (opts.json) {
          console.log(JSON.stringify(manifest, null, 2));
          return;
        }

        const id = manifest.fabric_id ?? manifest.fabricId ?? fabricId;
        const callerRole = manifest.caller_role ?? manifest.callerRole;
        const phase = manifest.phase ?? '?';
        const members = Array.isArray(manifest.members) ? manifest.members.length : '?';
        const obligations =
          (Array.isArray(manifest.pending_obligations) ? manifest.pending_obligations.length : null) ??
          (Array.isArray(manifest.obligations) ? manifest.obligations.length : 0);

        console.log(`Manifest for fabric ${id}`);
        if (callerRole) console.log(`  Caller role:         ${callerRole}`);
        console.log(`  Phase:               ${phase}`);
        console.log(`  Members:             ${members}`);
        console.log(`  Pending obligations: ${obligations}`);
        console.log(`  Cached at:           ${cached.fetchedAt}`);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
