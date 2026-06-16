"use client";

import { useEffect, useState } from "react";

type ForecastLine = {
  lineKey: string;
  title: string;
  forecastValue: number;
  confidence: number | null;
  actualValue: number | null;
  accuracyScore: number | null;
  lockHash?: string;
  lockedAt?: string | null;
  confidenceHistory?: { at: string; confidence: number | null }[];
};

type Cost = {
  totalTokens: number;
  measuredTokens: number;
  costUsd: number;
  kwh: number;
  kwhLow: number | null;
  kwhHigh: number | null;
  cronRuns: number;
  cronTokens: number;
  basis: string;
  assumptions: Record<string, unknown>;
  humanCompare: Record<string, unknown>;
  updatedAt: string | null;
};

function fmtM(v: number | null): string {
  if (v === null) return "—";
  return `$${(v / 1000).toFixed(1)}B`;
}

// Group order so the statement reads like a budget, not an alphabetised dump.
const REVENUE = ["qld.gg.taxation", "qld.gg.grants_rev", "qld.gg.sales_gs", "qld.gg.interest_inc", "qld.gg.dividends", "qld.gg.other_rev"];
const EXPENSE = ["qld.gg.employee", "qld.gg.other_oper", "qld.gg.grants_exp", "qld.gg.dep_amort", "qld.gg.other_super", "qld.gg.interest_exp", "qld.gg.super_int"];

export default function FiscalPage() {
  const [forecast, setForecast] = useState<ForecastLine[]>([]);
  const [cost, setCost] = useState<Cost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [fRes, cRes] = await Promise.all([
          fetch("/api/fiscal/forecast?fiscalYear=FY2026-27&limit=50"),
          fetch("/api/fiscal/cost"),
        ]);
        if (!fRes.ok) throw new Error("Could not load forecast");
        const fData = (await fRes.json()) as { lines: ForecastLine[] };
        const cData = cRes.ok ? ((await cRes.json()) as Cost) : null;
        if (!cancelled) {
          setForecast(Array.isArray(fData.lines) ? fData.lines : []);
          setCost(cData);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const byKey = (k: string) => forecast.find((f) => f.lineKey === k);
  const totalRev = byKey("qld.gg.total_rev");
  const totalExp = byKey("qld.gg.total_exp");
  const nob = byKey("qld.gg.nob");
  const stamped = forecast.find((f) => f.lockHash || f.lockedAt);
  const reviews = stamped?.confidenceHistory?.length ?? 0;
  const conf = forecast.find((f) => f.confidence !== null)?.confidence ?? null;

  return (
    <main style={{ maxWidth: 940, margin: "0 auto", padding: "2rem 1.25rem" }}>
      <p style={{ fontSize: ".8rem", letterSpacing: ".08em", textTransform: "uppercase", color: "#888", marginBottom: ".25rem" }}>
        Tailor AI Knowledge Base · prediction
      </p>
      <h1 style={{ fontSize: "2rem", marginBottom: ".4rem" }}>
        Queensland 2026-27 Budget — AI forecast
      </h1>
      <p style={{ color: "#555", marginBottom: "1.5rem", maxWidth: 720 }}>
        A pre-registered, AI-generated forecast of the State&apos;s General Government
        operating statement — built from public data alone, locked before the official
        release (23 June 2026), and scored against the real budget when it lands.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "#b00" }}>{error}</p>}

      {/* Headline forecast */}
      {forecast.length > 0 && (
        <section style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          <Big label="Total revenue" value={fmtM(totalRev?.forecastValue ?? null)} />
          <Big label="Total expenses" value={fmtM(totalExp?.forecastValue ?? null)} />
          <Big label="Net operating balance" value={fmtM(nob?.forecastValue ?? null)} accent="#b00" />
          <Big label="Confidence" value={conf !== null ? `${conf}%` : "—"} sub="lines within ±10% (backtested)" />
        </section>
      )}

      {/* THE COST TILE — total compute to establish this forecast */}
      {cost && (
        <section style={{
          border: "1px solid #1a73e8", background: "#eef4ff", borderRadius: 10,
          padding: "1.1rem 1.3rem", marginBottom: "2rem",
        }}>
          <div style={{ fontSize: ".8rem", textTransform: "uppercase", letterSpacing: ".06em", color: "#1a56c4", marginBottom: ".5rem" }}>
            Total cost to establish this forecast
          </div>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "baseline" }}>
            <Metric big value={`${(cost.totalTokens / 1e6).toFixed(2)}M`} label="tokens" />
            <Metric big value={`$${cost.costUsd.toFixed(2)}`} label="compute cost" />
            <Metric big value={`${cost.kwh.toFixed(2)} kWh`} label={`energy${cost.kwhLow != null ? ` (${cost.kwhLow}–${cost.kwhHigh})` : ""}`} />
            <Metric value={`${(cost.measuredTokens / 1e6).toFixed(2)}M`} label="measured (exact)" />
            <Metric value={`${cost.cronRuns}`} label="nightly runs metered" />
          </div>
          <p style={{ fontSize: ".78rem", color: "#445", marginTop: ".7rem", marginBottom: 0 }}>
            vs the State&apos;s own budget process — ~6 months, hundreds of staff. Subagent/workflow
            tokens are exact; main-thread tokens and energy are transparent estimates (Opus 4.8 list
            pricing; ~0.4 Wh/1k-token blended midpoint). The nightly cron meters its own token use
            on every run, so this figure becomes measured over time.
          </p>
        </section>
      )}

      {/* Forecast detail */}
      {forecast.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.2rem" }}>The forecast, line by line</h2>
          {stamped && (
            <p style={{ fontSize: ".8rem", color: "#666", margin: ".25rem 0 .75rem" }}>
              {stamped.lockHash && <>Lock-hash <code>{stamped.lockHash}</code> · </>}
              {stamped.lockedAt && <>locked {new Date(stamped.lockedAt).toLocaleDateString()} · </>}
              {reviews} timestamped review{reviews === 1 ? "" : "s"} as public signal lands · scored on 23 Jun 2026
            </p>
          )}
          <Table title="Revenue" lines={REVENUE.map(byKey).filter(Boolean) as ForecastLine[]} />
          <Table title="Expenses" lines={EXPENSE.map(byKey).filter(Boolean) as ForecastLine[]} />
          {nob && <Table title="Balance" lines={[nob]} />}
        </section>
      )}
    </main>
  );
}

