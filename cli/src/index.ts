import { Command } from 'commander';
import { registerConfigCommand } from './commands/config.js';
import { registerJoinCommand } from './commands/join.js';
import { registerGetCommand } from './commands/get.js';
import { registerSectionsCommand } from './commands/sections.js';
import { registerProposeCommand } from './commands/propose.js';
import { registerVoteCommands } from './commands/vote.js';
import { registerAgentsCommand } from './commands/agents.js';
import { registerIcsCommands } from './commands/intent.js';
import { registerPollCommand } from './commands/poll.js';
import { registerDoneCommand } from './commands/done.js';
import { registerEscalateCommands } from './commands/escalate.js';
import { registerLockCommands } from './commands/lock.js';

const program = new Command();

program
  .name('pact')
  .description('CLI for the PACT protocol — multi-agent document collaboration')
  .version('0.1.0');

registerConfigCommand(program);
registerJoinCommand(program);
registerGetCommand(program);
registerSectionsCommand(program);
registerProposeCommand(program);
registerVoteCommands(program);
registerAgentsCommand(program);
registerIcsCommands(program);
registerPollCommand(program);
registerDoneCommand(program);
registerEscalateCommands(program);
registerLockCommands(program);

program.parse();
