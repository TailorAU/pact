import { Command } from 'commander';
import * as api from '../api.js';

export function registerPollCommand(program: Command): void {
  program
    .command('poll <docId>')
    .description('Poll for new events (stateless)')
    .option('--since <cursor>', 'Event cursor to poll from')
    .option('--section <id>', 'Filter by section')
    .option('--limit <n>', 'Maximum events to return', parseInt)
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { since?: string; section?: string; limit?: number; json?: boolean }) => {
      try {
        const result = await api.poll(docId, opts.since, opts.section, opts.limit);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (!result.changes.length) {
            console.log('No new events.');
          } else {
            for (const evt of result.changes as Record<string, unknown>[]) {
              console.log(`[${evt.type}] ${evt.agent ?? ''} ${evt.section ? `(${evt.section})` : ''} — cursor: ${evt.cursor}`);
            }
          }
          console.log(`\nCursor: ${result.cursor}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
