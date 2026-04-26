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
// Conventions (also documented in docs/OBSERVABILITY.md):
// - Always include `op` for operation name (dot-separated, e.g. "pact.proposal.create").
// - Use `requestId` to correlate logs within a single request.
// - For errors: pass the Error as `err`; the logger flattens name/message/stack.
// - PII redaction: do NOT log raw API keys, raw request bodies with secrets, or
//   full IPs. Use `actorKeyHash` (already hashed elsewhere) and `ipCountry`.

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