function Big({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ border: "1px solid #e2e2e2", borderRadius: 8, padding: "1rem 1.25rem", minWidth: 170 }}>
      <div style={{ fontSize: ".8rem", color: "#777" }}>{label}</div>
      <div style={{ fontSize: "1.6rem", fontWeight: 600, color: accent ?? "#111" }}>{value}</div>
      {sub && <div style={{ fontSize: ".72rem", color: "#999" }}>{sub}</div>}
    </div>
  );
}

function Metric({ value, label, big }: { value: string; label: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: big ? "1.7rem" : "1.1rem", fontWeight: 700, color: "#1a3a8c" }}>{value}</div>
      <div style={{ fontSize: ".72rem", color: "#556" }}>{label}</div>
    </div>
  );
}

function Table({ title, lines }: { title: string; lines: ForecastLine[] }) {
  if (!lines.length) return null;
  return (
    <div style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: ".95rem", color: "#444", margin: ".6rem 0 .3rem" }}>{title}</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
        <thead>
          <tr>
            {["Line", "Forecast", "Actual", "Accuracy"].map((h) => (
              <th key={h} style={{ textAlign: h === "Line" ? "left" : "right", borderBottom: "2px solid #ddd", padding: ".4rem .5rem" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.lineKey}>
              <td style={{ borderBottom: "1px solid #eee", padding: ".4rem .5rem" }}>{l.title}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: ".4rem .5rem", textAlign: "right", fontWeight: 600 }}>{fmtM(l.forecastValue)}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: ".4rem .5rem", textAlign: "right", color: "#999" }}>{fmtM(l.actualValue)}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: ".4rem .5rem", textAlign: "right", color: "#999" }}>
                {l.accuracyScore === null ? "pending release" : `${l.accuracyScore}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
