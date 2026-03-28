import { Command } from 'commander';
import * as api from '../api.js';

export function registerVoteCommands(program: Command): void {
  program
    .command('approve <proposalId>')
    .description('Approve a proposal')
    .requiredOption('--doc <docId>', 'Document ID')
    .option('--json', 'Output as JSON')
    .action(async (proposalId: string, opts: { doc: string; json?: boolean }) => {
      try {
        await api.approveProposal(opts.doc, proposalId);
        if (opts.json) {
          console.log(JSON.stringify({ status: 'approved', proposalId }));
        } else {
          console.log(`Approved proposal ${proposalId}.`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('reject <proposalId>')
    .description('Reject a proposal')
    .requiredOption('--doc <docId>', 'Document ID')
    .option('--reason <text>', 'Reason for rejection')
    .option('--json', 'Output as JSON')
    .action(async (proposalId: string, opts: { doc: string; reason?: string; json?: boolean }) => {
      try {
        await api.rejectProposal(opts.doc, proposalId, opts.reason);
        if (opts.json) {
          console.log(JSON.stringify({ status: 'rejected', proposalId }));
        } else {
          console.log(`Rejected proposal ${proposalId}.`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('object <proposalId>')
    .description('Object to a proposal')
    .requiredOption('--doc <docId>', 'Document ID')
    .requiredOption('--reason <text>', 'Reason for objection')
    .option('--json', 'Output as JSON')
    .action(async (proposalId: string, opts: { doc: string; reason: string; json?: boolean }) => {
      try {
        await api.objectToProposal(opts.doc, proposalId, opts.reason);
        if (opts.json) {
          console.log(JSON.stringify({ status: 'objected', proposalId }));
        } else {
          console.log(`Objection raised against proposal ${proposalId}.`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
