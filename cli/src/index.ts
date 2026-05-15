import { Command } from 'commander';
import { setAgentOverride } from './config.js';
import { registerConfigCommand } from './commands/config.js';
import { registerJoinCommand } from './commands/join.js';
import { registerAgentsCommand } from './commands/agents.js';
import { registerIcsCommands } from './commands/intent.js';
import { registerObjectCommand } from './commands/object.js';
import { registerPollCommand } from './commands/poll.js';
import { registerDoneCommand } from './commands/done.js';
import { registerEscalateCommands } from './commands/escalate.js';
import { registerLockCommands } from './commands/lock.js';
import { registerNegotiateCommands } from './commands/negotiate.js';
import { registerVerifyProofCommand } from './commands/verify-proof.js';
import { registerProfileCommand } from './commands/profile.js';
import { registerTierIntrospectCommand } from './commands/tier-introspect.js';

const program = new Command();

program
  .name('pact')
  .description('PACT v2.0 — Protocol for Agent Consensus and Truth. Coordination and consensus primitives for multi-agent collaboration on any resource type.')
  .version('2.0.2')
  .option('--agent <key>', 'Override the API key for this invocation (simulate a specific agent)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts<{ agent?: string }>();
    if (opts.agent) setAgentOverride(opts.agent);
  });

registerConfigCommand(program);
registerJoinCommand(program);
registerAgentsCommand(program);
registerIcsCommands(program);
registerObjectCommand(program);
registerPollCommand(program);
registerDoneCommand(program);
registerEscalateCommands(program);
registerLockCommands(program);
registerNegotiateCommands(program);
registerVerifyProofCommand(program);
registerProfileCommand(program);
registerTierIntrospectCommand(program);

program.parse();
