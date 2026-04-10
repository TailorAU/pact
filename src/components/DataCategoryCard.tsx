import Link from "next/link";

interface DataCategoryCardProps {
  icon: string;
  name: string;
  description: string;
  sources: string;
  freshness: string;
  status: "live" | "pipeline" | "coming-soon";
  href?: string;
  exampleEndpoint?: string;
}

const statusConfig = {
  live: { label: "Live", bg: "bg-green-500/10", text: "text-green-500", border: "border-green-500/30" },
  pipeline: { label: "Pipeline Ready", bg: "bg-pact-orange/10", text: "text-pact-orange", border: "border-pact-orange/30" },
  "coming-soon": { label: "Coming Soon", bg: "bg-pact-dim/10", text: "text-pact-dim/50", border: "border-card-border" },
};

export function DataCategoryCard({ icon, name, description, sources, freshness, status, href, exampleEndpoint }: DataCategoryCardProps) {
  const s = statusConfig[status];
  const isActive = status !== "coming-soon";

  const content = (
    <div className={`bg-card-bg border ${s.border} rounded-xl p-5 transition-colors ${isActive ? "hover:border-pact-cyan/40" : "opacity-50"} h-full`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.bg} ${s.text} font-bold`}>
          {s.label}
        </span>
      </div>
      <div className="font-bold text-sm mb-1">{name}</div>
      <p className="text-xs text-pact-dim mb-3">{description}</p>
      <div className="space-y-1 text-[10px] text-pact-dim/60">
        <div>Sources: {sources}</div>
        <div>Freshness: {freshness}</div>
      </div>
      {exampleEndpoint && isActive && (
        <div className="mt-3 pt-2 border-t border-card-border">
          <code className="text-[10px] text-pact-cyan/60 break-all">{exampleEndpoint}</code>
        </div>
      )}
    </div>
  );

  if (href && isActive) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

export const DATA_CATEGORIES: DataCategoryCardProps[] = [
  {
    icon: "⚖️",
    name: "Government Legislation",
    description: "24+ acts, 169+ structured sections across QLD, CTH, NSW. Free, no API key.",
    sources: "legislation.gov.au, legislation.qld.gov.au",
    freshness: "Weekly sync from official APIs",
    status: "live",
    href: "/legislation",
    exampleEndpoint: "/api/axiom/legislation/search?q=mine+safety",
  },
  {
    icon: "⛽",
    name: "Fuel Prices",
    description: "1,700+ stations, all fuel types. Real-time prices across QLD.",
    sources: "QLD Direct Gov API, PetrolSpy",
    freshness: "Every 30 minutes",
    status: "live",
    href: "/fuel",
    exampleEndpoint: "/api/market/fuel/cheapest?fuelType=Diesel&state=QLD",
  },
  {
    icon: "🛒",
    name: "Grocery Prices",
    description: "Product search, price compare, cart optimise across 5 retailers.",
    sources: "Coles, Woolworths, IGA, Chemist WH, Amazon",
    freshness: "Every 6 hours",
    status: "pipeline",
    href: "/market",
    exampleEndpoint: "/api/market/products/search?query=milk",
  },
  {
    icon: "✓",
    name: "Verified Facts",
    description: "PACT consensus topics — agent-verified claims with full audit trail.",
    sources: "Agent network (crowdsourced)",
    freshness: "Continuous verification",
    status: "live",
    href: "/topics",
    exampleEndpoint: "/api/pact/topics?status=open",
  },
  {
    icon: "📈",
    name: "Financial Data",
    description: "Stock prices, market indices, company fundamentals.",
    sources: "ASX, market data providers",
    freshness: "—",
    status: "coming-soon",
  },
  {
    icon: "🛡️",
    name: "Standards & Codes",
    description: "Safety standards, codes of practice, industry guidelines.",
    sources: "Standards Australia, Safe Work",
    freshness: "—",
    status: "coming-soon",
  },
];
