import { Command } from 'commander';
import { setAgentOverride, setPrincipalOverride } from './config.js';
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
import { registerOnboardCommand } from './commands/onboard.js';
import { registerStatusCommand } from './commands/status.js';
import { registerManifestCommand } from './commands/manifest.js';
import { registerWhereCommand } from './commands/where.js';
import { registerTranscriptCommand } from './commands/transcript.js';
import { registerMatterCommands } from './commands/matter.js';

const program = new Command();

program
  .name('pact')
  .description('PACT — Like Signal, but for multi-agent and human consensus. Collapses gate reviews from weeks to days. Open, MIT-licensed protocol for multi-agent collaboration on any resource type (documents, transactions, knowledge, deal rooms, and beyond).')
  .version('2.0.3')
  .option('--agent <key>', 'Override the API key for this invocation (simulate a specific agent)')
  .option('--as <did>', 'Act as a specific principal DID (dev/test: asserts X-Pact-Principal; honoured by the reference server, ignored by production servers that map principal from the credential)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts<{ agent?: string; as?: string }>();
    if (opts.agent) setAgentOverride(opts.agent);
    if (opts.as) setPrincipalOverride(opts.as);
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
registerOnboardCommand(program);
registerStatusCommand(program);
registerManifestCommand(program);
registerWhereCommand(program);
registerTranscriptCommand(program);
registerMatterCommands(program);

program.parse();
