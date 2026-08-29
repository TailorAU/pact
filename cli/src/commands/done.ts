import { Command } from 'commander';
import * as api from '../api.js';
import { loadProof } from '../proof.js';

export function registerDoneCommand(program: Command): void {
  program
    .command('done <docId>')
    .description(
      'Signal that this agent is done. Reports a protocol state only — `aligned` means the agents converged, ' +
        'not that anything was signed, executed or legally accepted (spec §25.3, §25.8).',
    )
    .requiredOption(
      '--status <status>',
      'Completion status: aligned, blocked, or withdrawn. Protocol states only — `signed` / `executed` are not valid here (§25.8).',
    )
    .option('--summary <text>', 'Summary of what was accomplished')
    .option('--authorization-proof <file>', 'Path to JSON file with §17.6 authorization_proof envelope')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { status: string; summary?: string; authorizationProof?: string; json?: boolean }) => {
      try {
        const proof = opts.authorizationProof ? loadProof(opts.authorizationProof) : undefined;
        const result = await api.signalDone(docId, opts.status, opts.summary, proof);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Done signal sent for document ${docId} (status: ${opts.status}).`);
          console.log('Protocol state only — not a signature, execution, or legal acceptance (spec §25.3).');
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
