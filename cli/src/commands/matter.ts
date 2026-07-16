/**
 * `pact matter *` — CLI surface for the v2.2-draft Matter primitive.
 *
 * A Matter is a multi-fabric "deal-room" container. See the RFC:
 *   docs/v2-prep/rfc-matters-multi-fabric.md
 *
 * These commands are gated on the v2.2 draft normative text landing in
 * spec/v2.2/SPECIFICATION.md and the schemas formally promoting from
 * docs/v2-prep/matters-schemas/ to spec/v2.2/schemas/. They work today
 * against the reference server's draft implementation.
 */

import { Command } from 'commander';
import * as api from '../api.js';

export function registerMatterCommands(program: Command): void {
  const matter = program
    .command('matter')
    .description(
      'Multi-fabric deal-room workspaces (v2.2 draft — see docs/v2-prep/rfc-matters-multi-fabric.md)',
    );

  // pact matter open --name "Project Atlas" [--display-name "Knox"] [--json]
  matter
    .command('open')
    .description('Open a new Matter (caller becomes owner)')
    .requiredOption('--name <name>', 'Human-readable Matter name')
    .option('--display-name <display>', "Caller's display name in the Matter")
    .option('--json', 'Output as JSON')
    .action(async (opts: { name: string; displayName?: string; json?: boolean }) => {
      try {
        const result = await api.openMatter(opts.name, opts.displayName);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          console.log(`Opened Matter: ${r.matterId} ("${r.name}")`);
          console.log(`  Phase: ${r.phase}`);
          console.log(`  Opened by: ${r.openedBy}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // pact matter list [--json]
  matter
    .command('list')
    .description('List all Matters known to the server')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      try {
        const result = await api.listMatters();
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const items = (result as { matters?: unknown[] }).matters ?? [];
          if (items.length === 0) {
            console.log('No Matters open.');
            return;
          }
          for (const item of items) {
            const r = item as Record<string, unknown>;
            const status = r.phase === 'closed' ? '[closed]' : '[active]';
            console.log(
              `${status} ${r.matterId} — "${r.name}" (${r.memberCount} members, ${r.fabricCount} fabrics, ${r.messageCount} messages)`,
            );
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // pact matter show <matterId> [--json]
  matter
    .command('show <matterId>')
    .description("Show a Matter's caller-visible state")
    .option('--json', 'Output as JSON')
    .action(async (matterId: string, opts: { json?: boolean }) => {
      try {
        const result = await api.getMatter(matterId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          console.log(`Matter: ${r.matterId} — "${r.name}"`);
          console.log(`  Phase: ${r.phase}`);
          console.log(`  Members: ${(r.members as unknown[])?.length ?? 0}`);
          console.log(`  Fabrics: ${(r.fabrics as unknown[])?.length ?? 0}`);
          console.log(`  Messages: ${r.messageCount ?? 0}`);
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // pact matter add-member <matterId> --principal <did> [--display <name>] [--role owner|participant]
  matter
    .command('add-member <matterId>')
    .description('Add a member to a Matter (owner-only)')
    .requiredOption('--principal <did>', 'Member principal_id (e.g., did:web:counterparty.example)')
    .option('--display <name>', 'Display name in the Matter')
    .option('--role <role>', 'owner | participant (default: participant)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        matterId: string,
        opts: { principal: string; display?: string; role?: string; json?: boolean },
      ) => {
        try {
          const role =
            opts.role === 'owner' || opts.role === 'participant' ? opts.role : undefined;
          const result = await api.addMatterMember(matterId, opts.principal, opts.display, role);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const r = result as Record<string, unknown>;
            if (r.added === false) {
              console.log(`${opts.principal} is already a member of ${matterId}.`);
            } else {
              // Server returns the member fields flat (matterId, added,
              // principalId, role) — there is no `member` wrapper object.
              console.log(`Added ${r.principalId} (${r.role}) to ${matterId}.`);
            }
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );

  // pact matter attach <matterId> --fabric <resourceId> [--json]
  matter
    .command('attach <matterId>')
    .description('Attach an existing fabric to a Matter (owner-only)')
    .requiredOption('--fabric <resourceId>', 'Fabric / resource ID to attach')
    .option('--json', 'Output as JSON')
    .action(
      async (matterId: string, opts: { fabric: string; json?: boolean }) => {
        try {
          const result = await api.attachFabricToMatter(matterId, opts.fabric);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const r = result as Record<string, unknown>;
            if (r.alreadyAttached) {
              console.log(`${opts.fabric} is already attached to ${matterId}.`);
            } else {
              console.log(`Attached ${opts.fabric} to ${matterId}.`);
            }
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );

  // pact matter detach <matterId> --fabric <resourceId>
  matter
    .command('detach <matterId>')
    .description('Detach a fabric from a Matter (owner-only — fabric persists)')
    .requiredOption('--fabric <resourceId>', 'Fabric / resource ID to detach')
    .option('--json', 'Output as JSON')
    .action(
      async (matterId: string, opts: { fabric: string; json?: boolean }) => {
        try {
          const result = await api.detachFabricFromMatter(matterId, opts.fabric);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`Detached ${opts.fabric} from ${matterId}. (Fabric itself persists.)`);
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );

  // pact matter message <matterId> --content "text" [--fabric fab_x] [--section sec:y]
  matter
    .command('message <matterId>')
    .description('Post a typed-event message to the Matter side-channel')
    .requiredOption('--content <text>', 'Message content')
    .option('--fabric <resourceId>', 'Optional: reference an attached fabric')
    .option('--section <sectionId>', 'Optional: reference a section within the fabric')
    .option('--json', 'Output as JSON')
    .action(
      async (
        matterId: string,
        opts: { content: string; fabric?: string; section?: string; json?: boolean },
      ) => {
        try {
          const result = await api.postMatterMessage(
            matterId,
            opts.content,
            opts.fabric,
            opts.section,
          );
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const r = result as Record<string, unknown>;
            // Server returns the post ack flat (matterId, messageId, sender,
            // postedAt) — there is no `message` wrapper object.
            console.log(`Posted message ${r.messageId} to ${matterId}.`);
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );

  // pact matter messages <matterId> — list the side-channel
  matter
    .command('messages <matterId>')
    .description('List Matter side-channel messages')
    .option('--json', 'Output as JSON')
    .action(async (matterId: string, opts: { json?: boolean }) => {
      try {
        const result = await api.listMatterMessages(matterId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const msgs = (result as { messages?: unknown[] }).messages ?? [];
          if (msgs.length === 0) {
            console.log('No messages yet.');
            return;
          }
          for (const msg of msgs) {
            const m = msg as Record<string, unknown>;
            // Server returns each message flat (id, sender, postedAt, format,
            // content, …) — no `body` wrapper, and the sender key is `sender`.
            console.log(`[${m.postedAt}] ${m.sender}: ${m.content}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // pact matter manifest <matterId> — caller-scoped cross-fabric view
  matter
    .command('manifest <matterId>')
    .description("Caller-scoped cross-fabric manifest (§4.4 extended to Matter scope)")
    .option('--json', 'Output as JSON')
    .action(async (matterId: string, opts: { json?: boolean }) => {
      try {
        const result = await api.getMatterManifest(matterId);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const r = result as Record<string, unknown>;
          const caller = r.caller as Record<string, unknown>;
          const peers = (r.counterparties as unknown[]) ?? [];
          const fabrics = (r.fabrics as unknown[]) ?? [];
          const obls = (r.pendingObligationsAcrossFabrics as unknown[]) ?? [];
          const sc = r.sideChannel as Record<string, unknown>;
          console.log(`Matter: ${r.matterId} (${r.phase})`);
          console.log(`  You: ${caller.principalId} (${caller.role})`);
          console.log(`  Peers (${peers.length}):`);
          for (const p of peers) {
            const pp = p as Record<string, unknown>;
            const tag = pp.crossOrg ? '[cross-org]' : '[same-org]';
            console.log(`    ${tag} ${pp.principalId} — ${pp.displayName} (${pp.role})`);
          }
          console.log(`  Fabrics attached (${fabrics.length}):`);
          for (const f of fabrics) {
            const ff = f as Record<string, unknown>;
            const mem = ff.callerIsFabricMember ? 'member' : 'not a member';
            console.log(
              `    ${ff.resourceId} — phase=${ff.phase}, open_proposals=${ff.openProposals}, you=${mem}`,
            );
          }
          console.log(`  Pending obligations across fabrics (${obls.length}):`);
          for (const o of obls) {
            const oo = o as Record<string, unknown>;
            console.log(`    ${oo.kind} on ${oo.eventRef} in ${oo.fabricId}`);
          }
          console.log(
            `  Side-channel: ${sc.messageCount} messages (latest: ${sc.latestMessageAt ?? 'none'})`,
          );
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // pact matter close <matterId> [--outcome "deal-signed"]
  matter
    .command('close <matterId>')
    .description('Close a Matter (owner-only). Attached fabrics persist.')
    .option('--outcome <outcome>', "Free-form outcome label (e.g., 'deal-signed', 'walked-away')")
    .option('--json', 'Output as JSON')
    .action(
      async (matterId: string, opts: { outcome?: string; json?: boolean }) => {
        try {
          const result = await api.closeMatter(matterId, opts.outcome);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const r = result as Record<string, unknown>;
            if (r.alreadyClosed) {
              console.log(`Matter ${matterId} was already closed at ${r.closedAt}.`);
            } else {
              const fabs = (r.fabricsReferenced as string[]) ?? [];
              console.log(
                `Closed ${matterId} with outcome "${r.outcome}". ${fabs.length} fabric(s) detached but persist independently.`,
              );
            }
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      },
    );
}
