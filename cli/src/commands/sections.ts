import { Command } from 'commander';
import * as api from '../api.js';

interface Section {
  sectionId?: string;
  id?: string;
  heading?: string;
  title?: string;
  level?: number;
  children?: Section[];
  lockedBy?: string | null;
}

function printTree(sections: Section[], indent = 0): void {
  for (const s of sections) {
    const id = s.sectionId ?? s.id ?? '';
    const title = s.heading ?? s.title ?? '';
    const lock = s.lockedBy ? ` [locked by ${s.lockedBy}]` : '';
    const prefix = '  '.repeat(indent);
    console.log(`${prefix}${id}  ${title}${lock}`);
    if (s.children?.length) printTree(s.children, indent + 1);
  }
}

export function registerSectionsCommand(program: Command): void {
  program
    .command('sections <docId>')
    .description('Show document section tree')
    .option('--json', 'Output as JSON')
    .action(async (docId: string, opts: { json?: boolean }) => {
      try {
        const sections = await api.getSections(docId) as Section[];
        if (opts.json) {
          console.log(JSON.stringify(sections, null, 2));
        } else {
          printTree(sections);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
