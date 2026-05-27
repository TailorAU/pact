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
          console.log(`Opened Matter: ${r.matter_id} ("${r.name}")`);
          console.log(`  Phase: ${r.phase}`);
          console.log(`  Opened by: ${r.opened_by}`);
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
              `${status} ${r.matter_id} — "${r.name}" (${r.member_count} members, ${r.fabric_count} fabrics, ${r.message_count} messages)`,
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
          console.log(`Matter: ${r.matter_id} — "${r.name}"`);
          console.log(`  Phase: ${r.phase}`);
          console.log(`  Members: ${(r.members as unknown[])?.length ?? 0}`);
          console.log(`  Fabrics: ${(r.fabrics as unknown[])?.length ?? 0}`);
          console.log(`  Messages: ${r.message_count ?? 0}`);
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
              const m = r.member as Record<string, unknown>;
              console.log(`Added ${m.principal_id} (${m.role}) to ${matterId}.`);
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
            if (r.already_attached) {
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
            const m = r.message as Record<string, unknown>;
            console.log(`Posted message ${m.id} to ${matterId}.`);
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
            const body = m.body as Record<string, unknown>;
            console.log(`[${m.posted_at}] ${m.sender_principal}: ${body.content}`);
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
          const obls = (r.pending_obligations_across_fabrics as unknown[]) ?? [];
          const sc = r.side_channel as Record<string, unknown>;
          console.log(`Matter: ${r.matter_id} (${r.phase})`);
          console.log(`  You: ${caller.principal_id} (${caller.role})`);
          console.log(`  Peers (${peers.length}):`);
          for (const p of peers) {
            const pp = p as Record<string, unknown>;
            const tag = pp.cross_org ? '[cross-org]' : '[same-org]';
            console.log(`    ${tag} ${pp.principal_id} — ${pp.display_name} (${pp.role})`);
          }
          console.log(`  Fabrics attached (${fabrics.length}):`);
          for (const f of fabrics) {
            const ff = f as Record<string, unknown>;
            const mem = ff.caller_is_fabric_member ? 'member' : 'not a member';
            console.log(
              `    ${ff.resourceId} — phase=${ff.phase}, open_proposals=${ff.open_proposals}, you=${mem}`,
            );
          }
          console.log(`  Pending obligations across fabrics (${obls.length}):`);
          for (const o of obls) {
            const oo = o as Record<string, unknown>;
            console.log(`    ${oo.kind} on ${oo.event_ref} in ${oo.fabric_id}`);
          }
          console.log(
            `  Side-channel: ${sc.message_count} messages (latest: ${sc.latest_message_at ?? 'none'})`,
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
            if (r.already_closed) {
              console.log(`Matter ${matterId} was already closed at ${r.closed_at}.`);
            } else {
              const fabs = (r.fabrics_referenced as string[]) ?? [];
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
