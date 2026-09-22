"use client";
import { CodeTabs } from "./CodeTabs";

const FUEL_JSON = `{
  "stationName": "Liberty Highgate Hill",
  "brandName": "Liberty",
  "address": "171 Gladstone Rd",
  "state": "QLD",
  "fuelType": "U91",
  "priceCpl": "199.9",
  "latitude": -27.4842,
  "longitude": 153.0198,
  "observedAt": "2026-04-10T00:04:21Z"
}`;

const FUEL_MCP = `{
  "content": [{
    "type": "text",
    "text": "Liberty Highgate Hill — 199.9 c/L (U91)\\n171 Gladstone Rd, QLD\\nObserved: 2026-04-10T00:04:21Z"
  }]
}`;

const FUEL_TEXT = `Liberty Highgate Hill — 199.9 c/L (U91)
171 Gladstone Rd, QLD
Observed: 2026-04-10T00:04:21Z

BP Woolloongabba — 205.9 c/L (U91)
761 Stanley St, QLD
Observed: 2026-04-10T00:04:21Z`;

const FUEL_MARKDOWN = `## Cheapest U91 in QLD

| Station | Price | Address |
|---------|-------|---------|
| Liberty Highgate Hill | 199.9 c/L | 171 Gladstone Rd |
| BP Woolloongabba | 205.9 c/L | 761 Stanley St |
| Shell Kangaroo Point | 207.9 c/L | 295 Main St |

*Updated: 2026-04-10 00:04 UTC*`;

const FORMAT_TABS = [
  { label: "JSON (REST)", code: FUEL_JSON },
  { label: "MCP Tool Response", code: FUEL_MCP },
  { label: "Plain Text", code: FUEL_TEXT },
  { label: "Markdown", code: FUEL_MARKDOWN },
];

export function FormatShowcase() {
  return (
    <div>
      <div className="text-xs text-pact-dim mb-3">
        Query: <code className="text-pact-cyan">GET /api/market/fuel/cheapest?fuelType=U91&amp;state=QLD&amp;limit=3</code>
      </div>
      <CodeTabs tabs={FORMAT_TABS} />
    </div>
  );
}
