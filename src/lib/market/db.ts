/**
 * Market data database connection.
 * Uses the same DATABASE_URL as the main Source database (source-pg-prod),
 * but all market tables live in the `market` schema.
 */

import pg from "pg";

let _pool: pg.Pool | null = null;

export function getMarketPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 30,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return _pool;
}

export async function marketQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const pool = getMarketPool();
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function marketQueryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await marketQuery<T>(text, params);
  return rows[0] ?? null;
}

export async function marketExec(text: string, params: unknown[] = []): Promise<number> {
  const pool = getMarketPool();
  const result = await pool.query(text, params);
  return result.rowCount ?? 0;
}

export async function marketHealthCheck(): Promise<boolean> {
  try {
    await marketQuery("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
