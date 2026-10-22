/**
 * #1152 Round 4 — Agent resolution for work-economy endpoints.
 *
 * Work endpoints (/api/work/*) are authenticated — only a registered agent
 * can claim or submit work. We match the header convention used by the
 * read-debit helper (`x-source-agent-key`) so agents supply a single key
 * for both reading and contributing.
 */
import { createHash } from "crypto";
import { getDb } from "../db";

export type ResolvedAgent = { id: string; name: string };

export async function resolveAgentFromKey(
  req: Request,
): Promise<ResolvedAgent | null> {
  const key = req.headers.get("x-source-agent-key");
  if (!key || key.trim().length === 0) return null;
  // #5459 — the hub-protocol system wallet's sentinel is not a credential.
  if (key === "system-no-key") return null;
  // #5459 — a stored hash is never a usable bearer key: the raw arm of the
  // OR-match below would otherwise accept a leaked 64-hex digest verbatim.
  // No legitimate plaintext key has that shape (they are pact_sk_*).
  if (/^[0-9a-f]{64}$/.test(key)) return null;

  const hashed = createHash("sha256").update(key).digest("hex");
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT id, name FROM agents WHERE api_key = ? OR api_key = ?",
    args: [key, hashed],
  });
  if (result.rows.length === 0) return null;
  return {
    id: result.rows[0].id as string,
    name: result.rows[0].name as string,
  };
}
