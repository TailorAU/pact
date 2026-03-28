import { Command } from 'commander';
import * as api from '../api.js';

export function registerIcsCommands(program: Command): void {
  program
    .command('intent <docId>')
    .description('Declare intent for a section')
    .requiredOption('--section <id>', 'Target section ID')
    .requiredOption('--goal <text>', 'What you plan to do')
    .option('--category <cat>', 'Intent category')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { section: string; goal: string; category?: string; json?: boolean }) => {
      try {
        const result = await api.declareIntent(docId, opts.section, opts.goal, opts.category);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          console.log(`Intent declared: ${r.id ?? r.intentId}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('constrain <docId>')
    .description('Publish a constraint on a section')
    .requiredOption('--section <id>', 'Target section ID')
    .requiredOption('--boundary <text>', 'What must or must not happen')
    .option('--category <cat>', 'Constraint category')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { section: string; boundary: string; category?: string; json?: boolean }) => {
      try {
        const result = await api.publishConstraint(docId, opts.section, opts.boundary, opts.category);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          console.log(`Constraint published: ${r.id ?? r.constraintId}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('salience <docId>')
    .description('Set salience score for a section')
    .requiredOption('--section <id>', 'Target section ID')
    .requiredOption('--score <n>', 'Salience score (0-10)', parseFloat)
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { section: string; score: number; json?: boolean }) => {
      try {
        await api.setSalience(docId, opts.section, opts.score);
        if (opts.json) {
          console.log(JSON.stringify({ section: opts.section, score: opts.score }));
        } else {
          console.log(`Salience set: section ${opts.section} → ${opts.score}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
