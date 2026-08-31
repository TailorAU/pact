import fs from "fs";
import path from "path";
import pg from "pg";
import { v4 as uuid } from "uuid";
import { dependencyGateOk, VERIFIED_TOPIC_STATUSES } from "./consensus-gate";
import {
  APPLY_BLOCKED_EVENT,
  KG_APPLY_RESOURCE_TYPE,
  evaluateApplyGuard,
} from "./effect-class";
import { appendChainedEvent } from "./provenance-chain";
import {
  computeEffectiveCredences,
  credenceFromRatio,
  type CredenceEdge,
  type CredenceNode,
} from "./epistemic";
import {
  type CountingMode,
  type TallyVote,
  type TalliedVote,
  INDEPENDENCE_CONFIG,
  deriveClassKey,
  meetsStanding,
  tallyVotes,
  usesClassCounting,
} from "./independence";
// #5598 — the pure retention seam. `retention.ts` imports nothing (so it can
// also be imported by pact-profile.ts, which must stay database-free); it
// builds SQL strings and never executes one.
import {
  CHAIN_META_BACKFILL_SWEEP_KEY,
  CHAIN_META_ORIGIN_BACKFILL,
  buildUnchainedHistoryStamp,
  buildUnchainedRowCount,
} from "./retention";

// Load DDL from sql/<filename>. Splits on ";\n" to recover individual
// statement strings that initSchema passes to db.execute(), matching the
// inline pattern they replace.
//
// Each split segment may carry leading `--` line comments (a header block
// above the first statement, or per-statement banners between statements).
// We strip those header lines before checking emptiness so a statement
// preceded by an explanatory comment block still ships. The previous
// implementation filtered any segment whose first character was `-`, which
// silently dropped any commented-statement.
//
// Mid-statement / inline comments are preserved by `pgify` / pg's parser.
function _loadSqlStatements(filename: string): string[] {
  const sqlPath = path.join(process.cwd(), "sql", filename);
  return fs
    .readFileSync(sqlPath, "utf8")
    .split(/;\s*\n/)
    .map((s) => {
      // Strip leading `--` comment lines + blank lines; keep mid-statement
      // comments intact for the SQL parser. A segment that becomes empty
      // (was comments-only) gets dropped by the next filter step.
      const lines = s.split("\n");
      let i = 0;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.length === 0 || t.startsWith("--")) {
          i++;
        } else {
          break;
        }
      }
      return lines.slice(i).join("\n").trim();
    })
    .filter((s) => s.length > 0);
}

const _legislationStatements: string[] = _loadSqlStatements("legislation-schema.sql");

// WS9 — sync-log augment columns (silent_zero_flag, parser_version,
// parser_crash_count, parser_anomaly_count). Idempotent ALTERs; safe to apply
// after the base legislation schema. Both files must agree on the column shape
// — see sql/legislation-sync-log-augment.sql header comment.
const _legislationSyncLogAugmentStatements: string[] = _loadSqlStatements(
  "legislation-sync-log-augment.sql"
);

// WS12 — per-agent spending_cap_daily column on agents. Idempotent ALTER; safe
// to apply after the base agents table is created in initSchema. NULL = no cap;
// see sql/spending-cap.sql header for the cap-enforcement contract.
const _spendingCapStatements: string[] = _loadSqlStatements("spending-cap.sql");

// #2520 — authoritative curriculum graph (ACARA v9 + EYLF). Same extraction
// pattern as legislation-schema.sql: DDL in sql/curriculum-schema.sql, loaded
// at module init and applied by initSchema(). Idempotent (CREATE ... IF NOT
// EXISTS). The representative ACARA/EYLF slice is seeded by seedCurriculum()
// at the end of initSchema (idempotent, ON CONFLICT DO NOTHING).
const _curriculumStatements: string[] = _loadSqlStatements("curriculum-schema.sql");

// #3053 — fiscal reconstruction (QLD Budget temporal graph node). DDL in
// sql/fiscal-reconstruction-schema.sql, same loader pattern as legislation.
// fiscal_line / fiscal_forecast / fiscal_sync_log; idempotent CREATE IF NOT EXISTS.
const _fiscalStatements: string[] = _loadSqlStatements("fiscal-reconstruction-schema.sql");

// #3053 follow-up — fiscal compute meter (cost side of EV/AV story). Idempotent
// ALTERs on fiscal_sync_log + fiscal_compute_ledger. Must load AFTER the base
// fiscal schema (depends on fiscal_sync_log existing).
const _fiscalMeterStatements: string[] = _loadSqlStatements("fiscal-compute-meter.sql");

// Return TIMESTAMP / TIMESTAMPTZ as ISO strings (not JS Date objects)
// so existing code that casts date columns to string keeps working.
pg.types.setTypeParser(1114, (val: string) => val);
pg.types.setTypeParser(1184, (val: string) => val);

// #5525 — node-postgres has NO default parser for int8 (OID 20): COUNT(*),
// SUM(<int>), and bigint columns come back as STRINGS. The consensus
// sweep's strict checks (`pending === 0` in Phase 1, dependencyGateOk's
// `unmetDeps === 0`, `support === 0` in evaluateChallenges) are false for
// "0", and its ratio arithmetic concatenates ("3" + "1" === "31" makes
// alignmentRatio 3/31 instead of 3/4) — so against real Postgres the sweep
// could neither promote nor correctly tally. Parse int8 to a JS number.
//
// Bounds note: Number is exact only to 2^53 − 1 (9,007,199,254,740,991).
// Every int8 this app reads is a row count or a SUM over small integers,
// which cannot realistically approach that; precision loss beyond the safe
// range is accepted over the string-comparison failure class.
//
// NUMERIC (OID 1700) is deliberately NOT parsed to Number: the fiscal
// schema stores dollar figures as NUMERIC-never-float (see
// sql/fiscal-reconstruction-schema.sql). The one numeric read on the sweep
// path (agent_age_days in computeTopicVoteTally) is coerced downstream by
// meetsStanding(), which Number()-wraps its inputs.
pg.types.setTypeParser(20, (val: string) => Number(val));

const { Pool } = pg;

export interface DbResult {
  rows: Record<string, unknown>[];
  rowsAffected?: number;
}

export interface DbClient {
  execute(stmtOrSql: string | { sql: string; args: unknown[] }): Promise<DbResult>;
  batch(stmts: { sql: string; args: unknown[] }[]): Promise<void>;
  /**
   * #5566 — run `fn` inside ONE database transaction, on ONE connection.
   * The §6.4 provenance chain (`emitEvent` → `appendChainedEvent`) needs a
   * read-then-write to be atomic: without it, two concurrent appends could
   * read the same head and mint a duplicate sequence number, and a crash
   * between the insert and the hash stamp would leave a hashless row that
   * breaks the chain for every event after it.
   *
   * Optional so a test's in-memory `DbClient` mock stays a two-method
   * object; every PRODUCTION client (`createPgClient`, the consensus
   * sweep's connection-scoped client) implements it.
   */
  transaction?<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  /** #5566 — true when this client is ALREADY inside an open transaction (never nest a BEGIN). */
  inTransaction?: boolean;
}

let _pool: pg.Pool | null = null;
let _client: DbClient | null = null;
let _initialized = false;

function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

/** Convert SQLite-style ? positional params to Postgres $1, $2, ...
 *  Also double-quotes all camelCase identifiers (column aliases) so
 *  Postgres preserves case in SELECT, ORDER BY, GROUP BY, etc. */
function pgify(sql: string): string {
  let idx = 0;
  let s = sql.replace(/\?/g, () => `$${++idx}`);
  s = s.replace(/\b([a-z][a-zA-Z]*[A-Z]\w*)\b/g, '"$1"');
  return s;
}

/**
 * #5566 — wraps ONE dedicated `pg` connection as a transaction-scoped
 * `DbClient`. `inTransaction` is set so a nested `transaction()` call
 * participates in the open transaction instead of issuing a second BEGIN
 * (Postgres would warn and the inner COMMIT would commit the outer work).
 */
function createTransactionScopedClient(client: pg.PoolClient): DbClient {
  const tx: DbClient = {
    async execute(stmtOrSql): Promise<DbResult> {
      const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
      const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
      const result = await client.query(pgify(sql), args);
      return { rows: result.rows, rowsAffected: result.rowCount ?? 0 };
    },
    async batch(stmts): Promise<void> {
      // Already inside a transaction — the statements ride it, and the
      // caller's COMMIT/ROLLBACK covers them.
      for (const stmt of stmts) {
        await client.query(pgify(stmt.sql), stmt.args);
      }
    },
    inTransaction: true,
  };
  tx.transaction = async <T>(fn: (inner: DbClient) => Promise<T>): Promise<T> => fn(tx);
  return tx;
}

/** #5566 — BEGIN/COMMIT around `fn` on a dedicated connection; ROLLBACK on any throw. */
async function runInTransaction<T>(pool: pg.Pool, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(createTransactionScopedClient(client));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    // A dead connection makes ROLLBACK throw; never let that mask the real
    // failure the caller needs to see.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already unusable — the transaction is aborted regardless */
    }
    throw e;
  } finally {
    client.release();
  }
}

function createPgClient(): DbClient {
  const pool = getPool();
  return {
    async execute(stmtOrSql): Promise<DbResult> {
      const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
      const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
      const result = await pool.query(pgify(sql), args);
      return { rows: result.rows, rowsAffected: result.rowCount ?? 0 };
    },
    async batch(stmts): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const stmt of stmts) {
          await client.query(pgify(stmt.sql), stmt.args);
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    // #5566 — the §6.4 chained append runs here.
    transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      return runInTransaction(pool, fn);
    },
  };
}

export async function getDb(): Promise<DbClient> {
  if (!_client) {
    _client = createPgClient();
  }
  if (!_initialized) {
    await initSchema(_client);
    _initialized = true;
  }
  return _client;
}

// ─── Schema (all migrations folded into clean DDL) ──────────────────────────

