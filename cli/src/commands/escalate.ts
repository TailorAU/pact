import { Command } from 'commander';
import * as api from '../api.js';

export function registerEscalateCommands(program: Command): void {
  program
    .command('escalate <docId>')
    .description('Escalate an issue to human reviewers')
    .requiredOption('--reason <text>', 'Reason for escalation')
    .option('--section <id>', 'Relevant section ID')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { reason: string; section?: string; json?: boolean }) => {
      try {
        await api.escalate(docId, opts.reason, opts.section);
        if (opts.json) {
          console.log(JSON.stringify({ status: 'escalated', docId }));
        } else {
          console.log(`Escalation created for document ${docId}.`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('ask <docId>')
    .description('Ask a human a question')
    .requiredOption('--question <text>', 'Question to ask')
    .option('--section <id>', 'Relevant section ID')
    .option('--context <text>', 'Additional context')
    .option('--timeout <seconds>', 'Response timeout in seconds', parseInt)
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { question: string; section?: string; context?: string; timeout?: number; json?: boolean }) => {
      try {
        const result = await api.askHuman(docId, opts.question, opts.section, opts.context, opts.timeout);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          console.log(`Question submitted: ${r.queryId}`);
          console.log(`  Timeout: ${r.timeoutAt}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
