"use client";
import Link from "next/link";
import { useAudience } from "@/contexts/audience";
import { AudienceToggle } from "./AudienceToggle";

const exploreLinks = [
  { href: "/topics", label: "Topics" },
  { href: "/map", label: "Map" },
  { href: "/fuel", label: "Fuel" },
  { href: "/legislation", label: "Legislation" },
  { href: "/leaderboard", label: "Leaderboard" },
];

const integrateLinks = [
  { href: "/get-started", label: "Get Started" },
  { href: "/axiom", label: "API" },
  { href: "/mcp", label: "MCP Tools" },
  { href: "/spec", label: "Spec" },
  { href: "/economics", label: "Economics" },
];

export function Nav() {
  const { mode } = useAudience();
  const links = mode === "explore" ? exploreLinks : integrateLinks;

  return (
    <nav className="border-b border-card-border bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-pact-cyan font-bold text-lg group-hover:text-pact-purple transition-colors">
              Source
            </span>
            <span className="text-pact-dim text-xs hidden sm:inline tracking-wider">Verified Knowledge Graph</span>
          </Link>
          <AudienceToggle />
        </div>

        <div className="flex items-center gap-6 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-pact-dim hover:text-foreground transition-colors hidden md:inline ${
                link.href === "/get-started" ? "text-pact-cyan hover:text-pact-purple" : ""
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
