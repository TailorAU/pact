import { Command } from 'commander';

interface Profile {
  name?: string;
  version?: string;
  specVersion?: string;
  conformanceLevel?: 'core' | 'extended' | 'authorization-required' | string;
  resourceTypes?: Array<{ type: string; [k: string]: unknown }>;
  capabilities?: Record<string, unknown>;
  endpoints?: Record<string, string>;
  retentionPolicy?: { minimumDays?: number; indefinite?: boolean; tombstoneAfter?: number | null };
  [k: string]: unknown;
}

const LEVEL_RANK: Record<string, number> = {
  core: 0,
  extended: 1,
  'authorization-required': 2,
};

function meetsMinimum(actual: string | undefined, required: string): boolean {
  if (!actual) return false;
  const a = LEVEL_RANK[actual.toLowerCase()];
  const r = LEVEL_RANK[required.toLowerCase()];
  if (a === undefined || r === undefined) return false;
  return a >= r;
}

export function registerProfileCommand(program: Command): void {
  program
    .command('profile <serverUrl>')
    .description('Fetch and display a PACT server\'s implementation profile (§15) from /.well-known/pact.json.')
    .option('--check <level>', 'Assert minimum conformance level: core | extended | authorization-required')
    .option('--json', 'Output the profile as JSON')
    .action(async (serverUrl: string, opts: { check?: string; json?: boolean }) => {
      try {
        const base = serverUrl.replace(/\/+$/, '');
        const url = `${base}/.well-known/pact.json`;
        let res: Response;
        try {
          res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        } catch (err) {
          throw new Error(`could not fetch ${url}: ${(err as Error).message}`);
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} fetching ${url}`);
        }
        const profile = (await res.json()) as Profile;

        if (opts.json) {
          console.log(JSON.stringify(profile, null, 2));
        } else {
          const name = profile.name ?? '<unnamed>';
          const ver = profile.version ?? '<no version>';
          const spec = profile.specVersion ?? '<no specVersion>';
          const level = profile.conformanceLevel ?? '<no conformanceLevel>';
          console.log(`${name} (impl ${ver}, PACT spec ${spec}) — conformance: ${level}`);
          if (profile.resourceTypes?.length) {
            console.log('  Resource types:');
            for (const rt of profile.resourceTypes) {
              console.log(`    • ${rt.type}`);
            }
          }
          if (profile.capabilities) {
            const caps = Object.entries(profile.capabilities)
              .filter(([, v]) => v === true)
              .map(([k]) => k);
            if (caps.length) console.log(`  Capabilities: ${caps.join(', ')}`);
          }
          if (profile.retentionPolicy) {
            const rp = profile.retentionPolicy;
            const desc = rp.indefinite ? 'indefinite' : `${rp.minimumDays ?? '?'}d minimum`;
            console.log(`  Event-log retention: ${desc}`);
          }
          if (profile.endpoints) {
            for (const [k, v] of Object.entries(profile.endpoints)) {
              console.log(`  ${k}: ${v}`);
            }
          }
        }

        if (opts.check) {
          if (!meetsMinimum(profile.conformanceLevel, opts.check)) {
            console.error(`✗ profile.conformanceLevel '${profile.conformanceLevel ?? '<none>'}' does not meet minimum '${opts.check}'`);
            process.exit(1);
          }
          if (!opts.json) console.log(`✓ meets minimum conformance level '${opts.check}'`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