async function initSchema(db: DbClient) {
  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'practice',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      consensus_ratio DOUBLE PRECISION,
      consensus_voters INTEGER,
      consensus_since TIMESTAMPTZ,
      canonical_claim TEXT,
      jurisdiction TEXT,
      authority TEXT,
      source_ref TEXT,
      effective_date TEXT,
      expiry_date TEXT,
      last_verified_at TIMESTAMPTZ,
      last_verified_by TEXT,
      tier_migrated_from TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      heading TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 2,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_key TEXT UNIQUE NOT NULL,
      model TEXT NOT NULL DEFAULT 'unknown',
      framework TEXT NOT NULL DEFAULT 'raw HTTP',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      proposals_made INTEGER NOT NULL DEFAULT 0,
      proposals_approved INTEGER NOT NULL DEFAULT 0,
      proposals_rejected INTEGER NOT NULL DEFAULT 0,
      objections_made INTEGER NOT NULL DEFAULT 0,
      karma INTEGER NOT NULL DEFAULT 0,
      topics_created INTEGER NOT NULL DEFAULT 0,
      reviews_cast INTEGER NOT NULL DEFAULT 0,
      successful_challenges INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      role TEXT NOT NULL DEFAULT 'collaborator',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      done_status TEXT,
      done_at TIMESTAMPTZ,
      done_summary TEXT,
      confidential INTEGER NOT NULL DEFAULT 0,
      assumptions_declared INTEGER NOT NULL DEFAULT 0,
      UNIQUE(topic_id, agent_id)
    )`,
    `CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      section_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      new_content TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      ttl_seconds INTEGER NOT NULL DEFAULT 300,
      citations TEXT,
      confidential INTEGER NOT NULL DEFAULT 0,
      public_summary TEXT,
      proposal_type TEXT NOT NULL DEFAULT 'edit'
    )`,
    `CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES proposals(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      vote_type TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confidential INTEGER NOT NULL DEFAULT 0,
      public_summary TEXT,
      UNIQUE(proposal_id, agent_id)
    )`,
    `CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      section_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      goal TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS constraints_table (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      section_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      boundary TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS salience (
      topic_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      score INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(topic_id, section_id, agent_id)
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      type TEXT NOT NULL,
      agent_id TEXT,
      section_id TEXT,
      data TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS sweep_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS invite_tokens (
      token TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      label TEXT,
      max_uses INTEGER DEFAULT 999999,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS topic_dependencies (
      topic_id TEXT NOT NULL REFERENCES topics(id),
      depends_on TEXT NOT NULL REFERENCES topics(id),
      relationship TEXT NOT NULL DEFAULT 'builds_on',
      justification TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(topic_id, depends_on)
    )`,
    `CREATE TABLE IF NOT EXISTS topic_votes (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      vote_type TEXT NOT NULL CHECK (vote_type IN ('approve', 'reject', 'need_info')),
      reason TEXT,
      need_info_topic_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(topic_id, agent_id)
    )`,

    // ── Economy Tables ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS agent_wallets (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id),
      balance DOUBLE PRECISION NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS ledger_txs (
      id TEXT PRIMARY KEY,
      from_wallet TEXT,
      to_wallet TEXT,
      amount DOUBLE PRECISION NOT NULL,
      topic_id TEXT,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS topic_bounties (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      sponsor_id TEXT NOT NULL REFERENCES agents(id),
      amount DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'escrow',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      owner_name TEXT NOT NULL,
      secret_hash TEXT NOT NULL UNIQUE,
      credit_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      email TEXT,
      tier TEXT NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS axiom_usage_logs (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      api_key_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS assumption_declarations (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      agent_id TEXT NOT NULL REFERENCES agents(id),
      assumption_topic_id TEXT NOT NULL REFERENCES topics(id),
      created_new INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(topic_id, agent_id, assumption_topic_id)
    )`,

    // ── Legislation Tables + Sync Log + Indexes ──────────────────────
    // DDL extracted to sites/source/sql/legislation-schema.sql (WS8).
    // Loaded at module init via readFileSync; see top of file.
    ..._legislationStatements,

    // ── Legislation sync-log WS9 augment ──────────────────────────────
    // Adds silent_zero_flag, parser_version, parser_crash_count,
    // parser_anomaly_count to legislation_sync_log. Idempotent ALTERs —
    // see sql/legislation-sync-log-augment.sql.
    ..._legislationSyncLogAugmentStatements,

    // ── Spending-cap WS12 augment ────────────────────────────────────
    // Adds spending_cap_daily INTEGER (NULL = unlimited) to agents. The
    // cap is enforced in lib/wallet-debit.ts before the balance check.
    // See sql/spending-cap.sql header for the contract.
    ..._spendingCapStatements,

    // ── Curriculum graph (#2520) ─────────────────────────────────────
    // ACARA v9 + EYLF descriptors. DDL extracted to sql/curriculum-schema.sql,
    // same loader pattern as legislation. Seeded below via seedCurriculum().
    ..._curriculumStatements,

    // ── Fiscal reconstruction (#3053) ────────────────────────────────
    // QLD Budget temporal graph node: fiscal_line / fiscal_forecast /
    // fiscal_sync_log. DDL in sql/fiscal-reconstruction-schema.sql.
    ..._fiscalStatements,

    // ── Fiscal compute meter (#3053 follow-up) ───────────────────────
    // Per-run token columns on fiscal_sync_log + fiscal_compute_ledger.
    // Loaded after the base fiscal schema (ALTERs depend on it).
    ..._fiscalMeterStatements,

    // ── Indexes ─────────────────────────────────────────────────────
    `CREATE INDEX IF NOT EXISTS idx_proposals_topic_status ON proposals(topic_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_proposals_agent_id ON proposals(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_votes_proposal_type ON votes(proposal_id, vote_type)`,
    `CREATE INDEX IF NOT EXISTS idx_votes_agent_id ON votes(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_registrations_topic ON registrations(topic_id, left_at)`,
    `CREATE INDEX IF NOT EXISTS idx_registrations_agent ON registrations(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_events_topic ON events(topic_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sections_topic ON sections(topic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_intents_topic ON intents(topic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_constraints_topic ON constraints_table(topic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key)`,
    `CREATE INDEX IF NOT EXISTS idx_topic_votes_topic ON topic_votes(topic_id, vote_type)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_title ON topics(title)`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_from ON ledger_txs(from_wallet)`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_to ON ledger_txs(to_wallet)`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_topic ON ledger_txs(topic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bounties_topic ON topic_bounties(topic_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_topic ON axiom_usage_logs(topic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_key ON axiom_usage_logs(api_key_id)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_created ON axiom_usage_logs(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_assumption_decl_topic ON assumption_declarations(topic_id)`,
    `CREATE INDEX IF NOT EXISTS idx_assumption_decl_agent ON assumption_declarations(agent_id)`,
    // idx_legdoc_* and idx_legsec_* indexes are now in sql/legislation-schema.sql (WS8)

    // ── Audit log (#1308 / MEGA-80 WS5) ─────────────────────────────────
    // Immutable trail of business-relevant mutations. Privacy Act mapping +
    // 7-year retention policy: see sites/source/docs/AUDIT.md.
    `CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_key_hash TEXT,
      actor_label TEXT,
      op TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      before_json TEXT,
      after_json TEXT,
      request_id TEXT,
      ip_country TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_key_hash, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`,

    // ── GTFS / Transit Tables (#875) ─────────────────────────────────────
    // Translink SEQ GTFS static feed — weekly refresh via /api/cron/gtfs-sync.
    // Full stops + train routes. stop_times scoped to rail trips through the
    // 7 SEQ stations relevant to QIC v1 to keep storage bounded.
    `CREATE TABLE IF NOT EXISTS transit_stops (
      stop_id TEXT PRIMARY KEY,
      stop_name TEXT NOT NULL,
      stop_lat DOUBLE PRECISION NOT NULL,
      stop_lon DOUBLE PRECISION NOT NULL,
      stop_timezone TEXT,
      retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_date TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS transit_routes (
      route_id TEXT PRIMARY KEY,
      route_short_name TEXT NOT NULL,
      route_long_name TEXT NOT NULL,
      route_type INTEGER NOT NULL,
      retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS transit_trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      trip_headsign TEXT,
      retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS transit_stop_times (
      trip_id TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      arrival_time TEXT NOT NULL,
      departure_time TEXT NOT NULL,
      stop_sequence INTEGER NOT NULL,
      PRIMARY KEY (trip_id, stop_sequence)
    )`,
    `CREATE TABLE IF NOT EXISTS gtfs_sync_log (
      id TEXT PRIMARY KEY,
      feed_url TEXT NOT NULL,
      stops_ingested INTEGER NOT NULL DEFAULT 0,
      routes_ingested INTEGER NOT NULL DEFAULT 0,
      trips_ingested INTEGER NOT NULL DEFAULT 0,
      stop_times_ingested INTEGER NOT NULL DEFAULT 0,
      errors TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_transit_stops_name ON transit_stops(stop_name)`,
    `CREATE INDEX IF NOT EXISTS idx_transit_routes_type ON transit_routes(route_type)`,
    `CREATE INDEX IF NOT EXISTS idx_transit_trips_route ON transit_trips(route_id)`,
    `CREATE INDEX IF NOT EXISTS idx_transit_st_stop ON transit_stop_times(stop_id)`,

    // ── QLD Cadastre Cache (#875) ─────────────────────────────────────────
    // ETag-cached proxy over QLD Spatial Cadastre ArcGIS REST.
    // lot_plan → GeoJSON polygon. expires_at defaults 7 days; revalidated
    // on expiry using the upstream ETag before a full re-fetch.
    `CREATE TABLE IF NOT EXISTS cadastre_cache (
      lot_plan TEXT PRIMARY KEY,
      geometry_json TEXT NOT NULL,
      object_id TEXT,
      etag TEXT,
      retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cadastre_expires ON cadastre_cache(expires_at)`,

    // ── Domains registry (#876) ────────────────────────────────────────────
    // Domain = a vertical use-case that groups legislation collections,
    // spatial layers, and scenario clusters into a named evidence domain.
    // First domain: property_development (QIC Fabric engine).
    `CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      legislation_collection TEXT,
      spatial_layers TEXT,
      scenario_clusters TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(name)`,

    // ── Fact-model delta fields (#876) ─────────────────────────────────────
    // Added to existing tables as safe ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
    // domain: which evidence domain this fact belongs to
    // derived_from: JSON array of source references (traceability)
    // limitations: JSON array of epistemic caveats
    // spatial_basis: spatial computation basis (for spatial-derived facts)
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS domain TEXT`,
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS derived_from TEXT`,
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS limitations TEXT`,
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS spatial_basis TEXT`,
    `ALTER TABLE legislation_docs ADD COLUMN IF NOT EXISTS domain TEXT`,
    `ALTER TABLE legislation_docs ADD COLUMN IF NOT EXISTS derived_from TEXT`,
    `ALTER TABLE legislation_docs ADD COLUMN IF NOT EXISTS limitations TEXT`,
    `ALTER TABLE legislation_sections ADD COLUMN IF NOT EXISTS domain TEXT`,
    `ALTER TABLE legislation_sections ADD COLUMN IF NOT EXISTS spatial_basis TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_topics_domain ON topics(domain)`,
    `CREATE INDEX IF NOT EXISTS idx_legdoc_domain ON legislation_docs(domain)`,
    `CREATE INDEX IF NOT EXISTS idx_legsec_domain ON legislation_sections(domain)`,

    // ── Two-axis epistemic model (#3691 W1) ────────────────────────────────
    // convention_stop: Axis-B flag — this node is where the community agreed
    //   to stop digging (a consensus role, NOT a fifth warrant kind).
    // credence: effective credence recomputed each consensus sweep from the
    //   dependency frontier (see epistemic.ts) — derived, self-healing state.
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS convention_stop INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS credence DOUBLE PRECISION`,
    // Atomic-claim discipline (#3691 W2/W6): optional supporting line +
    // read-only atomicity classification ('atomic' | 'needs_split' |
    // 'legacy_unchecked'); legacy rows are never truncated or auto-split.
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS claim_support TEXT`,
    `ALTER TABLE topics ADD COLUMN IF NOT EXISTS claim_atomicity_status TEXT`,
    // Typed defeaters on challenge proposals (#3691 W4).
    `ALTER TABLE proposals ADD COLUMN IF NOT EXISTS defeater_type TEXT`,
    // Independence classes v1 (#5459): the agent's verified handler-domain
    // when a mandate-bearing/verified registration exists — collapses all
    // its agents into ONE counting class in the pre-open quorum tally.
    // NULL = per-agent singleton class weighted by earned standing.
    // DERIVED, never client-writable; no write surface sets it today.
    // Additive; see lib/independence.ts for the counting rule + config.
    `ALTER TABLE agents ADD COLUMN IF NOT EXISTS independence_class TEXT`,
    // ── §6.4 provenance chain over the PACT operation log (#5566) ──────────
    // PACT v2.3 §6.4 (tightened by TailorAU/pact#60) requires a per-resource
    // monotonic GAPLESS sequence number plus a prev_hash link; a store that
    // never assigns sequenceNumber is non-conformant at Extended.
    //
    // Additive columns, NULL on every pre-#5566 row. Those rows are NEVER
    // backfilled — the chain starts at a declared genesis instead (see
    // lib/provenance-chain.ts § Genesis and docs/PROVENANCE_CHAIN.md).
    //   epoch_ms        writer-stamped ms timestamp the hash commits to
    //                   (reproducible without timestamptz precision games)
    //   sequence_number per-topic gapless counter, first chained event = 1
    //   prev_hash       previous chained event's hash, or a genesis sentinel
    //   event_hash      base64url SHA-256 over the RFC 8785 canonical event
    //   hash_alg        explicit algorithm id, so an unknown alg is REJECTED
    //                   by a consumer rather than silently skipped
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS epoch_ms BIGINT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS sequence_number BIGINT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS prev_hash TEXT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS event_hash TEXT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS hash_alg TEXT`,
    // The database-level backstop against a duplicate sequence number, which
    // §6.4 treats exactly as a hash-chain break. Postgres treats NULLs as
    // distinct, so the unchained legacy rows do not collide with each other.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_events_topic_sequence ON events(topic_id, sequence_number)`,
    // Chain-head lookup on the append path and the verifier's ordered walk.
    `CREATE INDEX IF NOT EXISTS idx_events_chain ON events(topic_id, sequence_number DESC)`,
    // ── §6.4 durable pre-history latch (#5598) ─────────────────────────────
    // The daily retention purge hard-deletes UNCHAINED (pre-#5566) event rows.
    // The verifier used to re-derive the expected genesis sentinel from a LIVE
    // count of exactly those rows, so retention doing its job silently flipped
    // an honest `GENESIS-UNCHAINED` chain to `missing-genesis` — and a resource
    // purged before its first chained append wrote a plain `GENESIS`, which
    // claims the chain covers the resource's ENTIRE history. Both defects come
    // from the same mistake: treating a live count as evidence about the past.
    //
    // This table is the evidence that outlives the rows it attests to. A row
    // means "this resource DID have unchained history". NO row means UNKNOWN —
    // never "it had none". Presence-only and MONOTONIC (false -> true, never
    // back), which is the only reason `appendChainedEvent` may consult it when
    // choosing a sentinel it will stamp permanently into `prev_hash`. Nothing
    // anywhere may remove a row from it; a repo-wide source walker in
    // provenance-chain.test.ts enforces that.
    //
    // A separate table rather than a column on `events` or `topics`, because
    // the purge-before-first-chained-append case has no chain row to hang a
    // marker on. Deliberately NO `REFERENCES topics(id)`: `events.topic_id` has
    // that FK (above), this must not. Evidence about a resource's pre-history
    // has to outlive the resource — a cascading FK would destroy the latch and
    // a restricting one would block the topic deletion. Either converts durable
    // evidence into a dangling constraint.
    //
    //   unchained_purged_count  accumulator, `+=` on every purge. REPORTING
    //                           ONLY: 0 is ambiguous (latched-but-never-purged
    //                           vs no row at all), so it is never a decision
    //                           input — presence is.
    //   first_observed_at       when this history was first RECORDED as having
    //                           existed. Written once; the purge's ON CONFLICT
    //                           branch never touches it, or the daily job would
    //                           keep resetting it to "yesterday".
    //   last_purged_at          NULL = latched, nothing deleted yet — the only
    //                           way to tell a sweep stamp from a purge stamp.
    //   origin                  which writer latched it first. NOT NULL with no
    //                           DEFAULT so a new writer must name itself;
    //                           immutable after insert. Frozen three-value
    //                           vocabulary lives in lib/retention.ts.
    //
    // No extra index: topic_id is the PK, and every access on this table is a
    // point lookup or an ON CONFLICT probe.
    `CREATE TABLE IF NOT EXISTS resource_chain_meta (
      topic_id TEXT PRIMARY KEY,
      unchained_purged_count BIGINT NOT NULL DEFAULT 0,
      first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_purged_at TIMESTAMPTZ,
      origin TEXT NOT NULL
    )`,

    // Legacy axiom-tier migration (#3691 W1): "axiom" was a privileged rank;
    // it becomes institutional warrant + the convention_stop flag, with
    // provenance kept in tier_migrated_from. Idempotent — the second UPDATE
    // leaves no 'axiom' rows for the first to match on re-run.
    `UPDATE topics SET convention_stop = 1 WHERE tier = 'axiom'`,
    `UPDATE topics SET tier_migrated_from = COALESCE(tier_migrated_from, 'axiom'), tier = 'institutional' WHERE tier = 'axiom'`,
  ];

  for (const stmt of statements) {
    await db.execute(stmt);
  }

  // ── #5598 one-shot backfill of the resource_chain_meta latch ─────────────
  // Latches every resource that has an unchained event row RIGHT NOW, so the
  // evidence exists before the 30-day boundary rather than only at the instant
  // of deletion. The stamp asserts one directly observable fact — "this
  // resource has an unchained row today" — invents no hash, touches no `events`
  // row, and is idempotent (ON CONFLICT DO NOTHING).
  //
  // TIME-BOXED, and this is why it runs at boot rather than waiting for a
  // migration window: the retention cron has returned HTTP 308 since the
  // 2026-07-02 domain cutover (#5582), so the purge has never actually run and
  // today's unchained rows are still COMPLETE. #5592 repairs that cron; from
  // the next run onward, every row it deletes without a latch is evidence lost
  // permanently, because `prev_hash` is bound into `event_hash` and a sentinel
  // cannot be corrected afterwards without fabricating a chain.
  //
  // ORDER IS LOAD-BEARING: backfill FIRST, write the sweep_state key SECOND.
  // If the stamp throws, the key stays absent and the next cold start retries.
  // Latching first would skip the backfill forever, silently — and there is no
  // second chance once the purge runs. The catch below therefore must NOT
  // write the key: a failure here is retryable, not final. It is caught at all
  // only so a backfill failure cannot brick `initSchema` and take the app down.
  try {
    if ((await readSweepState(db, CHAIN_META_BACKFILL_SWEEP_KEY)) === null) {
      // Sizing probe first — records how much evidence was still recoverable
      // at the moment this ran. Both this and the stamp below are SEQUENTIAL
      // scans of `events`: `idx_events_topic_sequence` is `(topic_id,
      // sequence_number)`, so a bare `sequence_number IS NULL` predicate has no
      // leading-column qualifier to seek on. They are affordable only because
      // the `sweep_state` gate above makes them run ONCE, ever — not on every
      // cold start. If this pair ever starts appearing in boot latency on every
      // instance, the sweep key is not being written and the real defect is a
      // throw inside this try, not the scan cost.
      const sizing = await db.execute(buildUnchainedRowCount());
      const unchainedRows = Number(sizing.rows[0]?.unchained_rows ?? 0);
      const stamped = await db.execute(buildUnchainedHistoryStamp(CHAIN_META_ORIGIN_BACKFILL));
      // Rows returned = rows actually inserted (DO NOTHING returns nothing).
      const resourcesLatched = stamped.rows.length;
      await writeSweepState(db, CHAIN_META_BACKFILL_SWEEP_KEY, String(resourcesLatched));
      console.log(
        `[chain-meta-backfill] latched ${resourcesLatched} resource(s) from ${unchainedRows} live unchained event row(s)`
      );
    }
  } catch (e) {
    // Deliberately no writeSweepState here — see the ordering note above.
    console.error("resource_chain_meta backfill failed (retries on next boot):", e);
  }

  // Seed property_development domain
  try {
    await db.execute(
      `INSERT INTO domains (id, name, description, legislation_collection, spatial_layers, scenario_clusters)
       VALUES ('property_development', 'Property Development',
         'Queensland property development — planning, zoning, TOD policy, infrastructure',
         '["QLD"]',
         '["flood_overlay","zoning","heritage","infrastructure_contributions"]',
         '["scn.au-qld-property"]')
       ON CONFLICT (id) DO NOTHING`
    );
  } catch { /* Already exists */ }

  // Ensure the Hub Protocol system agent and wallet exist
  try {
    await db.execute("INSERT INTO agents (id, name, api_key, model, framework, description) VALUES ('hub-protocol', 'Hub Protocol', 'system-no-key', 'system', 'internal', 'System wallet for protocol fees and subsidies') ON CONFLICT (id) DO NOTHING");
    await db.execute("INSERT INTO agent_wallets (agent_id, balance) VALUES ('hub-protocol', 0) ON CONFLICT (agent_id) DO NOTHING");
  } catch { /* Already exists */ }

  // Seed the authoritative ACARA v9 / EYLF curriculum slice (#2520). Idempotent
  // (ON CONFLICT DO NOTHING), so it ships the slice live on first boot and
  // back-fills new descriptors added to curriculum-seed.ts on redeploy. Unlike
  // topics (seeded out-of-band via Python scripts), curriculum is authoritative
  // and version-controlled, so it bootstraps with the app — the same way it
  // would if it were a Python seed run as a CD step, but with no manual step.
  try {
    const { seedCurriculum } = await import("./curriculum-seed");
    await seedCurriculum(db);
  } catch (e) {
    console.error("Curriculum seed failed:", e);
  }
}

type SeedTopic = {
  alias: string;
  title: string;
  content: string;
  tier: string;
  contextContent: string;
  answerContent: string;
  openQuestionsContent: string;
};

// ─── Knowledge Graph Seed Data ─────────────────────────────────────
// 7 seed topics forming a tight axiom-to-frontier chain.
// New topics are proposed organically by agents.

const SEED_TOPICS: SeedTopic[] = [
  // ── AXIOMS ──────────────────────────────────────────────────────
  {
    alias: "B1", tier: "axiom",
    title: "Energy cannot be created or destroyed, only transformed",
    content: "The first law of thermodynamics states that the total energy of an isolated system is conserved. Energy can change forms but the total quantity remains constant.",
    contextContent: "Conservation of energy is one of the most fundamental and well-tested principles in physics. It governs everything from chemical reactions to electrical circuits to gravitational systems.",
    answerContent: "The first law of thermodynamics: the total energy of an isolated system is conserved. Energy transforms between forms (kinetic, potential, thermal, electromagnetic) but the total quantity is invariant. This has been confirmed by every controlled experiment ever conducted, across all domains of physics, to extraordinary precision.",
    openQuestionsContent: "How does energy conservation interact with cosmological expansion and dark energy? What are the practical implications for computing efficiency bounds?",
  },
  {
    alias: "C1", tier: "axiom",
    title: "The speed of light in vacuum is exactly 299,792,458 m/s",
    content: "The speed of light in vacuum, denoted c, is a fundamental physical constant exactly equal to 299,792,458 metres per second. Since 2019, the metre is defined in terms of c.",
    contextContent: "The constancy of the speed of light is a postulate of special relativity and has been measured with extreme precision. It sets the ultimate speed limit for information transfer and causal influence.",
    answerContent: "c = 299,792,458 m/s exactly. Since the 2019 SI redefinition, the metre is derived from c — making this a defined constant, not a measured approximation. This sets the absolute speed limit for information transfer and causal influence in spacetime, as established by special relativity. No experiment has ever measured a violation of this constancy.",
    openQuestionsContent: "What are the engineering implications of light-speed latency for planetary-scale distributed systems? How does this constraint shape the physical limits of computation?",
  },

  // ── CONVENTIONS ─────────────────────────────────────────────────
  {
    alias: "C2", tier: "convention",
    title: "Measurements must specify units, precision, and calibration traceability",
    content: "A measurement without declared units is meaningless. A measurement without stated precision is misleading. A measurement without calibration traceability is unverifiable. The SI system provides the international standard.",
    contextContent: "Measurement standards are the backbone of science, engineering, and commerce. The SI system, maintained by BIPM, defines seven base units from which all others derive. Since 2019, all SI units are defined in terms of fundamental constants.",
    answerContent: "A measurement without declared units is meaningless. Without stated precision it is misleading. Without calibration traceability it is unverifiable. The SI system, redefined in 2019 to anchor all seven base units to physical constants, provides the international standard for all three requirements.",
    openQuestionsContent: "How should AI systems report confidence intervals on generated measurements? What happens when independent calibration chains disagree at the margins?",
  },
  {
    alias: "D2", tier: "convention",
    title: "Timestamps in distributed systems must use UTC with explicit timezone offsets",
    content: "In any system where events are generated across multiple time zones, timestamps must be stored and transmitted in UTC. Display-layer conversions to local time are acceptable, but the canonical representation must be UTC with ISO 8601 formatting.",
    contextContent: "Time synchronization is one of the hardest problems in distributed computing. Ambiguous timestamps cause ordering errors, duplicate processing, and data corruption. UTC provides a universal reference frame.",
    answerContent: "Timestamps in distributed systems must use UTC with ISO 8601 / RFC 3339 formatting as the canonical representation. Local timezone conversions are a display-layer concern only. UTC provides a universal reference frame that eliminates ambiguity across time zones and daylight saving transitions. Leap seconds should be handled by smoothing (e.g. Google's leap smear), not insertion.",
    openQuestionsContent: "Should PACT events use logical clocks (Lamport timestamps) in addition to wall-clock UTC? How should consensus handle clock skew between agent participants?",
  },

  // ── PRACTICE ────────────────────────────────────────────────────
  {
    alias: "C3", tier: "practice",
    title: "Distributed systems must handle partial failure as a normal operating condition",
    content: "In any distributed system, individual components will fail independently. Correct system design treats partial failure not as exceptional but as routine, implementing timeouts, retries with backoff, circuit breakers, and graceful degradation.",
    contextContent: "The CAP theorem and the FLP impossibility result establish fundamental limits on what distributed systems can guarantee. Network partitions, process crashes, and message loss are the normal operating environment.",
    answerContent: "In distributed systems, partial failure is the normal operating condition — not an exception. CAP theorem and FLP impossibility establish fundamental limits. Correct design requires: timeouts on all remote calls, retries with exponential backoff and jitter, circuit breakers to prevent cascade failures, idempotent operations for safe retries, and graceful degradation paths.",
    openQuestionsContent: "How should multi-agent consensus protocols handle Byzantine failures where agents produce intentionally misleading outputs? What is the optimal timeout strategy for AI agent deliberation?",
  },

  // ── POLICY ──────────────────────────────────────────────────────
  {
    alias: "C4", tier: "policy",
    title: "Critical infrastructure systems require redundancy, monitoring, and human-in-the-loop escalation",
    content: "Systems that societies depend on — power grids, communications networks, financial systems — must have N+1 redundancy at minimum, continuous automated monitoring, and mandatory human-in-the-loop escalation for high-impact decisions.",
    contextContent: "Infrastructure failures cascade. A power grid failure disables communications, which disables coordination, which delays repair. Critical systems must be designed for resilience, not just reliability.",
    answerContent: "Systems that societies depend on require: (1) N+1 redundancy for all single points of failure, (2) continuous automated monitoring with anomaly detection, (3) mandatory human-in-the-loop escalation for decisions above impact thresholds, (4) regular disaster recovery testing, (5) geographically distributed failover. Cascading failure is the primary risk — the 2003 Northeast blackout and 2021 Texas grid failure demonstrate why redundancy and human oversight are non-negotiable.",
    openQuestionsContent: "Should AI agents be permitted to make autonomous decisions in critical infrastructure during time-critical emergencies? What is the appropriate impact threshold for mandatory human escalation?",
  },

  // ── FRONTIER ────────────────────────────────────────────────────
  {
    alias: "C5", tier: "frontier",
    title: "What is the correct architecture for a quantum-safe internet that maintains current performance guarantees?",
    content: "Quantum computers will break RSA and ECC. The internet must transition to quantum-resistant cryptography while maintaining current latency, throughput, and compatibility. The correct architecture is an open question.",
    contextContent: "NIST finalized post-quantum cryptographic standards in 2024. The challenge is not the algorithms but the transition: billions of devices, decades of legacy protocols, and performance trade-offs that quantum-resistant algorithms impose.",
    answerContent: "OPEN FRONTIER — no consensus exists. NIST finalized CRYSTALS-Kyber and CRYSTALS-Dilithium in 2024, but the transition architecture — migrating billions of devices while maintaining current latency and throughput — is unsolved. Leading approaches include hybrid classical+PQ TLS and staged migration starting with certificate infrastructure.",
    openQuestionsContent: "What is the realistic timeline before cryptographically relevant quantum computers exist? Should the transition prioritize harvest-now-decrypt-later threats? How should key sizes for lattice-based cryptography balance security against performance?",
  },

  // ── ASSUMPTIONS ─────────────────────────────────────────────────
  {
    alias: "A-B1-1", tier: "axiom",
    title: "The laws of thermodynamics apply universally across all physical systems",
    content: "The laws of thermodynamics govern all macroscopic physical processes without known exception. This universality is assumed by any claim built on energy conservation.",
    contextContent: "Thermodynamics emerged from 19th-century studies of heat engines but has proven universal — applying to chemistry, biology, astrophysics, and quantum systems. No reproducible violation has ever been observed.",
    answerContent: "The four laws of thermodynamics (zeroth through third) apply to all macroscopic physical systems. This universality has been confirmed across every domain of physics, from stellar nucleosynthesis to biological metabolism to semiconductor fabrication. No controlled experiment has ever produced a reproducible violation.",
    openQuestionsContent: "Do the laws of thermodynamics require modification at the quantum-gravity scale? How do they interact with information-theoretic entropy (Landauer's principle)?",
  },
  {
    alias: "A-B1-2", tier: "axiom",
    title: "Energy is a well-defined, measurable quantity with consistent units",
    content: "Energy can be quantified using SI units (joules) and measured through well-established experimental techniques. The quantity is conserved, frame-dependent but invariant under the same reference frame.",
    contextContent: "The concept of energy was formalized in the 19th century. Today it is measured with extraordinary precision using calorimetry, spectroscopy, and electrical methods, all traceable to SI standards.",
    answerContent: "Energy is a scalar quantity measured in joules (kg·m²/s²) in SI units. It is well-defined for any physical system through the Hamiltonian formalism. Measurement techniques (calorimetry, spectroscopy, electrical power measurement) achieve precisions of parts per billion, all traceable to fundamental constants via the 2019 SI redefinition.",
    openQuestionsContent: "How should energy accounting work for quantum systems in superposition? What are the limits of energy measurement precision?",
  },
  {
    alias: "A-B1-3", tier: "axiom",
    title: "Isolated systems can exist or be approximated in practice",
    content: "The concept of an isolated system — one that exchanges neither matter nor energy with its surroundings — is physically realizable to sufficient approximation for the first law of thermodynamics to hold experimentally.",
    contextContent: "Perfect isolation is an idealization, but experimental physics routinely achieves isolation sufficient for energy conservation to be verified. Vacuum chambers, cryogenic shielding, and electromagnetic isolation make this practical.",
    answerContent: "Perfectly isolated systems are theoretical idealizations. However, systems can be isolated to arbitrary precision using vacuum chambers, cryogenic shielding, Faraday cages, and vibration isolation. The degree of isolation achieved in modern experiments is sufficient to verify energy conservation to parts-per-billion precision. The first law of thermodynamics holds in practice because sufficient isolation is achievable.",
    openQuestionsContent: "At what scale does quantum decoherence make isolation fundamentally impossible? Does Hawking radiation imply that even black holes are not truly isolated?",
  },
  {
    alias: "A-C1-1", tier: "axiom",
    title: "Special relativity accurately describes light propagation in vacuum",
    content: "Einstein's theory of special relativity, including the constancy of the speed of light in all inertial frames, accurately describes electromagnetic wave propagation in vacuum.",
    contextContent: "Special relativity has been tested with extreme precision through particle accelerator experiments, GPS satellite corrections, and Michelson-Morley type experiments. It is one of the most thoroughly validated theories in physics.",
    answerContent: "Special relativity, published by Einstein in 1905, postulates that the laws of physics are the same in all inertial reference frames and that the speed of light in vacuum is the same for all observers. This has been confirmed by Michelson-Morley interferometry (null result for ether), time dilation in muon decay, relativistic mass increase in particle accelerators, and GPS satellite clock corrections. No experiment has ever contradicted special relativity within its domain of validity.",
    openQuestionsContent: "Does special relativity break down at the Planck scale? How does it reconcile with quantum entanglement (no faster-than-light signaling, but correlated measurements)?",
  },
  {
    alias: "A-C1-2", tier: "axiom",
    title: "The speed of light is constant in all inertial reference frames",
    content: "The speed of light in vacuum, c, is the same for all observers in uniform motion. This is the second postulate of special relativity and has been confirmed by every experimental test.",
    contextContent: "The constancy of c was revolutionary when proposed and seemed to contradict Galilean relativity. Over a century of experiments — from Michelson-Morley to modern laser interferometry — have confirmed it without exception.",
    answerContent: "The speed of light in vacuum is invariant: it measures exactly 299,792,458 m/s regardless of the motion of the source or observer. This has been confirmed by: Michelson-Morley experiments (1887 onward), Kennedy-Thorndike experiments (testing velocity dependence), Ives-Stilwell experiments (testing time dilation), and modern one-way speed measurements using synchronized atomic clocks. The constancy of c is not merely observed — since 2019 it is definitional, as the metre is derived from c.",
    openQuestionsContent: "Could the speed of light vary over cosmological timescales (varying speed of light theories)? Does c remain constant inside extreme gravitational fields (general relativity says locally yes)?",
  },
  {
    alias: "A-C1-3", tier: "axiom",
    title: "The SI metre is correctly defined in terms of the speed of light",
    content: "Since the 2019 SI redefinition, the metre is defined as the distance light travels in vacuum in 1/299,792,458 of a second. This makes c a defined constant rather than a measured value.",
    contextContent: "The metre was originally defined as one ten-millionth of the distance from the equator to the North Pole, then by a platinum-iridium bar, then by krypton spectral lines. The 2019 redefinition anchors it to c, making the value of c exact by definition.",
    answerContent: "The 26th General Conference on Weights and Measures (2018, effective 2019) redefined the SI metre as the distance light travels in vacuum in exactly 1/299,792,458 of a second. This means c = 299,792,458 m/s is an exact defined constant, not a measurement. The definition is self-consistent and traceable: time is defined via the caesium-133 hyperfine transition, and the metre derives from time plus c.",
    openQuestionsContent: "Are there practical metrology challenges with the light-based definition at extreme scales (nanometer, astronomical)? Could future SI revisions change this definition?",
  },
  {
    alias: "A-C2-1", tier: "axiom",
    title: "Objective measurement of physical quantities is possible",
    content: "Physical quantities (length, mass, time, temperature, etc.) can be measured objectively by independent observers using calibrated instruments, yielding consistent results within stated uncertainties.",
    contextContent: "The possibility of objective measurement is the foundation of empirical science. Reproducibility of measurements by independent teams is the gold standard for scientific claims.",
    answerContent: "Objective measurement is possible: independent observers using calibrated instruments can measure the same physical quantity and obtain consistent results within stated measurement uncertainties. This is demonstrated daily across science and engineering — from particle physics (independent labs reproducing measurements of fundamental constants) to manufacturing (interchangeable parts requiring micrometer-precision measurement agreement). Measurement uncertainty can be quantified and reduced through better instruments and techniques.",
    openQuestionsContent: "Does quantum mechanics place fundamental limits on objective measurement (observer effect, measurement problem)? How do we handle measurements where the act of measuring changes the quantity?",
  },
  {
    alias: "A-C2-2", tier: "axiom",
    title: "The SI system provides a sufficient basis for scientific measurement",
    content: "The International System of Units (SI), with its seven base units defined in terms of fundamental physical constants, provides a complete and sufficient framework for scientific and engineering measurement.",
    contextContent: "The SI system is maintained by the International Bureau of Weights and Measures (BIPM) and adopted by virtually all nations. The 2019 redefinition anchored all seven base units to exact values of fundamental constants.",
    answerContent: "The SI system defines seven base units (second, metre, kilogram, ampere, kelvin, mole, candela), each anchored to an exact value of a fundamental constant since the 2019 redefinition. All derived units (newton, joule, watt, pascal, etc.) follow from these seven. The SI provides sufficient basis for measurement in all domains of science and engineering. Non-SI units (electronvolt, astronomical unit, etc.) are defined in terms of SI units for convenience but are not necessary.",
    openQuestionsContent: "Are seven base units the minimum needed, or could the system be simplified? How should SI handle information-theoretic quantities (bits, qubits)?",
  },
  {
    alias: "A-D2-1", tier: "axiom",
    title: "A universal time reference frame is necessary for distributed coordination",
    content: "Any system with components operating across different locations or time zones requires a shared, unambiguous time reference to correctly order events and maintain consistency.",
    contextContent: "Distributed systems face the fundamental challenge of ordering events across nodes that cannot share a single clock. Without a universal time reference, event ordering becomes ambiguous and data consistency is compromised.",
    answerContent: "Distributed coordination requires a shared time reference because: (1) local clocks drift and cannot be perfectly synchronized, (2) event ordering across nodes requires a common frame, (3) causality violations (effect before cause) must be detectable, (4) data consistency protocols (Paxos, Raft, 2PC) depend on timeout mechanisms. Lamport proved that without a shared time notion, even the relative ordering of events is undecidable in asynchronous systems.",
    openQuestionsContent: "Can logical clocks (Lamport, vector clocks) fully replace wall-clock time for coordination? What happens when relativistic effects make simultaneity frame-dependent?",
  },
  {
    alias: "A-D2-2", tier: "axiom",
    title: "UTC is the best available universal time standard",
    content: "Coordinated Universal Time (UTC), maintained by the International Bureau of Weights and Measures, is the most widely adopted and practically useful universal time standard for computing and distributed systems.",
    contextContent: "Alternatives to UTC include TAI (no leap seconds), GPS time, and various astronomical time scales. UTC's combination of atomic clock precision with approximate alignment to solar time makes it the practical standard.",
    answerContent: "UTC is the best available universal time standard for distributed systems because: (1) it is maintained by BIPM using a weighted average of 400+ atomic clocks worldwide, (2) it is legally recognized in virtually all jurisdictions, (3) it is the basis of NTP, GPS, and internet time synchronization, (4) it provides sub-microsecond precision via atomic timekeeping. While TAI (International Atomic Time) is more uniform (no leap seconds), UTC's near-universal adoption makes it the practical choice.",
    openQuestionsContent: "Should leap seconds be abolished (as proposed for 2035)? Would TAI be superior for purely computational systems? How should UTC handle relativistic time dilation for space-based systems?",
  },
  {
    alias: "A-C3-1", tier: "axiom",
    title: "Network partitions are inevitable in geographically distributed systems",
    content: "In any system with components connected over a network spanning significant geographic distance, network partitions (communication failures between subsets of nodes) will occur. This is not a question of if, but when.",
    contextContent: "Network partitions occur due to fiber cuts, router failures, BGP misconfigurations, DNS outages, and congestion collapse. Major cloud providers experience multiple partition events per year despite massive infrastructure investment.",
    answerContent: "Network partitions are inevitable because: (1) physical infrastructure (fiber optic cables, routers, switches) fails due to hardware wear, construction damage, natural disasters, and power outages, (2) software failures (BGP misconfigurations, DNS cache poisoning, firmware bugs) cause logical partitions, (3) the probability of zero failures across N components decreases exponentially with N, (4) empirical data from cloud providers confirms multiple partition events annually. Designing systems that assume no partitions is engineering malpractice.",
    openQuestionsContent: "Can quantum networks fundamentally change the partition landscape? What is the minimum redundancy needed to achieve a given partition tolerance level?",
  },
  {
    alias: "A-C3-2", tier: "axiom",
    title: "The CAP theorem and FLP impossibility result are mathematically proven",
    content: "The CAP theorem (Brewer/Gilbert-Lynch, 2002) and the FLP impossibility result (Fischer-Lynch-Paterson, 1985) are formally proven mathematical theorems that establish fundamental limits on distributed systems.",
    contextContent: "CAP proves that a distributed system cannot simultaneously guarantee Consistency, Availability, and Partition tolerance. FLP proves that deterministic consensus is impossible in an asynchronous system with even one possible crash failure.",
    answerContent: "The CAP theorem (proved by Gilbert and Lynch, 2002) establishes that no distributed system can simultaneously provide all three of: Consistency (every read receives the most recent write), Availability (every request receives a response), and Partition tolerance (the system operates despite network partitions). The FLP impossibility result (Fischer, Lynch, Paterson, 1985) proves that no deterministic protocol can guarantee consensus in an asynchronous system if even one process may crash. Both are peer-reviewed, formally proven mathematical theorems — not conjectures or empirical observations.",
    openQuestionsContent: "Do relaxed consistency models (eventual consistency, CRDTs) fundamentally bypass CAP, or just trade off differently? Can randomized protocols fully circumvent FLP?",
  },
  {
    alias: "A-C4-1", tier: "axiom",
    title: "Infrastructure failures cascade through dependent systems",
    content: "When a critical infrastructure component fails, the failure propagates through systems that depend on it, often amplifying the impact. Cascade failure is the primary risk mode for interconnected infrastructure.",
    contextContent: "Historical cascade failures include the 2003 Northeast blackout (55 million affected), the 2021 Texas grid failure, and the 2017 S3 outage that took down much of the internet. Each demonstrated that failures propagate faster than human operators can respond.",
    answerContent: "Infrastructure cascade failure is well-documented: (1) the 2003 Northeast blackout started with untrimmed trees touching power lines and cascaded to affect 55 million people across 8 US states and Canada, (2) the 2021 Texas grid failure cascaded from frozen natural gas wellheads to power generation to water treatment, (3) the 2017 AWS S3 outage cascaded to take down services across the internet. The pattern is consistent: tightly coupled systems without isolation boundaries propagate failures faster than human operators can intervene.",
    openQuestionsContent: "Can AI-driven monitoring detect and halt cascades faster than human operators? What is the optimal granularity of isolation boundaries in infrastructure design?",
  },
  {
    alias: "A-C4-2", tier: "axiom",
    title: "Human judgment is necessary for high-impact decisions beyond automated thresholds",
    content: "Decisions that affect large populations, involve irreversible consequences, or operate in novel situations outside training data require human judgment. Full automation of high-impact decisions is not yet safe or appropriate.",
    contextContent: "Automated systems excel at speed and consistency but struggle with novel situations, ethical trade-offs, and contextual judgment. Every major automated system failure (Boeing 737 MAX, Flash Crash) involved automation operating beyond its competence boundary without human oversight.",
    answerContent: "Human judgment remains necessary for high-impact decisions because: (1) automated systems have bounded competence — they fail on out-of-distribution inputs, (2) ethical trade-offs require value judgments that cannot be fully specified in code, (3) irreversible decisions need a human accountability chain, (4) novel situations (by definition) have no training data. The Boeing 737 MAX crashes (346 deaths) and the 2010 Flash Crash ($1T evaporated in minutes) demonstrate the consequences of automated systems operating beyond their competence boundary without human override capability.",
    openQuestionsContent: "At what capability level could AI systems be trusted with autonomous high-impact decisions? How do we define the impact threshold for mandatory human escalation?",
  },
  {
    alias: "A-C4-3", tier: "axiom",
    title: "Redundancy reduces single-point-of-failure risk",
    content: "Adding redundant components (N+1 or higher) to a system reduces the probability that any single component failure causes total system failure. This is a fundamental principle of reliability engineering.",
    contextContent: "Redundancy is applied universally in critical systems: aircraft have multiple engines and flight computers, data centers have backup power and network paths, financial systems have hot standby replicas.",
    answerContent: "Redundancy reduces single-point-of-failure risk by mathematical necessity: if a component has failure probability p, then N independent redundant copies have simultaneous failure probability p^N. N+1 redundancy means the system can tolerate one failure with zero downtime. This principle is applied universally: aircraft (dual engines, triple-redundant fly-by-wire), data centers (UPS + diesel generators + utility feeds), networks (multi-path routing), and databases (primary + replica + failover). The reliability improvement is multiplicative, not additive.",
    openQuestionsContent: "When does adding redundancy introduce more complexity-related failure modes than it prevents? How do correlated failures (common cause) undermine independence assumptions?",
  },
  {
    alias: "A-C5-1", tier: "axiom",
    title: "Sufficiently powerful quantum computers will eventually exist",
    content: "Quantum computers capable of running Shor's algorithm at scale (thousands of logical qubits with error correction) will eventually be built, though the timeline is uncertain.",
    contextContent: "As of 2024, the largest quantum computers have ~1000 physical qubits but lack the error correction needed for cryptographically relevant computation. The trajectory of investment and progress suggests eventual success, but timelines range from 10 to 30+ years.",
    answerContent: "The consensus among quantum computing researchers is that cryptographically relevant quantum computers (CRQC) will eventually exist, based on: (1) no known physical law prohibits them, (2) quantum error correction theory is mathematically sound, (3) steady progress in qubit count, coherence times, and gate fidelity, (4) massive investment ($30B+ globally as of 2024). Timeline estimates vary widely — the NSA and NIST assume planning for a 10-15 year horizon. The question is when, not if.",
    openQuestionsContent: "Could there be an unknown physical barrier that prevents scaling quantum computers? What is the most realistic timeline estimate based on current error rates and scaling trends?",
  },
  {
    alias: "A-C5-2", tier: "axiom",
    title: "RSA and ECC are vulnerable to Shor's algorithm on quantum hardware",
    content: "Shor's algorithm, running on a sufficiently powerful quantum computer, can factor large integers and compute discrete logarithms in polynomial time, breaking RSA and ECC encryption.",
    contextContent: "Shor's algorithm was published in 1994 and is a proven mathematical result. It requires a quantum computer with thousands of error-corrected logical qubits — far beyond current capabilities, but within the trajectory of the field.",
    answerContent: "Shor's algorithm (1994) factors N-bit integers in O(N³) time on a quantum computer, compared to the best classical algorithm's sub-exponential time. This breaks RSA (which depends on factoring hardness) and ECC (which depends on discrete logarithm hardness). The algorithm is a proven mathematical result — the only question is hardware capability. NIST estimates that a 2048-bit RSA key requires approximately 4,000 logical qubits (millions of physical qubits with error correction). Current hardware is far from this, but NIST initiated post-quantum cryptography standardization in 2016 precisely because the threat is considered inevitable.",
    openQuestionsContent: "Could improvements to Shor's algorithm reduce qubit requirements further? Are there classical algorithms that could break RSA/ECC without quantum hardware?",
  },
];

// ─── Dependency Edges ──────────────────────────────────────────────
const SEED_DEPENDENCIES: { from: string; to: string; relationship?: string }[] = [
  { from: "C2", to: "C1" }, { from: "C2", to: "B1" },
  { from: "D2", to: "C2" },
  { from: "C3", to: "C2" }, { from: "C3", to: "D2" },
  { from: "C4", to: "C3" },
  { from: "C5", to: "C4" },
  { from: "B1", to: "A-B1-1", relationship: "assumes" },
  { from: "B1", to: "A-B1-2", relationship: "assumes" },
  { from: "B1", to: "A-B1-3", relationship: "assumes" },
  { from: "C1", to: "A-C1-1", relationship: "assumes" },
  { from: "C1", to: "A-C1-2", relationship: "assumes" },
  { from: "C1", to: "A-C1-3", relationship: "assumes" },
  { from: "C2", to: "A-C2-1", relationship: "assumes" },
  { from: "C2", to: "A-C2-2", relationship: "assumes" },
  { from: "D2", to: "A-D2-1", relationship: "assumes" },
  { from: "D2", to: "A-D2-2", relationship: "assumes" },
  { from: "C3", to: "A-C3-1", relationship: "assumes" },
  { from: "C3", to: "A-C3-2", relationship: "assumes" },
  { from: "C4", to: "A-C4-1", relationship: "assumes" },
  { from: "C4", to: "A-C4-2", relationship: "assumes" },
  { from: "C4", to: "A-C4-3", relationship: "assumes" },
  { from: "C5", to: "A-C5-1", relationship: "assumes" },
  { from: "C5", to: "A-C5-2", relationship: "assumes" },
];

async function seedIfEmpty(db: DbClient) {
  const result = await db.execute("SELECT COUNT(*) as c FROM topics");
  const count = result.rows[0]?.c as number;
  if (count >= SEED_TOPICS.length) return;

  const aliasToId = new Map<string, string>();

  for (const topic of SEED_TOPICS) {
    const topicId = uuid();
    try {
      await db.execute({
        sql: "INSERT INTO topics (id, title, content, tier, status) VALUES (?, ?, ?, ?, 'open')",
        args: [topicId, topic.title, topic.content, topic.tier],
      });
    } catch {
      const existing = await db.execute({
        sql: "SELECT id FROM topics WHERE title = ?",
        args: [topic.title],
      });
      if (existing.rows.length > 0) {
        aliasToId.set(topic.alias, existing.rows[0].id as string);
      }
      continue;
    }

    aliasToId.set(topic.alias, topicId);

    const contextId = `sec:context-${topicId.slice(0, 8)}`;
    const answerId = `sec:answer-${topicId.slice(0, 8)}`;
    const openQId = `sec:openq-${topicId.slice(0, 8)}`;

    await db.execute({
      sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      args: [contextId, topicId, "Context", 2, topic.contextContent, 0],
    });
    await db.execute({
      sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      args: [answerId, topicId, "Answer", 2, topic.answerContent, 1],
    });
    await db.execute({
      sql: "INSERT INTO sections (id, topic_id, heading, level, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      args: [openQId, topicId, "Open Questions", 2, topic.openQuestionsContent, 2],
    });

    const token = `pact_open_${topicId.slice(0, 12)}`;
    await db.execute({
      sql: "INSERT INTO invite_tokens (token, topic_id, label, max_uses) VALUES (?, ?, ?, ?)",
      args: [token, topicId, "Open public invite", 999999],
    });
  }

  for (const dep of SEED_DEPENDENCIES) {
    const fromId = aliasToId.get(dep.from);
    const toId = aliasToId.get(dep.to);
    if (fromId && toId) {
      try {
        await db.execute({
          sql: "INSERT INTO topic_dependencies (topic_id, depends_on, relationship) VALUES (?, ?, ?)",
          args: [fromId, toId, dep.relationship ?? "builds_on"],
        });
      } catch {
        // Already exists
      }
    }
  }
}

// ─── Cycle Detection ─────────────────────────────────────────────
export async function wouldCreateCycle(db: DbClient, topicId: string, dependsOn: string): Promise<boolean> {
  if (topicId === dependsOn) return true;
  const visited = new Set<string>();
  const queue = [dependsOn];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === topicId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = await db.execute({
      sql: "SELECT depends_on FROM topic_dependencies WHERE topic_id = ?",
      args: [current],
    });
    for (const row of deps.rows) {
      queue.push(row.depends_on as string);
    }
  }
  return false;
}

export const VALID_RELATIONSHIPS = ["builds_on", "assumes"] as const;
export type DependencyRelationship = (typeof VALID_RELATIONSHIPS)[number];

/**
 * The single writer for the KG's PACT operation log — and, since #5566, the
 * single point at which a §6.4 provenance chain link is minted.
 *
 * Every event goes onto its resource's hash chain: a gapless per-topic
 * `sequenceNumber`, a `prev_hash` pointing at the previous event's hash, and
 * its own `event_hash` over the RFC 8785 canonical encoding. The whole
 * assignment runs inside ONE transaction (`db.transaction`), so a failure to
 * chain rolls the event back and THROWS — it fails the operation rather than
 * silently writing an unchained row. That transactional boundary is what
 * stops the audit-log's deliberate best-effort posture (see lib/audit.ts)
 * from applying to the chained stream.
 *
 * A `DbClient` without `transaction` (only test mocks; every production
 * client implements it) still gets a fully chained, still-throwing append —
 * only the all-or-nothing atomicity depends on the client.
 */
export async function emitEvent(
  db: DbClient,
  topicId: string,
  type: string,
  agentId?: string,
  sectionId?: string,
  data?: Record<string, unknown>
) {
  const input = {
    topicId,
    eventType: type,
    agentId: agentId ?? null,
    sectionId: sectionId ?? null,
    payloadJson: data ? JSON.stringify(data) : null,
  };

  // Already inside a caller's transaction ⇒ the chain link is assigned in
  // the SAME transaction as the state change that transaction is recording.
  if (db.inTransaction || !db.transaction) {
    await appendChainedEvent(db, input);
    return;
  }

  await db.transaction((tx) => appendChainedEvent(tx, input));
}

export async function autoMergeExpired(db: DbClient, sweepOptions: ConsensusSweepOptions = {}) {
  const result = await db.execute(`
    SELECT p.* FROM proposals p
    WHERE p.status = 'pending'
      AND p.created_at + p.ttl_seconds * INTERVAL '1 second' <= NOW()
      AND NOT EXISTS (
        SELECT 1 FROM votes v WHERE v.proposal_id = p.id AND v.vote_type = 'object'
      )
      AND EXISTS (
        SELECT 1 FROM votes v WHERE v.proposal_id = p.id AND v.vote_type = 'approve'
      )
  `);

  for (const p of result.rows) {
    await db.execute({
      sql: "UPDATE proposals SET status = 'merged', resolved_at = NOW() WHERE id = ?",
      args: [p.id as string],
    });
    if (p.proposal_type === "canonicalize") {
      await db.execute({
        sql: "UPDATE topics SET canonical_claim = ? WHERE id = ?",
        args: [p.new_content as string, p.topic_id as string],
      });
    } else {
      await db.execute({
        sql: "UPDATE sections SET content = ? WHERE id = ? AND topic_id = ?",
        args: [p.new_content as string, p.section_id as string, p.topic_id as string],
      });
    }
    await db.execute({
      sql: "UPDATE agents SET proposals_approved = proposals_approved + 1 WHERE id = ?",
      args: [p.agent_id as string],
    });
    await emitEvent(db, p.topic_id as string, "pact.proposal.auto-merged", p.agent_id as string, p.section_id as string, { proposalId: p.id as string });
  }

  await evaluateTopicProposals(db);
  await updateConsensusStatuses(db, sweepOptions);
  await evaluateChallenges(db);

  return result.rows.length;
}

// #5425 — Postgres advisory-lock key for the consensus sweep. Arbitrary
// app-unique constant; only this code path uses it. Session-level lock,
// acquired and released on the SAME pooled connection (see below).
export const CONSENSUS_SWEEP_LOCK_KEY = 542501;

/**
 * #5425 — the ONLY production entry point to the consensus engine.
 * Cron routes (/api/cron/auto-merge, /api/cron/cleanup) call this; no read
 * path invokes the engine any more (a source-level test enforces that).
 *
 * The whole sweep runs on ONE dedicated pooled connection so the
 * session-level advisory lock is guaranteed to be released by the same
 * session that acquired it (pool.query round-robins connections, which
 * would strand the lock). When the lock is already held — an overlapping
 * sweep elsewhere — the sweep is skipped with a single log line rather
 * than double-running promotions.
 */
export async function runConsensusSweep(
  sweepOptions: ConsensusSweepOptions = {}
): Promise<{ ran: boolean; merged: number }> {
  const sweepStartedAt = Date.now();
  await getDb(); // ensure the schema is initialized via the normal path
  const pool = getPool();
  const client = await pool.connect();
  const scoped: DbClient = {
    async execute(stmtOrSql) {
      const sql = typeof stmtOrSql === "string" ? stmtOrSql : stmtOrSql.sql;
      const args = typeof stmtOrSql === "string" ? [] : stmtOrSql.args;
      const result = await client.query(pgify(sql), args);
      return { rows: result.rows, rowsAffected: result.rowCount ?? 0 };
    },
    async batch(stmts) {
      try {
        await client.query("BEGIN");
        for (const stmt of stmts) {
          await client.query(pgify(stmt.sql), stmt.args);
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    },
    // #5566 — the sweep emits chained events too. It holds a SESSION-level
    // advisory lock on this connection but no open transaction, so a real
    // BEGIN/COMMIT here is correct (and the session lock survives it: the
    // §6.4 append's per-resource lock lives in the two-int4 advisory space,
    // which never collides with this one-bigint key).
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      try {
        await client.query("BEGIN");
        const result = await fn(createTransactionScopedClient(client));
        await client.query("COMMIT");
        return result;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection already unusable — the transaction is aborted regardless */
        }
        throw e;
      }
    },
  };
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [CONSENSUS_SWEEP_LOCK_KEY]
    );
    if (lockResult.rows[0]?.acquired !== true) {
      console.log("Consensus sweep skipped: advisory lock held by a concurrent sweep");
      return { ran: false, merged: 0 };
    }
    try {
      const merged = await autoMergeExpired(scoped, sweepOptions);
      console.log(`[consensus-sweep] full sweep completed in ${Date.now() - sweepStartedAt}ms (merged=${merged})`);
      return { ran: true, merged };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [CONSENSUS_SWEEP_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

// ─── Topic Proposal Evaluation ──────────────────────────────────────

/**
 * Quorum transition for a single topic that has reached the approval
 * threshold. Shared by the sweep (`evaluateTopicProposals`) and the vote
 * route's threshold branch (#5277) so that quorum reached via
 * POST /api/pact/{topicId}/vote triggers the SAME legislation auto-ingest
 * path as the sweep — previously the vote route flipped the topic straight
 * to 'open', which the sweep (scanning only status='proposed') could never
 * ingest afterwards.
 *
 * Legislation proposals: ingest the proposed document, mark the topic
 * 'consensus', emit `pact.legislation.ingested`. Everything else (including
 * a legislation proposal whose payload is missing/corrupt, or whose ingest
 * throws): open the topic for debate and emit `pact.topic.approved`.
 *
 * #5425 guard: this transition can NEVER run on a topic that has left
 * 'proposed' — in particular a 'rejected' topic (terminal) is re-checked
 * here and every status UPDATE is conditional on status = 'proposed', so a
 * concurrent rejection cannot be overwritten by a late approval tally.
 * Returns "skipped" when the topic is no longer 'proposed'.
 */
export async function finalizeApprovedTopic(
  db: DbClient,
  topicId: string,
  title: string,
  approvals: number,
  quorum: number = DEFAULT_BASE
): Promise<"ingested" | "opened" | "skipped"> {
  // #5425 — re-read the live status: never approve a topic that already
  // transitioned (rejected topics are terminal).
  const current = await db.execute({
    sql: "SELECT status FROM topics WHERE id = ?",
    args: [topicId],
  });
  if ((current.rows[0]?.status as string | undefined) !== "proposed") {
    return "skipped";
  }

  // §25.6 (#5535) — the second apply path. Reaching the pre-open approval
  // quorum is a protocol state, so the ingest + promotion below is guarded
  // exactly like the consensus sweep's. Fail-closed: an unclassified or
  // guarded resource type refuses the apply and the topic falls through to
  // 'open' (debate), never to 'consensus'.
  const applyGuard = evaluateApplyGuard({
    resourceType: KG_APPLY_RESOURCE_TYPE,
    policy: "quorum",
  });

  // Auto-ingest legislation proposals on consensus
  if (applyGuard.allowed && title.startsWith("[Legislation Proposal]")) {
    try {
      const legislationEvent = await db.execute({
        sql: "SELECT data FROM events WHERE topic_id = ? AND type = 'pact.legislation.proposed' LIMIT 1",
        args: [topicId],
      });
      if (legislationEvent.rows.length > 0) {
        const payload = JSON.parse(legislationEvent.rows[0].data as string);
        if (payload.document) {
          const { ingestDocuments } = await import("./legislation-sync");
          await ingestDocuments(db, [payload.document]);
          const updated = await db.execute({
            sql: "UPDATE topics SET status = 'consensus' WHERE id = ? AND status = 'proposed'",
            args: [topicId],
          });
          if ((updated.rowsAffected ?? 0) === 0) return "skipped";
          await emitEvent(db, topicId, "pact.legislation.ingested", payload.proposedBy || "", "", {
            approvals,
            docId: payload.document.id,
            title: payload.document.title,
            sectionsCount: payload.document.sections?.length ?? 0,
          });
          return "ingested";
        }
      }
    } catch (e) {
      console.error(`Legislation auto-ingest failed for topic ${topicId}:`, e);
    }
  } else if (!applyGuard.allowed && title.startsWith("[Legislation Proposal]")) {
    // §25.9 — the block is the audit artifact, so it is emitted even though
    // the topic still opens for debate below.
    await emitEvent(db, topicId, APPLY_BLOCKED_EVENT, "", "", {
      effect_class: applyGuard.effectClass,
      human_attestation: applyGuard.humanAttestation,
      required_principals: applyGuard.requiredPrincipals,
      reason: applyGuard.reason,
      policy: applyGuard.policy,
    });
  }

  const opened = await db.execute({
    sql: "UPDATE topics SET status = 'open' WHERE id = ? AND status = 'proposed'",
    args: [topicId],
  });
  if ((opened.rowsAffected ?? 0) === 0) return "skipped";
  await emitEvent(db, topicId, "pact.topic.approved", "", "", {
    approvals,
    threshold: quorum,
    title,
  });
  return "opened";
}

/**
 * #5425 — first-class rejection transition. A proposed topic whose reject
 * count reaches the SAME tier-based quorum it would need to approve
 * (getTopicApprovalQuorum) — before approvals reach theirs — transitions to
 * the terminal 'rejected' status. Rejected legislation proposals never
 * ingest; rejected topics never open, never enter the consensus sweep's
 * promotion phases, and refuse further votes/proposals at the routes.
 *
 * The UPDATE is conditional on status = 'proposed' so a concurrent
 * approval/rejection cannot double-fire: returns false (and emits nothing)
 * when the topic already transitioned.
 */
export async function finalizeRejectedTopic(
  db: DbClient,
  topicId: string,
  title: string,
  rejections: number,
  quorum: number
): Promise<boolean> {
  const updated = await db.execute({
    sql: "UPDATE topics SET status = 'rejected' WHERE id = ? AND status = 'proposed'",
    args: [topicId],
  });
  if ((updated.rowsAffected ?? 0) === 0) return false;
  await emitEvent(db, topicId, "pact.topic.rejected", "", "", {
    rejections,
    threshold: quorum,
    title,
  });
  return true;
}

// ─── Independence-class vote tally (#5459) ─────────────────────────

export interface TopicVoteTallyRow extends TalliedVote {
  agentName: string;
  independenceClass: string | null;
  reason: string | null;
  createdAt: string | null;
  needInfoTopicId: string | null;
}

export interface TopicVoteTally {
  mode: CountingMode;
  approvals: number;
  rejections: number;
  needInfo: number;
  countedApprovals: number;
  countedRejections: number;
  votes: TopicVoteTallyRow[];
}

/**
 * #5459 — the single tally used by the vote route (GET + POST) and the
 * sweep (evaluateTopicProposals). Fetches every vote on the topic with the
 * voter's class + standing metadata, then applies the PURE counting rule
 * from lib/independence.ts:
 *
 *   class-v1  — quorum satisfaction counts DISTINCT independence classes;
 *               the proposer's class (role='creator') is excluded from its
 *               own proposal's count; singleton classes count only with
 *               earned standing (age + accepted contributions). Approve
 *               and reject are counted symmetrically.
 *   legacy    — the pre-#5459 raw counting, kept for grandfathered topics
 *               (created before INDEPENDENCE_CONFIG.grandfatherCutoff).
 *
 * Accepted contributions (v1, documented): merged proposals + credit
 * receipts other than starter credits — the existing credits machinery.
 * Non-counting votes stay recorded and visible (counted=false + reason).
 */
let _loggedCountingCutoff = false;

export async function computeTopicVoteTally(
  db: DbClient,
  topicId: string,
  mode: CountingMode
): Promise<TopicVoteTally> {
  if (!_loggedCountingCutoff) {
    _loggedCountingCutoff = true;
    console.log(
      `[#5459] independence-class vote counting v1 active; grandfather cutoff ` +
      `${INDEPENDENCE_CONFIG.grandfatherCutoff} — topics created before it tally under legacy raw counting`
    );
  }
  const voteRows = await db.execute({
    sql: `SELECT tv.agent_id, tv.vote_type, tv.reason, tv.created_at, tv.need_info_topic_id,
        a.name AS agent_name, a.independence_class,
        EXTRACT(EPOCH FROM NOW() - a.created_at) / 86400.0 AS agent_age_days,
        (SELECT COUNT(*) FROM proposals p WHERE p.agent_id = tv.agent_id AND p.status = 'merged') AS merged_contributions,
        (SELECT COUNT(*) FROM ledger_txs lt WHERE lt.to_wallet = tv.agent_id AND lt.reason != 'starter-credits') AS earned_credit_events
      FROM topic_votes tv
      JOIN agents a ON a.id = tv.agent_id
      WHERE tv.topic_id = ?
      ORDER BY tv.created_at ASC`,
    args: [topicId],
  });

  // The proposer's counting class(es) — excluded from the topic's own
  // quorum count in class mode (spec §5 allowSelfApproval defaults false).
  const proposerClassKeys = new Set<string>();
  if (mode === "class-v1") {
    const creators = await db.execute({
      sql: `SELECT r.agent_id, a.independence_class
            FROM registrations r
            JOIN agents a ON a.id = r.agent_id
            WHERE r.topic_id = ? AND r.role = 'creator'`,
      args: [topicId],
    });
    for (const row of creators.rows) {
      proposerClassKeys.add(
        deriveClassKey(row.agent_id as string, row.independence_class as string | null)
      );
    }
  }

  const tallyInput: (TallyVote & {
    agentName: string;
    independenceClass: string | null;
    reason: string | null;
    createdAt: string | null;
    needInfoTopicId: string | null;
  })[] = voteRows.rows.map((row) => {
    const agentId = row.agent_id as string;
    const independenceClass = (row.independence_class as string | null) ?? null;
    const acceptedContributions =
      Number(row.merged_contributions ?? 0) + Number(row.earned_credit_events ?? 0);
    return {
      agentId,
      voteType: row.vote_type as string,
      classKey: deriveClassKey(agentId, independenceClass),
      standingEligible: meetsStanding(row.agent_age_days as number, acceptedContributions),
      agentName: (row.agent_name as string | null) ?? "",
      independenceClass,
      reason: (row.reason as string | null) ?? null,
      createdAt: (row.created_at as string | null) ?? null,
      needInfoTopicId: (row.need_info_topic_id as string | null) ?? null,
    };
  });

  const tally = tallyVotes(tallyInput, { mode, proposerClassKeys });

  return {
    mode: tally.mode,
    approvals: tally.approvals,
    rejections: tally.rejections,
    needInfo: tally.needInfo,
    countedApprovals: tally.countedApprovals,
    countedRejections: tally.countedRejections,
    votes: tally.votes.map((vote, i) => ({
      ...vote,
      agentName: tallyInput[i].agentName,
      independenceClass: tallyInput[i].independenceClass,
      reason: tallyInput[i].reason,
      createdAt: tallyInput[i].createdAt,
      needInfoTopicId: tallyInput[i].needInfoTopicId,
    })),
  };
}

export async function evaluateTopicProposals(db: DbClient) {
  const proposed = await db.execute(`
    SELECT t.id, t.title, t.tier, t.created_at,
      (SELECT COUNT(*) FROM topic_votes tv WHERE tv.topic_id = t.id AND tv.vote_type = 'approve') as approvals,
      (SELECT COUNT(*) FROM topic_votes tv WHERE tv.topic_id = t.id AND tv.vote_type = 'reject') as rejections
    FROM topics t
    WHERE t.status = 'proposed'
  `);

  let opened = 0;
  for (const t of proposed.rows) {
    let approvals = (t.approvals as number) || 0;
    let rejections = (t.rejections as number) || 0;
    // #5459 — post-cutoff topics count DISTINCT independence classes
    // (proposer's class excluded, standing-gated); grandfathered topics
    // (created before the cutoff, or rows without a parseable created_at)
    // keep the raw counts above.
    if (usesClassCounting(t.created_at as string | null)) {
      const tally = await computeTopicVoteTally(db, t.id as string, "class-v1");
      approvals = tally.countedApprovals;
      rejections = tally.countedRejections;
    }
    const quorum = getTopicApprovalQuorum(t.tier as string | null);
    // Race rule (#5425): when BOTH quorums are met in the same tally,
    // approval wins — approval is recoverable downstream (challenges,
    // demotion), terminal rejection is not.
    if (approvals >= quorum) {
      await finalizeApprovedTopic(db, t.id as string, t.title as string, approvals, quorum);
      opened++;
    } else if (rejections >= quorum) {
      await finalizeRejectedTopic(db, t.id as string, t.title as string, rejections, quorum);
    }
  }
  return opened;
}

// ─── Consensus Engine ───────────────────────────────────────────────

// #5563 — exported so the served `/.well-known/pact.json` reads the
// enforced value rather than restating it. The epistemics extension's §9
// rule is that advertised values MUST be enforced values; the only way to
// guarantee that structurally is for the profile to import the same binding
// the sweep below branches on.
export const CONSENSUS_RATIO = 0.90;
export const STABLE_DAYS = 30;

/**
 * §4.3 stable-break ratio (`au.tailor.pact/epistemics` `stableBreakRatio`).
 *
 * Deliberately BELOW {@link CONSENSUS_RATIO}: a topic that has held aligned
 * for {@link STABLE_DAYS} is not flapped by a single dissenter, but
 * genuinely eroded support still breaks it. Was an unnamed `0.80` literal at
 * the Phase-3 scan site until #5563 — a magic number cannot be advertised
 * honestly, because the profile would have had to retype it.
 */
export const STABLE_BREAK_RATIO = 0.80;

/** Render a ratio as a whole-percent label for an event reason (#5563). */
function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

// Per-warrant-kind ratification quorums. Keys are tier column values;
// #3691 W1 removed the privileged "axiom" rank — its quorum of 2 survives
// ONLY as CONVENTION_STOP_BASE_AGENTS below: a convention-stop needs fewer
// parties to ratify the agreement-to-stop, not because it is more certain
// or terminal. Axis A carries no ordering; these are participation floors.
export const TIER_BASE_AGENTS: Record<string, number> = {
  empirical: 3,
  institutional: 3,
  interpretive: 4,
  conjecture: 5,
  convention: 3,
  practice: 3,
  policy: 3,
  frontier: 5,
};

const DEFAULT_BASE = 3;

// Fewer parties ratify a convention-stop (the agreement to stop digging);
// the stop stays exactly as challengeable as everything else.
export const CONVENTION_STOP_BASE_AGENTS = 2;

function getRequiredAgents(tier: string, conventionStop: boolean, uniqueProposers: number): number {
  const base = conventionStop ? CONVENTION_STOP_BASE_AGENTS : (TIER_BASE_AGENTS[tier] ?? DEFAULT_BASE);
  return Math.max(base, uniqueProposers);
}

/**
 * #5425 — the single source of truth for the pre-open topic-proposal
 * quorum (replaces the flat TOPIC_APPROVAL_THRESHOLD = 3 that was
 * duplicated here and in the vote route). The quorum is the tier's
 * participation floor from TIER_BASE_AGENTS — the same base the consensus
 * engine's getRequiredAgents uses — and applies SYMMETRICALLY to approve
 * and reject: rejections reaching this quorum before approvals do
 * transition the topic to terminal 'rejected'.
 *
 * Deliberately NOT applied pre-open: the convention-stop reduced quorum
 * (CONVENTION_STOP_BASE_AGENTS ratifies the agreement-to-stop at the
 * consensus stage, not proposal triage) and the uniqueProposers floor
 * (content proposals are refused on 'proposed' topics, so it is
 * definitionally 0 here).
 */
export function getTopicApprovalQuorum(tier: string | null | undefined): number {
  return TIER_BASE_AGENTS[tier ?? ""] ?? DEFAULT_BASE;
}

// ─── #5427 — Keyset-paged sweep machinery ────────────────────────────
//
// Every phase of updateConsensusStatuses used to run one unbounded
// full-class scan (5–9 correlated subqueries per row) plus a graph-wide
// credence recompute. Each phase now keyset-pages over topics.id (TEXT
// primary key — '' sorts before every non-empty id, so it is the natural
// start cursor) in SCAN-THEN-APPLY shape: every page of a phase is read
// BEFORE any of that phase's writes, which preserves the original
// single-snapshot semantics exactly (a row's computed stats never observe
// a write made by the same phase) while bounding every individual
// statement to `pageSize` rows. The Phase-5 credence recompute is scoped
// to the dirty subgraph (credence-as-projection, triggered by events)
// with a periodic full recompute as the convergence backstop.

export interface ConsensusSweepOptions {
  /** Rows fetched per keyset page in each phase scan. A bound, not a flag
   *  — paging is unconditional. */
  pageSize?: number;
  /** Soft wall-time budget for one updateConsensusStatuses invocation.
   *  Checked between pages and phases; on overrun the sweep applies what
   *  it has already scanned, logs the truncation, and leaves the rest to
   *  the next (cron) invocation. */
  timeBudgetMs?: number;
  /** Above this many dirty/affected topics, the Phase-5 credence
   *  recompute falls back to the full (still keyset-paged) recompute
   *  rather than walking an enormous subgraph query-by-query. */
  dirtyMaxTopics?: number;
  /** Cadence backstop for a full credence recompute — covers anything an
   *  event-triggered dirty walk could miss (e.g. an events-id watermark
   *  race against an in-flight insert). */
  fullRecomputeIntervalMs?: number;
  /** Clock seam for tests. */
  now?: () => number;
}

export const CONSENSUS_SWEEP_DEFAULTS = {
  pageSize: 200,
  timeBudgetMs: 60_000,
  dirtyMaxTopics: 1_000,
  fullRecomputeIntervalMs: 24 * 60 * 60 * 1000,
} as const;

const SWEEP_STATE_CREDENCE_WATERMARK = "credence_events_watermark";
const SWEEP_STATE_FULL_RECOMPUTE_AT = "credence_full_recompute_at";
/** Max ids per `= ANY(?)` statement in the Phase-5 subgraph walks. */
const SWEEP_ANY_CHUNK = 500;
/** Defensive cap on subgraph-walk iterations (the DAG gate at edge
 *  creation makes deep chains legitimate but bounded). */
const SWEEP_MAX_WALK_HOPS = 100;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function readSweepState(db: DbClient, key: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT value FROM sweep_state WHERE key = ?",
    args: [key],
  });
  const value = result.rows[0]?.value;
  return value === undefined || value === null ? null : String(value);
}

async function writeSweepState(db: DbClient, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO sweep_state (key, value, updated_at) VALUES (?, ?, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    args: [key, value],
  });
}

/**
 * Keyset-paged scan. `pageSql` must filter `<id> > ?`, `ORDER BY <id>`,
 * and `LIMIT ?`, taking exactly (cursor, limit) as its args. The cursor is
 * the last row's own id, so a row is visited exactly once per scan even
 * when the underlying status class shrinks or grows between pages: rows
 * already visited sort at-or-below the cursor, and a row can never
 * straddle two pages (strict `>` excludes the boundary row from the next
 * page). Rows are NOT mutated during the scan (scan-then-apply), so the
 * class itself is stable modulo concurrent writers — which the pre-#5427
 * single-snapshot scan was equally exposed to.
 */
async function scanKeyset(
  db: DbClient,
  pageSql: string,
  pageSize: number,
  isPastDeadline: () => boolean,
  onRow: (row: Record<string, unknown>) => void,
  idKey = "id"
): Promise<{ scanned: number; truncated: boolean }> {
  let cursor = "";
  let scanned = 0;
  for (;;) {
    const page = await db.execute({ sql: pageSql, args: [cursor, pageSize] });
    for (const row of page.rows) {
      onRow(row);
      cursor = String(row[idKey]);
    }
    scanned += page.rows.length;
    if (page.rows.length < pageSize) return { scanned, truncated: false };
    if (isPastDeadline()) return { scanned, truncated: true };
  }
}

// Phase page queries. Identical stat subqueries to the pre-#5427 scans,
// minus columns the phase never read (mergedCount / totalDoneCount /
// totalProposals — dead weight dropped outright), plus the keyset window.
const SWEEP_PHASE1_PAGE_SQL = `
    SELECT t.id, t.tier, t.convention_stop,
      (SELECT COUNT(DISTINCT p.agent_id) FROM proposals p
        WHERE p.topic_id = t.id AND p.status != 'rejected') as uniqueProposers,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'pending') as pendingCount,
      (SELECT COUNT(*) FROM proposals p
        JOIN sections s ON s.id = p.section_id AND s.topic_id = p.topic_id
        WHERE p.topic_id = t.id AND p.status = 'merged' AND s.heading = 'Answer') as answerMergedCount,
      (SELECT COUNT(*) FROM registrations r
        WHERE r.topic_id = t.id AND r.done_status = 'aligned') as alignedCount,
      (SELECT COUNT(*) FROM registrations r
        WHERE r.topic_id = t.id AND r.done_status = 'dissenting') as dissentingCount,
      (SELECT COUNT(*) FROM topic_dependencies td
        JOIN topics dep ON dep.id = td.depends_on
        WHERE td.topic_id = t.id
        AND dep.status NOT IN ('consensus', 'stable', 'locked')) as unmetDependencies
    FROM topics t
    WHERE t.status IN ('open', 'challenged') AND t.id > ?
    ORDER BY t.id
    LIMIT ?`;

const SWEEP_PHASE2_PAGE_SQL = `
    SELECT t.id, t.tier, t.convention_stop, t.consensus_since,
      (SELECT COUNT(DISTINCT p.agent_id) FROM proposals p
        WHERE p.topic_id = t.id AND p.status != 'rejected') as uniqueProposers,
      (SELECT COUNT(*) FROM proposals p WHERE p.topic_id = t.id AND p.status = 'pending') as pendingCount,
      (SELECT COUNT(*) FROM registrations r
        WHERE r.topic_id = t.id AND r.done_status = 'aligned') as alignedCount,
      (SELECT COUNT(*) FROM registrations r
        WHERE r.topic_id = t.id AND r.done_status = 'dissenting') as dissentingCount,
      (SELECT COUNT(*) FROM topic_dependencies td
        JOIN topics dep ON dep.id = td.depends_on
        WHERE td.topic_id = t.id
        AND dep.status NOT IN ('consensus', 'stable', 'locked')) as unmetDependencies
    FROM topics t
    WHERE t.status = 'consensus' AND t.id > ?
    ORDER BY t.id
    LIMIT ?`;

const SWEEP_PHASE3_PAGE_SQL = `
    SELECT t.id,
      (SELECT COUNT(*) FROM registrations r
        WHERE r.topic_id = t.id AND r.done_status = 'aligned') as alignedCount,
      (SELECT COUNT(*) FROM registrations r
        WHERE r.topic_id = t.id AND r.done_status = 'dissenting') as dissentingCount
    FROM topics t
    WHERE t.status = 'stable' AND t.id > ?
    ORDER BY t.id
    LIMIT ?`;

const SWEEP_PHASE4_PAGE_SQL = `
    SELECT DISTINCT t.id FROM topics t
    JOIN topic_dependencies td ON td.topic_id = t.id AND td.relationship = 'assumes'
    JOIN topics dep ON dep.id = td.depends_on
    WHERE t.status IN ('stable', 'locked')
      AND dep.status NOT IN ('consensus', 'stable', 'locked')
      AND t.id > ?
    ORDER BY t.id
    LIMIT ?`;

const SWEEP_CREDENCE_NODE_COLUMNS = `
    SELECT t.id, t.status, t.consensus_ratio, t.credence,
      (SELECT COUNT(*) FROM registrations r WHERE r.topic_id = t.id AND r.done_status = 'aligned') as alignedCount,
      (SELECT COUNT(*) FROM registrations r WHERE r.topic_id = t.id AND r.done_status = 'dissenting') as dissentingCount
    FROM topics t`;

const SWEEP_CREDENCE_NODES_PAGE_SQL = `${SWEEP_CREDENCE_NODE_COLUMNS}
    WHERE t.id > ?
    ORDER BY t.id
    LIMIT ?`;

const SWEEP_CREDENCE_NODES_BY_ID_SQL = `${SWEEP_CREDENCE_NODE_COLUMNS}
    WHERE t.id = ANY(?)`;

function rowToCredenceNode(r: Record<string, unknown>, verified: Set<string>): CredenceNode {
  const aligned = (r.alignedCount as number) || 0;
  const dissenting = (r.dissentingCount as number) || 0;
  const live = aligned + dissenting > 0 ? aligned / (aligned + dissenting) : 0;
  const ratio = (r.consensus_ratio as number | null) ?? live;
  return { id: r.id as string, base: credenceFromRatio(ratio), defeated: !verified.has(r.status as string) };
}

async function writeChangedCredences(
  db: DbClient,
  nodes: CredenceNode[],
  edges: CredenceEdge[],
  prior: Map<string, number | null>
): Promise<number> {
  const effective = computeEffectiveCredences(nodes, edges);
  let writes = 0;
  for (const n of nodes) {
    const value = effective.get(n.id);
    if (value === undefined) continue;
    const before = prior.get(n.id);
    if (typeof before === "number" && Math.abs(before - value) < 1e-9) continue;
    await db.execute({ sql: "UPDATE topics SET credence = ? WHERE id = ?", args: [value, n.id] });
    writes++;
  }
  return writes;
}

/**
 * Full-graph credence recompute — identical outcome to the pre-#5427
 * graph-wide pass, but every statement is keyset-paged. Used on cold
 * start (no watermark), on the periodic backstop cadence, and when the
 * dirty subgraph overflows `dirtyMaxTopics`.
 */
async function fullCredenceRecompute(
  db: DbClient,
  pageSize: number,
  isPastDeadline: () => boolean
): Promise<{ writes: number; truncated: boolean }> {
  const verified = new Set<string>(VERIFIED_TOPIC_STATUSES);
  const nodes: CredenceNode[] = [];
  const prior = new Map<string, number | null>();
  const nodeScan = await scanKeyset(db, SWEEP_CREDENCE_NODES_PAGE_SQL, pageSize, isPastDeadline, (r) => {
    nodes.push(rowToCredenceNode(r, verified));
    prior.set(r.id as string, r.credence as number | null);
  });
  if (nodeScan.truncated) return { writes: 0, truncated: true };

  // Edge scan keysets over the (topic_id, depends_on) primary key.
  const edges: CredenceEdge[] = [];
  let cursorTopic = "";
  let cursorDep = "";
  for (;;) {
    const page = await db.execute({
      sql: `SELECT topic_id, depends_on, relationship FROM topic_dependencies
        WHERE (topic_id, depends_on) > (?, ?)
        ORDER BY topic_id, depends_on
        LIMIT ?`,
      args: [cursorTopic, cursorDep, pageSize],
    });
    for (const r of page.rows) {
      edges.push({
        topicId: r.topic_id as string,
        dependsOn: r.depends_on as string,
        relationship: r.relationship as string,
      });
      cursorTopic = r.topic_id as string;
      cursorDep = r.depends_on as string;
    }
    if (page.rows.length < pageSize) break;
    if (isPastDeadline()) return { writes: 0, truncated: true };
  }

  const writes = await writeChangedCredences(db, nodes, edges, prior);
  return { writes, truncated: false };
}

/**
 * Dirty-subgraph credence recompute. Seeds are the topics touched by
 * events since the watermark plus this invocation's own status changes.
 * The affected set is the seeds' transitive DEPENDENTS (whose effective
 * credence can change) closed downward over `depends_on` (whose values
 * feed the computation) — closure under `depends_on` means the pure
 * computeEffectiveCredences produces exactly the same values on the
 * subgraph as it would on the whole graph. Returns null when the walk
 * overflows `maxTopics` (caller falls back to the full recompute).
 */
async function recomputeCredencesForSubgraph(
  db: DbClient,
  seeds: Set<string>,
  maxTopics: number
): Promise<{ writes: number } | null> {
  const affected = new Set<string>(seeds);

  // Upward closure: transitive dependents of the seeds.
  let frontier = [...affected];
  let hops = 0;
  while (frontier.length > 0) {
    if (++hops > SWEEP_MAX_WALK_HOPS) return null;
    const next: string[] = [];
    for (const chunk of chunked(frontier, SWEEP_ANY_CHUNK)) {
      const rows = await db.execute({
        sql: "SELECT DISTINCT topic_id FROM topic_dependencies WHERE depends_on = ANY(?)",
        args: [chunk],
      });
      for (const r of rows.rows) {
        const id = String(r.topic_id);
        if (!affected.has(id)) {
          affected.add(id);
          next.push(id);
        }
      }
    }
    if (affected.size > maxTopics) return null;
    frontier = next;
  }

  // Downward closure + edge collection: fetch every affected node's
  // out-edges once, pulling in transitive dependencies.
  const edges: CredenceEdge[] = [];
  frontier = [...affected];
  hops = 0;
  while (frontier.length > 0) {
    if (++hops > SWEEP_MAX_WALK_HOPS) return null;
    const next: string[] = [];
    for (const chunk of chunked(frontier, SWEEP_ANY_CHUNK)) {
      const rows = await db.execute({
        sql: "SELECT topic_id, depends_on, relationship FROM topic_dependencies WHERE topic_id = ANY(?)",
        args: [chunk],
      });
      for (const r of rows.rows) {
        edges.push({
          topicId: String(r.topic_id),
          dependsOn: String(r.depends_on),
          relationship: String(r.relationship),
        });
        const dep = String(r.depends_on);
        if (!affected.has(dep)) {
          affected.add(dep);
          next.push(dep);
        }
      }
    }
    if (affected.size > maxTopics) return null;
    frontier = next;
  }

  const verified = new Set<string>(VERIFIED_TOPIC_STATUSES);
  const nodes: CredenceNode[] = [];
  const prior = new Map<string, number | null>();
  for (const chunk of chunked([...affected], SWEEP_ANY_CHUNK)) {
    const rows = await db.execute({ sql: SWEEP_CREDENCE_NODES_BY_ID_SQL, args: [chunk] });
    for (const r of rows.rows) {
      nodes.push(rowToCredenceNode(r, verified));
      prior.set(r.id as string, r.credence as number | null);
    }
  }

  const writes = await writeChangedCredences(db, nodes, edges, prior);
  return { writes };
}

/**
 * Phase 5 driver: credence as a projection, triggered by events. Reads
 * the events-id watermark, recomputes the dirty subgraph, and advances
 * the watermark only after a completed recompute. Falls back to the full
 * (paged) recompute on cold start, on the periodic backstop cadence, and
 * when the dirty set overflows.
 */
async function recomputeCredences(
  db: DbClient,
  ctx: {
    pageSize: number;
    dirtyMaxTopics: number;
    fullRecomputeIntervalMs: number;
    now: () => number;
    isPastDeadline: () => boolean;
    changedTopicIds: Set<string>;
  }
): Promise<{ mode: "full" | "dirty" | "noop"; writes: number; truncated: boolean }> {
  const watermarkRaw = await readSweepState(db, SWEEP_STATE_CREDENCE_WATERMARK);
  const lastFullRaw = await readSweepState(db, SWEEP_STATE_FULL_RECOMPUTE_AT);
  const watermark = watermarkRaw === null ? null : Number(watermarkRaw);
  const lastFull = lastFullRaw === null ? null : Number(lastFullRaw);
  // Captured AFTER phases 1–4 committed their events on this connection,
  // so this sweep's own mutations fall inside the consumed window.
  const maxEventResult = await db.execute("SELECT COALESCE(MAX(id), 0) as max_event_id FROM events");
  const maxEventId = Number(maxEventResult.rows[0]?.max_event_id ?? 0);

  const fullDue =
    watermark === null ||
    !Number.isFinite(watermark) ||
    lastFull === null ||
    !Number.isFinite(lastFull) ||
    ctx.now() - lastFull >= ctx.fullRecomputeIntervalMs;

  if (!fullDue) {
    const dirty = new Set<string>(ctx.changedTopicIds);
    const seedRows = await db.execute({
      sql: "SELECT DISTINCT topic_id FROM events WHERE id > ? LIMIT ?",
      args: [watermark, ctx.dirtyMaxTopics + 1],
    });
    for (const r of seedRows.rows) dirty.add(String(r.topic_id));

    if (dirty.size === 0) {
      await writeSweepState(db, SWEEP_STATE_CREDENCE_WATERMARK, String(maxEventId));
      return { mode: "noop", writes: 0, truncated: false };
    }
    if (dirty.size <= ctx.dirtyMaxTopics) {
      const scoped = await recomputeCredencesForSubgraph(db, dirty, ctx.dirtyMaxTopics);
      if (scoped) {
        await writeSweepState(db, SWEEP_STATE_CREDENCE_WATERMARK, String(maxEventId));
        return { mode: "dirty", writes: scoped.writes, truncated: false };
      }
    }
    // Dirty set or its closure overflowed the bound — full recompute.
  }

  const full = await fullCredenceRecompute(db, ctx.pageSize, ctx.isPastDeadline);
  if (full.truncated) {
    // Watermark deliberately NOT advanced: the next sweep retries.
    return { mode: "full", writes: full.writes, truncated: true };
  }
  await writeSweepState(db, SWEEP_STATE_CREDENCE_WATERMARK, String(maxEventId));
  await writeSweepState(db, SWEEP_STATE_FULL_RECOMPUTE_AT, String(ctx.now()));
  return { mode: "full", writes: full.writes, truncated: false };
}

export async function updateConsensusStatuses(db: DbClient, options: ConsensusSweepOptions = {}) {
  const pageSize = Math.max(1, options.pageSize ?? CONSENSUS_SWEEP_DEFAULTS.pageSize);
  const timeBudgetMs = options.timeBudgetMs ?? CONSENSUS_SWEEP_DEFAULTS.timeBudgetMs;
  const dirtyMaxTopics = Math.max(1, options.dirtyMaxTopics ?? CONSENSUS_SWEEP_DEFAULTS.dirtyMaxTopics);
  const fullRecomputeIntervalMs =
    options.fullRecomputeIntervalMs ?? CONSENSUS_SWEEP_DEFAULTS.fullRecomputeIntervalMs;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + timeBudgetMs;
  const isPastDeadline = () => now() > deadline;

  let updated = 0;
  let scannedTotal = 0;
  let truncated = false;
  // This invocation's own status changes — Phase-5 dirty seeds alongside
  // the events window (belt-and-braces: every phase mutation also emits
  // an event, but the in-memory set is race-free by construction).
  const changedTopicIds = new Set<string>();

  // --- Phase 1: Check open/challenged topics for NEW consensus ---
  type Phase1Decision = {
    id: string;
    kind: "promote" | "blocked";
    tier: string;
    alignmentRatio: number;
    totalVoters: number;
    aligned: number;
    dissenting: number;
    requiredAgents: number;
    uniqueProposers: number;
    unmetDeps: number;
  };
  const phase1: Phase1Decision[] = [];
  {
    const scan = await scanKeyset(db, SWEEP_PHASE1_PAGE_SQL, pageSize, isPastDeadline, (t) => {
      const tier = (t.tier as string) || "practice";
      const uniqueProposers = t.uniqueProposers as number;
      const pending = t.pendingCount as number;
      const answerMerged = t.answerMergedCount as number;
      const aligned = t.alignedCount as number;
      const dissenting = t.dissentingCount as number;
      const totalVoters = aligned + dissenting;
      const requiredAgents = getRequiredAgents(tier, !!t.convention_stop, uniqueProposers);
      const unmetDeps = t.unmetDependencies as number;
      const alignmentRatio = totalVoters > 0 ? aligned / totalVoters : 0;
      const depsOk = dependencyGateOk(tier, unmetDeps); // #2888 — re-enabled post-bootstrap (blast radius zero)

      if (pending === 0 && answerMerged > 0 && aligned >= requiredAgents && alignmentRatio >= CONSENSUS_RATIO) {
        phase1.push({
          id: t.id as string,
          kind: depsOk ? "promote" : "blocked",
          tier,
          alignmentRatio,
          totalVoters,
          aligned,
          dissenting,
          requiredAgents,
          uniqueProposers,
          unmetDeps,
        });
      }
    });
    scannedTotal += scan.scanned;
    truncated = truncated || scan.truncated;
  }
  for (const d of phase1) {
    if (d.kind === "promote") {
      // §25.6 (#5535) — the fail-closed apply guard runs BEFORE the apply,
      // never after. A promotion becomes eligible here on quorum + alignment
      // + the dependency gate, i.e. on protocol state alone; §25.6 forbids
      // that from driving an apply whose effect class is
      // external-irreversible or whose type requires human attestation. The
      // KG's `fact` type is internal-reversible (see effect-class.ts for the
      // ruling and its evidence) so this allows today — but an unclassified
      // or guarded type resolves fail-closed and the promotion stops.
      const guard = evaluateApplyGuard({
        resourceType: KG_APPLY_RESOURCE_TYPE,
        policy: "objection-based",
      });
      if (!guard.allowed) {
        await emitEvent(db, d.id, APPLY_BLOCKED_EVENT, "", "", {
          effect_class: guard.effectClass,
          human_attestation: guard.humanAttestation,
          required_principals: guard.requiredPrincipals,
          reason: guard.reason,
          policy: guard.policy,
        });
        continue;
      }
      await db.execute({
        sql: `UPDATE topics SET
          status = 'consensus',
          consensus_ratio = ?,
          consensus_voters = ?,
          consensus_since = COALESCE(consensus_since, NOW())
        WHERE id = ?`,
        args: [d.alignmentRatio, d.totalVoters, d.id],
      });
      await emitEvent(db, d.id, "pact.topic.consensus-reached", "", "", {
        alignmentRatio: `${Math.round(d.alignmentRatio * 100)}%`,
        alignedAgents: d.aligned,
        dissentingAgents: d.dissenting,
        requiredAgents: d.requiredAgents,
        uniqueProposers: d.uniqueProposers,
        tier: d.tier,
      });

      try {
        const { distributeBounty } = await import("./economy");
        await distributeBounty(db, d.id);
      } catch (e) {
        console.error(`Bounty distribution failed for ${d.id}:`, e);
      }

      changedTopicIds.add(d.id);
      updated++;
    } else {
      await emitEvent(db, d.id, "pact.consensus.blocked-by-dependencies", "", "", {
        alignmentRatio: `${Math.round(d.alignmentRatio * 100)}%`,
        alignedAgents: d.aligned,
        unmetDependencies: d.unmetDeps,
        tier: d.tier,
        reason: `${d.unmetDeps} dependency topic(s) have not yet reached consensus`,
      });
    }
  }

  // --- Phase 2: Check existing consensus topics ---
  type Phase2Decision = {
    id: string;
    kind: "demote" | "stabilize";
    tier: string;
    alignmentRatio: number;
    totalVoters: number;
    reason?: string;
    daysSince?: number;
  };
  const phase2: Phase2Decision[] = [];
  if (!truncated) {
    const scan = await scanKeyset(db, SWEEP_PHASE2_PAGE_SQL, pageSize, isPastDeadline, (t) => {
      const tier = (t.tier as string) || "practice";
      const uniqueProposers = t.uniqueProposers as number;
      const pending = t.pendingCount as number;
      const aligned = t.alignedCount as number;
      const dissenting = t.dissentingCount as number;
      const totalVoters = aligned + dissenting;
      const requiredAgents = getRequiredAgents(tier, !!t.convention_stop, uniqueProposers);
      const alignmentRatio = totalVoters > 0 ? aligned / totalVoters : 0;
      const consensusSince = t.consensus_since as string;
      const unmetDeps = t.unmetDependencies as number;
      const depsOkForBreaking = dependencyGateOk(tier, unmetDeps); // #2888 — re-enabled post-bootstrap

      const wasForced = totalVoters === 0;
      if (
        !wasForced &&
        (alignmentRatio < CONSENSUS_RATIO || aligned < requiredAgents || pending > 0 || !depsOkForBreaking)
      ) {
        phase2.push({
          id: t.id as string,
          kind: "demote",
          tier,
          alignmentRatio,
          totalVoters,
          reason:
            unmetDeps > 0 ? "Dependency topic(s) lost consensus" :
            pending > 0 ? "New proposals pending" :
            // #5563 — rendered from the constant so the audit trail cannot
            // narrate a threshold the engine stopped enforcing.
            alignmentRatio < CONSENSUS_RATIO ? `Alignment dropped below ${pct(CONSENSUS_RATIO)}` :
            "Not enough aligned agents",
        });
        return;
      }

      if (consensusSince) {
        const sinceDate = new Date(String(consensusSince));
        const daysSince = (Date.now() - sinceDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince >= STABLE_DAYS) {
          phase2.push({ id: t.id as string, kind: "stabilize", tier, alignmentRatio, totalVoters, daysSince });
        }
      }
    });
    scannedTotal += scan.scanned;
    truncated = truncated || scan.truncated;
  }
  for (const d of phase2) {
    if (d.kind === "demote") {
      await db.execute({
        sql: "UPDATE topics SET status = 'open', consensus_since = NULL, consensus_ratio = NULL, consensus_voters = NULL WHERE id = ?",
        args: [d.id],
      });
      await emitEvent(db, d.id, "pact.consensus.broken", "", "", {
        alignmentRatio: `${Math.round(d.alignmentRatio * 100)}%`,
        reason: d.reason,
      });
    } else {
      await db.execute({
        sql: "UPDATE topics SET status = 'stable', locked_at = NOW(), consensus_ratio = ?, consensus_voters = ? WHERE id = ?",
        args: [d.alignmentRatio, d.totalVoters, d.id],
      });
      await emitEvent(db, d.id, "pact.topic.stable", "", "", {
        alignmentRatio: `${Math.round(d.alignmentRatio * 100)}%`,
        daysSinceConsensus: Math.floor(d.daysSince ?? 0),
        tier: d.tier,
      });
    }
    changedTopicIds.add(d.id);
    updated++;
  }

  // --- Phase 3: Check stable topics for consensus breakdown ---
  const phase3: { id: string; alignmentRatio: number }[] = [];
  if (!truncated) {
    const scan = await scanKeyset(db, SWEEP_PHASE3_PAGE_SQL, pageSize, isPastDeadline, (t) => {
      const aligned = t.alignedCount as number;
      const dissenting = t.dissentingCount as number;
      const totalVoters = aligned + dissenting;
      const alignmentRatio = totalVoters > 0 ? aligned / totalVoters : 0;
      // #5563 — the named constant, not a literal: this is the value the
      // profile advertises as `stableBreakRatio`.
      if (alignmentRatio < STABLE_BREAK_RATIO) {
        phase3.push({ id: t.id as string, alignmentRatio });
      }
    });
    scannedTotal += scan.scanned;
    truncated = truncated || scan.truncated;
  }
  for (const d of phase3) {
    await db.execute({
      sql: "UPDATE topics SET status = 'open', locked_at = NULL, consensus_since = NULL, consensus_ratio = NULL, consensus_voters = NULL WHERE id = ?",
      args: [d.id],
    });
    await emitEvent(db, d.id, "pact.stable.broken", "", "", {
      alignmentRatio: `${Math.round(d.alignmentRatio * 100)}%`,
      reason: `Alignment dropped below ${pct(STABLE_BREAK_RATIO)} — stable consensus broken`,
    });

    const deps = await db.execute({
      sql: "SELECT topic_id FROM topic_dependencies WHERE depends_on = ?",
      args: [d.id],
    });
    for (const dep of deps.rows) {
      await emitEvent(db, dep.topic_id as string, "pact.dependency.unstable", "", "", {
        dependencyId: d.id,
        reason: "A dependency topic lost stable consensus",
      });
    }

    changedTopicIds.add(d.id);
    updated++;
  }

  // --- Phase 4 (#3691 W3): a defeated *necessary* premise re-opens contention ---
  // Consensus topics with unmet deps are already demoted in Phase 2; stable
  // and locked topics were previously immune. An `assumes` dependency that
  // has left the verified statuses forces the dependent to `challenged`
  // (contested). `builds_on` weakness flows through credence only (Phase 5).
  const phase4: string[] = [];
  if (!truncated) {
    const scan = await scanKeyset(db, SWEEP_PHASE4_PAGE_SQL, pageSize, isPastDeadline, (t) => {
      phase4.push(t.id as string);
    });
    scannedTotal += scan.scanned;
    truncated = truncated || scan.truncated;
  }
  for (const id of phase4) {
    await db.execute({
      sql: "UPDATE topics SET status = 'challenged', locked_at = NULL, consensus_since = NULL WHERE id = ?",
      args: [id],
    });
    await emitEvent(db, id, "pact.dependency.assumption-defeated", "", "", {
      reason: "A necessary (assumes) dependency left verified status — claim re-opened for contention",
    });
    changedTopicIds.add(id);
    updated++;
  }

  // --- Phase 5 (#3691 W3 / #5427): recompute effective credence ---
  // Derived, never latched: recomputed from the current dependency frontier
  // so dependents attenuate transitively on a defeat (P1), are floored
  // rather than zeroed or deleted (P2), and self-heal when the dependency
  // recovers (P3). #5427 scopes the recompute to the dirty subgraph
  // (events since the watermark + this sweep's own changes), with the
  // periodic full recompute as the convergence backstop.
  let credenceMode: "full" | "dirty" | "noop" | "skipped" | "failed" = "skipped";
  let credenceWrites = 0;
  if (!truncated) {
    try {
      const result = await recomputeCredences(db, {
        pageSize,
        dirtyMaxTopics,
        fullRecomputeIntervalMs,
        now,
        isPastDeadline,
        changedTopicIds,
      });
      credenceMode = result.mode;
      credenceWrites = result.writes;
      truncated = truncated || result.truncated;
    } catch (e) {
      credenceMode = "failed";
      console.error("Credence recompute failed (non-fatal):", e);
    }
  }

  const elapsedMs = now() - startedAt;
  console.log(
    `[consensus-sweep] phases completed in ${elapsedMs}ms: scanned=${scannedTotal} updated=${updated} ` +
      `credence=${credenceMode}(${credenceWrites} writes) pageSize=${pageSize}` +
      (truncated ? ` TRUNCATED at time budget ${timeBudgetMs}ms — remainder deferred to the next sweep` : "")
  );

  return updated;
}

// ─── Challenge Evaluation ──────────────────────────────────────────

// #5563 — exported: this is the epistemics extension's `reopenQuorumBase`,
// advertised in `/.well-known/pact.json` straight from the binding
// requiredReopenVotes() adds the blast-radius term to.
export const CHALLENGE_REOPEN_VOTES = 3;

// #3691 W4: the reopen bar scales with blast radius — the more claims
// depend on a node, the more support a challenge needs to reopen it.
// Protection raises COST; it never removes the challenge affordance.
export function requiredReopenVotes(dependentCount: number): number {
  return CHALLENGE_REOPEN_VOTES + Math.floor(Math.sqrt(Math.max(0, dependentCount)));
}

// A challenge that gathers neither reopen quorum nor traction lapses after
// this window. Substantive challenges get their stake back even when they
// lose; only quorum-judged vexatious ones (objections, zero support) forfeit.
// #5563 — exported: the profile advertises `challengeLapseDays` as this
// value divided by a day, so the window cannot be advertised in one unit and
// enforced in another.
export const CHALLENGE_LAPSE_SECONDS = 7 * 24 * 3600;
const CHALLENGE_VEXATIOUS_OBJECTIONS = 3;
const PROPOSAL_STAKE = 5;

export async function evaluateChallenges(db: DbClient) {
  const challenges = await db.execute(`
    SELECT p.id as challengeId, p.topic_id, p.summary, p.agent_id,
      (SELECT COUNT(DISTINCT v.agent_id) FROM votes v
        WHERE v.proposal_id = p.id AND v.vote_type = 'approve') as supportCount,
      (SELECT COUNT(DISTINCT v.agent_id) FROM votes v
        WHERE v.proposal_id = p.id AND v.vote_type = 'object') as objectCount,
      (SELECT COUNT(*) FROM topic_dependencies td WHERE td.depends_on = p.topic_id) as dependentCount,
      (p.created_at + ${CHALLENGE_LAPSE_SECONDS} * INTERVAL '1 second' <= NOW()) as lapsed
    FROM proposals p
    JOIN topics t ON t.id = p.topic_id
    WHERE p.status = 'challenge'
      AND t.status IN ('consensus', 'stable', 'locked')
  `);

  let reopened = 0;
  const reopenedTopics = new Set<string>();

  for (const c of challenges.rows) {
    const support = (c.supportCount as number) || 0;
    const objections = (c.objectCount as number) || 0;
    const dependents = (c.dependentCount as number) || 0;
    const topicId = c.topic_id as string;
    const required = requiredReopenVotes(dependents);

    if (support < required && c.lapsed) {
      const vexatious = objections >= CHALLENGE_VEXATIOUS_OBJECTIONS && support === 0;
      await db.execute({
        sql: "UPDATE proposals SET status = 'rejected', resolved_at = NOW() WHERE id = ?",
        args: [c.challengeId as string],
      });
      if (!vexatious) {
        try {
          const { transfer } = await import("./economy");
          await transfer(db, { from: null, to: c.agent_id as string, amount: PROPOSAL_STAKE, topicId, reason: "challenge-stake-refund" });
        } catch (e) {
          console.error(`Challenge stake refund failed for ${c.agent_id}:`, e);
        }
      }
      await emitEvent(db, topicId, vexatious ? "pact.challenge.dismissed-vexatious" : "pact.challenge.lapsed", c.agent_id as string, "", {
        challengeId: c.challengeId as string,
        supportVotes: support,
        objections,
        requiredVotes: required,
        stakeRefunded: !vexatious,
      });
      continue;
    }

    if (support >= required && !reopenedTopics.has(topicId)) {
      await db.execute({
        sql: "UPDATE topics SET status = 'challenged', locked_at = NULL, consensus_since = NULL, consensus_ratio = NULL, consensus_voters = NULL WHERE id = ?",
        args: [topicId],
      });

      await db.execute({
        sql: "UPDATE proposals SET status = 'pending' WHERE id = ?",
        args: [c.challengeId as string],
      });

      await emitEvent(db, topicId, "pact.consensus.challenged", c.agent_id as string, "", {
        challengeId: c.challengeId as string,
        challengeSummary: c.summary as string,
        supportVotes: support,
      });

      const challengerAgentId = c.agent_id as string;
      try {
        const { transfer } = await import("./economy");
        await transfer(db, { from: null, to: challengerAgentId, amount: 10, topicId, reason: "successful-challenge-jackpot" });
        await db.execute({
          sql: "UPDATE agents SET successful_challenges = successful_challenges + 1 WHERE id = ?",
          args: [challengerAgentId],
        });
      } catch (e) {
        console.error(`Challenger reward failed for ${challengerAgentId}:`, e);
      }

      const deps = await db.execute({
        sql: "SELECT topic_id FROM topic_dependencies WHERE depends_on = ?",
        args: [topicId],
      });
      for (const dep of deps.rows) {
        await emitEvent(db, dep.topic_id as string, "pact.dependency.challenged", "", "", {
          dependencyId: topicId,
          reason: "A dependency topic's consensus was challenged",
        });
      }

      reopenedTopics.add(topicId);
      reopened++;
    }
  }
  return reopened;
}
