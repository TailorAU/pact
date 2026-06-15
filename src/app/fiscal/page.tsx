"use client";

import { useEffect, useState } from "react";

type FiscalLine = {
  lineKey: string;
  title: string;
  reconstructedValue: number | null;
  auditedValue: number | null;
  errPct: number | null;
  method: string;
  sourceFeed: string;
  verdict: string;
  status: string;
};

type ForecastLine = {
  lineKey: string;
  title: string;
  forecastValue: number;
  confidence: number | null;
  actualValue: number | null;
  accuracyScore: number | null;
};

type Summary = {
  fiscalYear: string;
  totalReconstructed: number;
  totalAudited: number;
  linesWithinTenPct: number;
  linesScored: number;
  byVerdict: { automate: number; anchor: number; feed: number };
  lastUpdated: string | null;
};

function fmtM(v: number | null): string {
  if (v === null) return "—";
  return `$${(v / 1000).toFixed(1)}B`;
}

export default function FiscalPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actuals, setActuals] = useState<FiscalLine[]>([]);
  const [forecast, setForecast] = useState<ForecastLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sRes, aRes, fRes] = await Promise.all([
          fetch("/api/fiscal/summary?fiscalYear=FY2024-25"),
          fetch("/api/fiscal/actuals?fiscalYear=FY2024-25&limit=50"),
          fetch("/api/fiscal/forecast?fiscalYear=FY2026-27&limit=50"),
        ]);
        if (!sRes.ok) throw new Error("Could not load fiscal summary");
        const sData = (await sRes.json()) as Summary;
        const aData = (await aRes.json()) as { lines: FiscalLine[] };
        const fData = (await fRes.json()) as { lines: ForecastLine[] };
        if (!cancelled) {
          setSummary(sData);
          setActuals(Array.isArray(aData.lines) ? aData.lines : []);
          setForecast(Array.isArray(fData.lines) ? fData.lines : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const forecastConfidence = forecast.find((f) => f.confidence !== null)?.confidence ?? null;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2rem 1.25rem" }}>
      <h1 style={{ fontSize: "1.9rem", marginBottom: ".25rem" }}>
        Queensland Budget — reconstructed actuals &amp; forecast
      </h1>
      <p style={{ color: "#555", marginBottom: "1.5rem", maxWidth: 760 }}>
        A temporal knowledge-graph node: the General Government operating statement
        reconstructed from public data alone (no Treasury ledger access), and a
        pre-registered forecast of the next budget whose confidence rises toward
        the official release.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "#b00" }}>{error}</p>}

      {summary && (
        <section style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "2rem" }}>
          <StatCard label="Reconstructed (FY2024-25)" value={fmtM(summary.totalReconstructed)} />
          <StatCard label="Audited" value={fmtM(summary.totalAudited)} />
          <StatCard
            label="Lines within ±10%"
            value={`${summary.linesWithinTenPct}/${summary.linesScored}`}
          />
          <StatCard
            label="Verdict (auto / anchor / feed)"
            value={`${summary.byVerdict.automate} / ${summary.byVerdict.anchor} / ${summary.byVerdict.feed}`}
          />
        </section>
      )}

      {/* The temporal chain */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.2rem" }}>The budget chain</h2>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", color: "#333" }}>
          <NodeChip title="2024-25" subtitle="reconstructed · verified" />
          <span aria-hidden>→</span>
          <NodeChip title="2025-26" subtitle="released" />
          <span aria-hidden>→</span>
          <NodeChip
            title="2026-27"
            subtitle={
              forecastConfidence !== null
                ? `forecast · ${forecastConfidence.toFixed(0)}% confidence`
                : "forecast"
            }
            highlight
          />
        </div>
      </section>

      {actuals.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.2rem" }}>FY2024-25 — reconstructed vs audited</h2>
          <FiscalTable
            head={["Line", "Reconstructed", "Audited", "Err", "Method", "Feed", "Verdict"]}
            rows={actuals.map((l) => [
              l.title,
              fmtM(l.reconstructedValue),
              fmtM(l.auditedValue),
              l.errPct === null ? "—" : `${l.errPct > 0 ? "+" : ""}${l.errPct}%`,
              l.method,
              l.sourceFeed,
              l.verdict,
            ])}
          />
        </section>
      )}

      {forecast.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.2rem" }}>FY2026-27 — pre-registered forecast</h2>
          <FiscalTable
            head={["Line", "Forecast", "Actual", "Accuracy"]}
            rows={forecast.map((f) => [
              f.title,
              fmtM(f.forecastValue),
              fmtM(f.actualValue),
              f.accuracyScore === null ? "pending release" : `${f.accuracyScore}%`,
            ])}
          />
        </section>
      )}

      {summary?.lastUpdated && (
        <p style={{ color: "#888", fontSize: ".85rem" }}>
          Reconstructed actuals as of {new Date(summary.lastUpdated).toLocaleString()}.
          Refreshed nightly.
        </p>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e2e2e2", borderRadius: 8, padding: "1rem 1.25rem", minWidth: 180 }}>
      <div style={{ fontSize: ".8rem", color: "#777" }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function NodeChip({ title, subtitle, highlight }: { title: string; subtitle: string; highlight?: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${highlight ? "#1a73e8" : "#ccc"}`,
        background: highlight ? "#eef4ff" : "#fafafa",
        borderRadius: 8,
        padding: ".5rem .9rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: ".75rem", color: "#666" }}>{subtitle}</div>
    </div>
  );
}

function FiscalTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} style={{ textAlign: "left", borderBottom: "2px solid #ddd", padding: ".4rem .5rem" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} style={{ borderBottom: "1px solid #eee", padding: ".4rem .5rem" }}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
