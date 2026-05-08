import { Command } from 'commander';
import * as api from '../api.js';

export function registerNegotiateCommands(program: Command): void {
  const negotiate = program
    .command('negotiate')
    .description('Structured negotiation primitives (Extended conformance — see spec §13.5.3)');

  negotiate
    .command('list <docId>')
    .description('List active negotiations on a resource')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { json?: boolean }) => {
      try {
        const result = await api.listNegotiations(docId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const items = Array.isArray(result) ? result : [];
          if (items.length === 0) {
            console.log('No active negotiations.');
            return;
          }
          for (const n of items) {
            const r = n as Record<string, unknown>;
            console.log(`${r.id ?? r.negotiationId} — section ${r.sectionId ?? '?'} — round ${r.round ?? '?'}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  negotiate
    .command('position <negotiationId>')
    .description('Submit your position for the current round')
    .requiredOption('--doc <docId>', 'Document / resource ID')
    .requiredOption('--content <text>', 'Your position for this round')
    .option('--json', 'Output as JSON')
    .action(async (negotiationId: string, opts: { doc: string; content: string; json?: boolean }) => {
      try {
        const result = await api.submitNegotiationPosition(opts.doc, negotiationId, opts.content);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = (result ?? {}) as Record<string, unknown>;
          console.log(`Position submitted for negotiation ${negotiationId}${r.round ? ` (round ${r.round})` : ''}.`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  negotiate
    .command('synthesis <negotiationId>')
    .description("Fetch the Mediator's synthesis for the current round")
    .requiredOption('--doc <docId>', 'Document / resource ID')
    .option('--json', 'Output as JSON')
    .action(async (negotiationId: string, opts: { doc: string; json?: boolean }) => {
      try {
        const result = await api.getNegotiationSynthesis(opts.doc, negotiationId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = (result ?? {}) as Record<string, unknown>;
          if (r.summary) console.log(r.summary);
          else console.log(JSON.stringify(result, null, 2));
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
