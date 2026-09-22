// Structured JSON logger for Source.
//
// Dependency-free by design: emits one JSON object per line on stdout.
// Azure Container Apps captures stdout and routes to Log Analytics / App
// Insights when wired (see docs/OBSERVABILITY.md). When App Insights is not
// configured, logs are still queryable via `az containerapp logs show`.
//
// Levels: trace < debug < info < warn < error < fatal
// Default level: info. Override via LOG_LEVEL env var.
//
// Usage:
//   import { log } from "@/lib/logger";
//   log.info({ requestId, op: "pact.proposal.create" }, "proposal created");
//   log.error({ err, requestId }, "failed to publish");
//
//   const reqLog = log.child({ requestId: "abc-123" });
//   reqLog.info({ topicId }, "loaded topic");
//
// Per-request correlation (WS1 — auto-binding via AsyncLocalStorage):
//   import { runWithRequestId, log } from "@/lib/logger";
//
//   // In a route handler at entry:
//   export async function GET(req: NextRequest) {
//     const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
//     return runWithRequestId(requestId, async () => {
//       log.info({ op: "scenarios.match" }, "matching scenarios"); // requestId auto-injected
//       ...
//     });
//   }
//
// Callers that already pass an explicit `requestId` field win — the ALS value
// is only used as a fallback. This keeps existing call sites working unchanged.
//
// Conventions (also documented in docs/OBSERVABILITY.md):
// - Always include `op` for operation name (dot-separated, e.g. "pact.proposal.create").
// - Use `requestId` to correlate logs within a single request.
// - For errors: pass the Error as `err`; the logger flattens name/message/stack.
// - PII redaction: do NOT log raw API keys, raw request bodies with secrets, or
//   full IPs. Use `actorKeyHash` (already hashed elsewhere) and `ipCountry`.

import { AsyncLocalStorage } from "node:async_hooks";

const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export type LogLevel = keyof typeof LEVELS;

const ENV_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
const MIN_LEVEL = LEVELS[ENV_LEVEL] ?? LEVELS.info;

const SERVICE_NAME = "source";
const SERVICE_VERSION =
  process.env.SOURCE_VERSION ?? process.env.GITHUB_SHA?.slice(0, 7) ?? "dev";

interface LogContext {
  [key: string]: unknown;
}

/**
 * Per-request context carried across async boundaries via AsyncLocalStorage.
 *
 * Today the only field is `requestId` (minted in `src/proxy.ts` Edge proxy
 * and bound by route handlers via `runWithRequestId`). Future fields (actor
 * identity, tenant slug, trace flags) extend this without changing call sites.
 */
interface RequestContext {
  requestId: string;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Bind a request id into AsyncLocalStorage for the duration of `fn`.
 *
 * Route handlers call this at entry with the `x-request-id` header that
 * `src/proxy.ts` minted, so all downstream `log.*` calls (and any
 * `withRequestId()` consumers in helper modules) auto-correlate without
 * having to thread the id through every function signature.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestStorage.run({ requestId }, fn);
}

/**
 * Read the current request id from AsyncLocalStorage.
 *
 * Returns `undefined` outside a `runWithRequestId(...)` scope — including
 * background workers, cron callers, and any code path that has not been
 * bound. Callers that need a non-null id should fall back to
 * `crypto.randomUUID()` themselves.
 */
export function getCurrentRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

/**
 * Merge the current request id (if any) with a caller-supplied context.
 *
 * Caller-supplied `requestId` always wins — this is a fallback. Useful when
 * building a log context manually, building an audit row, or constructing
 * a child logger inside a request scope:
 *
 *   const reqLog = log.child(withRequestId({ actorKeyHash }));
 *
 * No AsyncLocalStorage scope active → returns the input unchanged.
 */
export function withRequestId<T extends LogContext>(extra: T = {} as T): T {
  if ("requestId" in extra && extra.requestId !== undefined && extra.requestId !== null) {
    return extra;
  }
  const fromStore = getCurrentRequestId();
  if (fromStore === undefined) {
    return extra;
  }
  return { ...extra, requestId: fromStore };
}

function flattenError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { err };
  return {
    err: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      cause: err.cause instanceof Error ? err.cause.message : err.cause,
    },
  };
}

function emit(level: LogLevel, context: LogContext, msg?: string): void {
  if (LEVELS[level] < MIN_LEVEL) return;

  // Flatten Error objects into structured fields.
  const ctx: Record<string, unknown> = { ...context };
  if (ctx.err !== undefined) {
    Object.assign(ctx, flattenError(ctx.err));
  }

  // Auto-inject `requestId` from AsyncLocalStorage when caller omitted it.
  // Caller-supplied id always wins. Outside a bound scope this is a no-op,
  // so background workers and cron callers behave unchanged.
  if (ctx.requestId === undefined) {
    const fromStore = getCurrentRequestId();
    if (fromStore !== undefined) {
      ctx.requestId = fromStore;
    }
  }

  const entry = {
    time: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    msg,
    ...ctx,
  };

  // One line of JSON per log entry. ACA log driver expects line-delimited.
  // Use process.stderr for warn+ so they're separable from info-level traffic.
  const line = JSON.stringify(entry);
  if (LEVELS[level] >= LEVELS.warn) {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

function makeLogger(boundContext: LogContext = {}) {
  const log = (level: LogLevel, ctxOrMsg: LogContext | string, msg?: string) => {
    if (typeof ctxOrMsg === "string") {
      emit(level, boundContext, ctxOrMsg);
    } else {
      emit(level, { ...boundContext, ...ctxOrMsg }, msg);
    }
  };

  return {
    trace: (ctxOrMsg: LogContext | string, msg?: string) => log("trace", ctxOrMsg, msg),
    debug: (ctxOrMsg: LogContext | string, msg?: string) => log("debug", ctxOrMsg, msg),
    info: (ctxOrMsg: LogContext | string, msg?: string) => log("info", ctxOrMsg, msg),
    warn: (ctxOrMsg: LogContext | string, msg?: string) => log("warn", ctxOrMsg, msg),
    error: (ctxOrMsg: LogContext | string, msg?: string) => log("error", ctxOrMsg, msg),
    fatal: (ctxOrMsg: LogContext | string, msg?: string) => log("fatal", ctxOrMsg, msg),
    child: (extra: LogContext) => makeLogger({ ...boundContext, ...extra }),
  };
}

export const log = makeLogger();
export type Logger = ReturnType<typeof makeLogger>;
