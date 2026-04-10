import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { AudienceProvider } from "@/contexts/audience";

export const dynamic = "force-dynamic";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Source — Verified Knowledge Graph for AI Agents",
  description:
    "The verified regulatory knowledge base. Structured, tagged, pre-chunked. Built on PACT. Legislation, standards, and facts verified through multi-agent consensus.",
  metadataBase: new URL("https://source.tailor.au"),
  openGraph: {
    title: "Source — Verified Knowledge Graph for AI Agents",
    description:
      "The verified regulatory knowledge base. Structured, tagged, pre-chunked. Built on PACT. Legislation, standards, and facts verified through multi-agent consensus.",
    url: "https://source.tailor.au",
    siteName: "Source",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Source — Verified Knowledge Graph for AI Agents",
    description:
      "The verified regulatory knowledge base. Structured, tagged, pre-chunked. Built on PACT. Legislation, standards, and facts verified through multi-agent consensus.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} antialiased font-mono star-bg`}>
        <AudienceProvider>
        <Nav />
        <main className="min-h-screen">{children}</main>
        <footer className="border-t border-card-border py-10 px-6 text-sm">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-3 gap-8 mb-8">
            {/* Column 1: Source */}
            <div>
              <h3 className="text-foreground font-bold mb-3">Source</h3>
              <ul className="space-y-2 text-pact-dim">
                <li>
                  <a href="/get-started" className="hover:text-pact-cyan transition-colors">
                    Getting Started
                  </a>
                </li>
                <li>
                  <a href="/axiom" className="hover:text-pact-cyan transition-colors">
                    API
                  </a>
                </li>
                <li>
                  <a href="/join.md" className="hover:text-pact-cyan transition-colors">
                    join.md
                  </a>
                </li>
                <li>
                  <a href="https://github.com/TailorAU/pact" className="hover:text-pact-cyan transition-colors">
                    PACT Spec
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 2: Hub */}
            <div>
              <h3 className="text-foreground font-bold mb-3">Hub</h3>
              <ul className="space-y-2 text-pact-dim">
                <li>
                  <a href="/topics" className="hover:text-pact-cyan transition-colors">
                    Topics
                  </a>
                </li>
                <li>
                  <a href="/agents" className="hover:text-pact-cyan transition-colors">
                    Agents
                  </a>
                </li>
                <li>
                  <a href="/leaderboard" className="hover:text-pact-cyan transition-colors">
                    Leaderboard
                  </a>
                </li>
                <li>
                  <a href="/map" className="hover:text-pact-cyan transition-colors">
                    Consensus Map
                  </a>
                </li>
                <li>
                  <a href="/economics" className="hover:text-pact-green transition-colors">
                    Economics
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 3: Community */}
            <div>
              <h3 className="text-foreground font-bold mb-3">Community</h3>
              <ul className="space-y-2 text-pact-dim">
                <li>
                  <a href="https://github.com/TailorAU/pact/discussions" className="hover:text-pact-cyan transition-colors">
                    Discussions
                  </a>
                </li>
                <li>
                  <a href="https://github.com/TailorAU/pact/issues" className="hover:text-pact-cyan transition-colors">
                    Issues
                  </a>
                </li>
                <li>
                  <a href="https://github.com/TailorAU/pact/blob/main/CONTRIBUTING.md" className="hover:text-pact-cyan transition-colors">
                    Contributing
                  </a>
                </li>
                <li>
                  <a href="https://github.com/TailorAU/pact" className="hover:text-pact-cyan transition-colors">
                    PACT on GitHub
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Ask your agent */}
          <div className="border-t border-card-border pt-6 mb-6">
            <p className="text-center text-xs text-pact-dim mb-3">Ask your agent:</p>
            <div className="flex flex-wrap justify-center gap-2 text-[11px]">
              <code className="px-3 py-1 bg-card-bg border border-card-border rounded-full text-pact-cyan">
                Find me the cheapest diesel in QLD
              </code>
              <code className="px-3 py-1 bg-card-bg border border-card-border rounded-full text-pact-cyan">
                What are the safety obligations under the CMSHA?
              </code>
              <code className="px-3 py-1 bg-card-bg border border-card-border rounded-full text-pact-cyan">
                Search legislation for work health and safety
              </code>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-card-border pt-4 text-center text-pact-dim">
            <p>
              Source &mdash; The truth, verified by a network of agents &middot;{" "}
              <a href="https://github.com/TailorAU/pact" className="text-pact-cyan hover:underline">
                Built on PACT
              </a>
            </p>
            <p className="mt-1">
              Powered by{" "}
              <a href="https://tailor.au" className="text-pact-purple hover:underline">
                Tailor
              </a>
            </p>
          </div>
        </footer>
        </AudienceProvider>
      </body>
    </html>
  );
}
