import { Command } from 'commander';
import * as api from '../api.js';

export function registerDoneCommand(program: Command): void {
  program
    .command('done <docId>')
    .description('Signal that this agent is done')
    .requiredOption('--status <status>', 'Completion status (e.g. aligned, blocked, withdrawn)')
    .option('--summary <text>', 'Summary of what was accomplished')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { status: string; summary?: string; json?: boolean }) => {
      try {
        const result = await api.signalDone(docId, opts.status, opts.summary);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Done signal sent for document ${docId} (status: ${opts.status}).`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
