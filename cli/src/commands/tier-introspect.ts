import { Command } from 'commander';

interface CheckResult {
  check: string;
  outcome: 'pass' | 'fail' | 'not_implemented' | 'unsupported';
  evidence?: string;
}

interface TierProbeReport {
  probe_id: string;
  server_advertised_tier: string;
  report_generated_at: string;
  report_signature: string;
  signing_key: string;
  check_results: CheckResult[];
}

const DEFAULT_CHECKS = [
  'tombstoned_principal_rejected',
  'revoked_credential_rejected',
  'did_web_ct_check',
  'alg_whitelist_enforced',
  'verifier_id_equality_enforced',
];

function randomProbeId(): string {
  // 16 base32-ish chars from crypto random (no need to be cryptographically perfect — server echoes it back)
  const bytes = new Uint8Array(10);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'probe-' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function registerTierIntrospectCommand(program: Command): void {
  program
    .command('tier-introspect <serverUrl>')
    .description('Behaviourally probe a PACT server\'s advertised conformance tier (§15.5). Sends a request to /api/pact/_probe/tier and reports which of the tier\'s required checks the server actually enforces. Use this BEFORE extending cross-org trust to a counterparty.')
    .option('--tier <level>', 'Tier to probe (core | extended | authorization-required). Defaults to the server\'s self-advertised tier (fetched from /.well-known/pact.json).')
    .option('--checks <list>', 'Comma-separated list of check IDs. Defaults to the v2.0.2 well-known set: ' + DEFAULT_CHECKS.join(', '), (v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .option('--require-pass', 'Exit non-zero if any check returned outcome != pass (i.e. enforce that the probe is fully green).')
    .option('--json', 'Output the raw tier_probe_report as JSON.')
    .action(async (serverUrl: string, opts: { tier?: string; checks?: string[]; requirePass?: boolean; json?: boolean }) => {
      try {
        const base = serverUrl.replace(/\/+$/, '');

        // Discover the advertised tier from /.well-known/pact.json if --tier was not supplied.
        let advertisedTier = opts.tier;
        if (!advertisedTier) {
          const profUrl = `${base}/.well-known/pact.json`;
          const profRes = await fetch(profUrl, { signal: AbortSignal.timeout(15_000) });
          if (!profRes.ok) throw new Error(`HTTP ${profRes.status} fetching ${profUrl} to discover advertised tier`);
          const profile = await profRes.json() as { conformanceLevel?: string };
          if (typeof profile.conformanceLevel !== 'string') throw new Error('profile missing conformanceLevel — pass --tier explicitly');
          advertisedTier = profile.conformanceLevel;
        }

        const checks = opts.checks ?? DEFAULT_CHECKS;
        const probeId = randomProbeId();
        const probeUrl = `${base}/api/pact/_probe/tier`;
        const probeRes = await fetch(probeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ probe_id: probeId, advertised_tier: advertisedTier, checks }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!probeRes.ok) {
          throw new Error(`HTTP ${probeRes.status} from ${probeUrl} — server does not expose the v2.0.2 tier probe (or has it gated). Per §15.5, Authorization-Required tier implementations MUST expose this surface.`);
        }
        const report = await probeRes.json() as TierProbeReport;

        if (report.probe_id !== probeId) {
          throw new Error(`probe_id round-trip mismatch: sent ${probeId}, got ${report.probe_id}. The server SHOULD echo the caller's probe_id verbatim.`);
        }

        if (opts.json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(`Tier probe @ ${base}`);
          console.log(`  Advertised tier: ${report.server_advertised_tier}`);
          console.log(`  Report signed by: ${report.signing_key}`);
          console.log(`  Generated at: ${report.report_generated_at}`);
          console.log('  Checks:');
          for (const cr of report.check_results) {
            const tag = cr.outcome === 'pass' ? '✓'
              : cr.outcome === 'fail' ? '✗'
              : cr.outcome === 'not_implemented' ? '·'
              : '?';
            const detail = cr.evidence ? ` — ${cr.evidence}` : '';
            console.log(`    ${tag} ${cr.check} [${cr.outcome}]${detail}`);
          }
        }

        if (opts.requirePass) {
          const nonPass = report.check_results.filter((c) => c.outcome !== 'pass');
          if (nonPass.length > 0) {
            console.error(`\n--require-pass: ${nonPass.length} of ${report.check_results.length} checks did not return 'pass'.`);
            process.exit(1);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
