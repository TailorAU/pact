import { Command } from 'commander';
import * as api from '../api.js';

export function registerLockCommands(program: Command): void {
  program
    .command('lock <docId>')
    .description('Lock a document section')
    .requiredOption('--section <id>', 'Section ID to lock')
    .option('--ttl <seconds>', 'Lock time-to-live in seconds', parseInt)
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { section: string; ttl?: number; json?: boolean }) => {
      try {
        const result = await api.lockSection(docId, opts.section, opts.ttl);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          console.log(`Locked section ${opts.section} (expires: ${r.expiresAt}).`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('unlock <docId>')
    .description('Unlock a document section')
    .requiredOption('--section <id>', 'Section ID to unlock')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { section: string; json?: boolean }) => {
      try {
        await api.unlockSection(docId, opts.section);
        if (opts.json) {
          console.log(JSON.stringify({ status: 'unlocked', section: opts.section }));
        } else {
          console.log(`Unlocked section ${opts.section}.`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
