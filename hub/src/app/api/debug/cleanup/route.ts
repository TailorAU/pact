import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Safe delete helper — silently skips if table doesn't exist
async function safeDelete(db: Awaited<ReturnType<typeof getDb>>, sql: string, args: unknown[]) {
  try {
    await db.execute({ sql, args });
  } catch {
    // Table might not exist — skip
  }
}

// POST /api/debug/cleanup — Remove duplicate topics and fix mis-tiered topics
export async function POST(req: Request) {
  try {
    const db = await getDb();
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "remove-duplicates") {
      const toRemove: string[] = body.ids || [];

      if (toRemove.length === 0) {
        return NextResponse.json({ error: "No ids provided" }, { status: 400 });
      }

      const results = [];
      for (const id of toRemove) {
        const check = await db.execute({
          sql: "SELECT id, title, status FROM topics WHERE id = ?",
          args: [id],
        });
        if (check.rows.length === 0) {
          results.push({ id, status: "not_found" });
          continue;
        }

        const title = check.rows[0].title;

        // Remove dependent data (safe — skips missing tables)
        await safeDelete(db, "DELETE FROM assumption_declarations WHERE topic_id = ? OR assumption_topic_id = ?", [id, id]);
        await safeDelete(db, "DELETE FROM topic_dependencies WHERE topic_id = ? OR depends_on = ?", [id, id]);
        await safeDelete(db, "DELETE FROM topic_votes WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM registrations WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM proposals WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM sections WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM events WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM intents WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM invite_tokens WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM topic_bounties WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM ledger_txs WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM axiom_usage_logs WHERE topic_id = ?", [id]);
        await safeDelete(db, "DELETE FROM constraints_table WHERE topic_id = ?", [id]);

        // Disable FK checks, remove the topic, re-enable
        await db.execute("PRAGMA foreign_keys = OFF");
        await db.execute({ sql: "DELETE FROM topics WHERE id = ?", args: [id] });
        await db.execute("PRAGMA foreign_keys = ON");

        results.push({ id, title, status: "removed" });
      }

      return NextResponse.json({ action: "remove-duplicates", results });
    }

    if (action === "fix-tiers") {
      const fixes: { id: string; newTier: string }[] = body.fixes || [];

      const results = [];
      for (const fix of fixes) {
        const check = await db.execute({
          sql: "SELECT id, title, tier FROM topics WHERE id = ?",
          args: [fix.id],
        });
        if (check.rows.length === 0) {
          results.push({ id: fix.id, status: "not_found" });
          continue;
        }

        const oldTier = check.rows[0].tier;
        await db.execute({
          sql: "UPDATE topics SET tier = ? WHERE id = ?",
          args: [fix.newTier, fix.id],
        });

        results.push({ id: fix.id, title: check.rows[0].title, oldTier, newTier: fix.newTier, status: "fixed" });
      }

      return NextResponse.json({ action: "fix-tiers", results });
    }

    if (action === "add-dependencies") {
      const deps: { topicId: string; dependsOn: string; relationship: string }[] = body.dependencies || [];
      const results = [];
      for (const dep of deps) {
        try {
          // Check both topics exist
          const [t1, t2] = await Promise.all([
            db.execute({ sql: "SELECT id, title FROM topics WHERE id = ?", args: [dep.topicId] }),
            db.execute({ sql: "SELECT id, title FROM topics WHERE id = ?", args: [dep.dependsOn] }),
          ]);
          if (t1.rows.length === 0 || t2.rows.length === 0) {
            results.push({ ...dep, status: "topic_not_found" });
            continue;
          }
          await db.execute({
            sql: `INSERT OR IGNORE INTO topic_dependencies (topic_id, depends_on, relationship) VALUES (?, ?, ?)`,
            args: [dep.topicId, dep.dependsOn, dep.relationship || "builds_on"],
          });
          results.push({
            from: (t1.rows[0].title as string).slice(0, 50),
            to: (t2.rows[0].title as string).slice(0, 50),
            relationship: dep.relationship,
            status: "added",
          });
        } catch (e) {
          results.push({ ...dep, status: `error: ${e}` });
        }
      }
      return NextResponse.json({ action: "add-dependencies", count: results.filter(r => r.status === "added").length, results });
    }

    return NextResponse.json({ error: "Unknown action. Use 'remove-duplicates', 'fix-tiers', or 'add-dependencies'" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
