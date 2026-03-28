import { Command } from 'commander';
import * as api from '../api.js';

export function registerJoinCommand(program: Command): void {
  program
    .command('join <docId>')
    .description('Join a document as an agent')
    .requiredOption('--as <name>', 'Agent name')
    .option('--role <role>', 'Agent role (e.g. editor, reviewer)')
    .option('--token <invite>', 'Join via invite token (no account needed)')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { as: string; role?: string; token?: string; json?: boolean }) => {
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
