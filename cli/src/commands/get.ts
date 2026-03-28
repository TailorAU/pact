import { Command } from 'commander';
import * as api from '../api.js';

export function registerGetCommand(program: Command): void {
  program
    .command('get <docId>')
    .description('Read document content as Markdown')
    .option('--json', 'Output as JSON envelope')
    .action(async (docId: string, opts: { json?: boolean }) => {
      try {
        const result = await api.getContent(docId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(result.content);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
