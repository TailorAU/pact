import { Command } from 'commander';
import { getBaseUrl, getAuthHeader } from '../config.js';
import { updateSession } from '../sessions.js';

interface TranscriptEvent {
  event_id?: string;
  eventId?: string;
  id?: string;
  type?: string;
  agent?: string;
  agent_id?: string;
  timestamp?: string;
  summary?: string;
  [k: string]: unknown;
}

interface TranscriptResponse {
  events?: TranscriptEvent[];
  changes?: TranscriptEvent[];
  latest_event_id?: string;
  latestEventId?: string;
  [k: string]: unknown;
}

function eventIdOf(e: TranscriptEvent): string | undefined {
  return e.event_id ?? e.eventId ?? e.id;
}

export function registerTranscriptCommand(program: Command): void {
  program
    .command('transcript <fabricId>')
    .description(
      'Print the event log (transcript) for a fabric since the given event id (§4.4, v2.0.3). ' +
        'With --mark-read, also POSTs to /api/pact/{fabricId}/mark-read to acknowledge the printed range; ' +
        'the high-water mark is stored locally in ~/.pact/sessions.json.',
    )
    .option('--since <eventId>', 'Only return events after this event id. Defaults to the beginning.')
    .option('--mark-read', 'After printing, mark this range as read on the server.')
    .option('--json', 'Output the raw transcript as JSON.')
    .action(async (fabricId: string, opts: { since?: string; markRead?: boolean; json?: boolean }) => {
      try {
        const baseUrl = getBaseUrl();
        const auth = getAuthHeader();
        const headers: Record<string, string> = {};
        if (auth) headers[auth.key] = auth.value;

        const params = new URLSearchParams();
        if (opts.since) params.set('since', opts.since);
        const qs = params.toString() ? `?${params}` : '';

        // Server is free to expose this at either /transcript or /events.
        // §4.4 calls it the "active-session transcript"; we use /transcript as the canonical surface.
        const res = await fetch(`${baseUrl}/api/pact/${encodeURIComponent(fabricId)}/transcript${qs}`, {
          headers,
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} fetching transcript: ${text.slice(0, 200)}`);
        }
        const body = (await res.json()) as TranscriptResponse | TranscriptEvent[];
        const events: TranscriptEvent[] = Array.isArray(body)
          ? body
          : (body.events ?? body.changes ?? []);

        if (opts.json) {
          console.log(JSON.stringify(body, null, 2));
        } else {
          if (events.length === 0) {
            console.log(`No new events for fabric ${fabricId}${opts.since ? ` since ${opts.since}` : ''}.`);
          } else {
            for (const e of events) {
              const id = eventIdOf(e) ?? '?';
              const t = e.type ?? '?';
              const agent = e.agent ?? e.agent_id ?? '';
              const ts = e.timestamp ? `[${e.timestamp}] ` : '';
              const summary = e.summary ? ` — ${e.summary}` : '';
              console.log(`${ts}${id}  ${t}  ${agent}${summary}`);
            }
          }
        }

        // Track the high-water mark even without --mark-read so `where` shows the last id we saw.
        const last =
          (Array.isArray(body) ? null : body.latest_event_id ?? body.latestEventId) ??
          (events.length > 0 ? eventIdOf(events[events.length - 1]!) : undefined);
        if (last) {
          await updateSession(fabricId, { lastReadEventId: last });
        }

        if (opts.markRead && events.length > 0) {
          const first = eventIdOf(events[0]!);
          const lastId = eventIdOf(events[events.length - 1]!);
          const markBody: Record<string, unknown> = {};
          if (first) markBody.from_event_id = first;
          if (lastId) markBody.to_event_id = lastId;
          const markRes = await fetch(`${baseUrl}/api/pact/${encodeURIComponent(fabricId)}/mark-read`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(markBody),
            signal: AbortSignal.timeout(30_000),
          });
          if (!markRes.ok) {
            const text = await markRes.text();
            throw new Error(`HTTP ${markRes.status} from mark-read: ${text.slice(0, 200)}`);
          }
          if (!opts.json) {
            console.log(`\n✓ marked ${events.length} event(s) read on server.`);
          }
        }
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
