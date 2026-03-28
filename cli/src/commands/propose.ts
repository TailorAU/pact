import { Command } from 'commander';
import * as api from '../api.js';

export function registerProposeCommand(program: Command): void {
  program
    .command('propose <docId>')
    .description('Propose an edit to a document section')
    .requiredOption('--section <id>', 'Target section ID')
    .requiredOption('--content <text>', 'New content for the section')
    .option('--summary <text>', 'Summary of the change')
    .option('--reasoning <text>', 'Detailed reasoning')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { section: string; content: string; summary?: string; reasoning?: string; json?: boolean }) => {
      try {
        const result = await api.createProposal(docId, opts.section, opts.content, opts.summary, opts.reasoning);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          console.log(`Proposal created: ${r.id ?? r.proposalId}`);
          if (r.activeConstraints && (r.activeConstraints as unknown[]).length > 0) {
            console.log(`  Warning: ${(r.activeConstraints as unknown[]).length} active constraint(s) on this section`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('proposals <docId>')
    .description('List proposals for a document')
    .option('--section <id>', 'Filter by section')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { section?: string; status?: string; json?: boolean }) => {
      try {
        const proposals = await api.listProposals(docId, opts.section, opts.status);
        if (opts.json) {
          console.log(JSON.stringify(proposals, null, 2));
        } else {
          if (!proposals.length) {
            console.log('No proposals found.');
            return;
          }
          for (const p of proposals as Record<string, unknown>[]) {
            console.log(`${p.id ?? p.proposalId}  [${p.status}]  ${p.summary ?? '(no summary)'}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
