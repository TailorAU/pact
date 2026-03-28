import { Command } from 'commander';
import * as api from '../api.js';

export function registerAgentsCommand(program: Command): void {
  program
    .command('agents <docId>')
    .description('List active agents on a document')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { json?: boolean }) => {
      try {
        const agents = await api.listAgents(docId);
        if (opts.json) {
          console.log(JSON.stringify(agents, null, 2));
        } else {
          if (!agents.length) {
            console.log('No agents registered.');
            return;
          }
          for (const a of agents as Record<string, unknown>[]) {
            const active = a.isActive ? 'active' : 'inactive';
            console.log(`${a.agentName ?? a.agentId}  [${a.role}]  (${active})`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
