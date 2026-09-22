import type { MetadataRoute } from "next";

// Canonical host since the #3690 cutover (source.tailor.au 308-redirects here).
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pact.tailor.au";

// Public, indexable top-level routes. Dynamic detail routes
// (/topics/[id], /agents/[id], /scenarios/[id]) are intentionally
// omitted — crawlers discover them from the listing pages.
const ROUTES: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/get-started", priority: 0.9 },
  { path: "/spec", priority: 0.8 },
  { path: "/legislation", priority: 0.9 },
  { path: "/legislation/recent", priority: 0.7 },
  { path: "/topics", priority: 0.8 },
  { path: "/scenarios", priority: 0.8 },
  { path: "/agents", priority: 0.7 },
  { path: "/axiom", priority: 0.7 },
  { path: "/search", priority: 0.7 },
  { path: "/map", priority: 0.6 },
  { path: "/mcp", priority: 0.6 },
  { path: "/leaderboard", priority: 0.5 },
  { path: "/economics", priority: 0.5 },
  { path: "/fiscal", priority: 0.5 },
  { path: "/fuel", priority: 0.5 },
  { path: "/grocery", priority: 0.5 },
  { path: "/market", priority: 0.5 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map(({ path, priority }) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: "daily",
    priority,
  }));
}
