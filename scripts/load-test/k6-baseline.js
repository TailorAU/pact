// k6 baseline load test for Source.
//
// Hits the three highest-traffic public endpoints under increasing load:
//   - GET /api/health        (cheap probe, sanity check)
//   - GET /api/hub/stats     (cached read-through from Redis)
//   - GET /api/axiom/legislation/search?q=...  (uncached search; baseline for future cache work)
//
// Stages walk through 10 → 100 → 500 → 1000 RPS-ish virtual-user counts so
// you can see where each endpoint starts to degrade. Adjust SOURCE_BASE_URL
// for the environment you're testing.
//
// Usage:
//   # Baseline against prod
//   SOURCE_BASE_URL=https://source.tailor.au k6 run k6-baseline.js
//
//   # Spike test against dev
//   SOURCE_BASE_URL=https://source-dev.tailor.au k6 run --vus 200 --duration 60s k6-baseline.js
//
// Install k6: https://k6.io/docs/get-started/installation/  (brew install k6 / choco install k6 / etc.)
//
// SLA targets — see sites/source/docs/PERFORMANCE.md.

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.SOURCE_BASE_URL || "https://source.tailor.au";

// Custom per-endpoint trend metrics so the summary table groups by route.
const healthTrend = new Trend("health_latency_ms", true);
const statsTrend = new Trend("hub_stats_latency_ms", true);
const searchTrend = new Trend("legislation_search_latency_ms", true);
const errors = new Rate("error_rate");

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },   // warm-up
        { duration: "1m",  target: 50 },   // moderate
        { duration: "1m",  target: 100 },  // baseline
        { duration: "1m",  target: 250 },  // burst
        { duration: "30s", target: 0 },    // cool-down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // Tier-1 SLA targets — fail the test if any threshold is breached.
    http_req_failed: ["rate<0.01"],                  // < 1% errors
    "health_latency_ms":              ["p(99)<500"],  // /api/health p99 under 500ms
    "hub_stats_latency_ms":           ["p(99)<800"],  // /api/hub/stats p99 under 800ms (cached)
    "legislation_search_latency_ms":  ["p(99)<2000"], // /api/axiom/legislation/search p99 under 2s (uncached today)
  },
};

const SEARCH_QUERIES = [
  "assault",
  "construction",
  "privacy",
  "mining safety",
  "AML",
  "ASX listing rule",
  "DFARS",
  "JORC",
];

export default function () {
  // 1) Health probe — cheap; tracks readiness baseline
  let res = http.get(`${BASE}/api/health`, { tags: { endpoint: "health" } });
  healthTrend.add(res.timings.duration);
  errors.add(res.status >= 400);
  check(res, {
    "health 200 or 503 (well-formed)": (r) => r.status === 200 || r.status === 503,
    "health body has status field": (r) => {
      try {
        return JSON.parse(r.body).status !== undefined;
      } catch {
        return false;
      }
    },
  });

  // 2) Hub stats — read-through cached (target the cache-hit path)
  res = http.get(`${BASE}/api/hub/stats`, { tags: { endpoint: "hub-stats" } });
  statsTrend.add(res.timings.duration);
  errors.add(res.status >= 400);
  check(res, {
    "hub stats 200": (r) => r.status === 200,
  });

  // 3) Legislation search — uncached today; baseline for future cache work
  const q = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  res = http.get(`${BASE}/api/axiom/legislation/search?q=${encodeURIComponent(q)}&limit=10`, {
    tags: { endpoint: "legislation-search" },
  });
  searchTrend.add(res.timings.duration);
  errors.add(res.status >= 400);
  check(res, {
    "search 200": (r) => r.status === 200,
  });

  // Pace each VU at ~1 iteration / second to mimic real traffic shape.
  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const fmt = (mt) => {
    if (!mt || !mt.values) return "n/a";
    const v = mt.values;
    return `min=${(v.min || 0).toFixed(0)}  med=${(v.med || 0).toFixed(0)}  p95=${(v["p(95)"] || 0).toFixed(0)}  p99=${(v["p(99)"] || 0).toFixed(0)}  max=${(v.max || 0).toFixed(0)}`;
  };
  return `
Source k6 baseline summary
==========================
Base URL:                ${BASE}
Iterations:              ${m.iterations?.values?.count ?? 0}
Error rate:              ${((m.error_rate?.values?.rate ?? 0) * 100).toFixed(2)}%
http_req_failed:         ${((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}%

Per-endpoint latency (ms):
  /api/health                       ${fmt(m.health_latency_ms)}
  /api/hub/stats                    ${fmt(m.hub_stats_latency_ms)}
  /api/axiom/legislation/search     ${fmt(m.legislation_search_latency_ms)}

Thresholds:
  ${Object.entries(data.metrics)
    .filter(([_, mm]) => mm.thresholds)
    .map(([n, mm]) =>
      Object.entries(mm.thresholds)
        .map(([t, ok]) => `  ${ok.ok ? "PASS" : "FAIL"}  ${n}  ${t}`)
        .join("\n")
    )
    .join("\n")}
`;
}
