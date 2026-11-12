import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { AgentModeStrip } from "@/components/AgentModeStrip";
import { AudienceProvider } from "@/contexts/audience";

export const dynamic = "force-dynamic";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "PACT — Canonical Layer of Agreement · Space, Fabric & Seam";
const DESCRIPTION =
  "Australian intelligence for the world. Cheap, safe, secure, reliable tokens. The X, Y, Z, T public Space of legislation, verified claims, and scenarios above every 2D Fabric and 1D Seam.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL("https://pact.tailor.au"),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://pact.tailor.au",
    siteName: "PACT",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} antialiased font-serif star-bg`}>
        <AudienceProvider>
        <Nav />
        <AgentModeStrip />
        <main className="min-h-screen">{children}</main>
        <footer className="border-t border-card-border py-10 px-6 text-sm">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-3 gap-8 mb-8">
            {/* Column 1: PACT */}
            <div>
              <h3 className="text-foreground font-bold mb-3 tracking-wide">PACT</h3>
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
                    Space (/map)
                  </a>
                </li>
                <li>
                  <a href="/market" className="hover:text-pact-cyan transition-colors">
                    Intelligence Market
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
                  <a href="https://github.com/TailorAU/pact/blob/8d0f3055a28df789c94d1a0ea44e9df80511084a/CONTRIBUTING.md" className="hover:text-pact-cyan transition-colors">
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
              <span className="tracking-wide font-bold text-foreground">PACT</span> &mdash; Canonical layer of agreement &middot; Cheap, safe, secure, reliable tokens &middot;{" "}
              <a href="https://github.com/TailorAU/pact" className="text-pact-cyan underline underline-offset-2 hover:text-foreground">
                Protocol code MIT &middot; Specification royalty-free
              </a>
            </p>
            <p className="mt-1">
              Tailor Intelligence Pty Ltd &middot;{" "}
              <a href="https://tailor.au" className="text-pact-purple underline underline-offset-2 hover:text-foreground">
                Tailor Group
              </a>
            </p>
            <p className="mt-1 text-xs">
              <a href="/privacy" className="hover:text-pact-cyan transition-colors">
                Privacy
              </a>{" "}
              &middot;{" "}
              <a href="/terms" className="hover:text-pact-cyan transition-colors">
                Terms
              </a>
            </p>
          </div>
        </footer>
        </AudienceProvider>
      </body>
    </html>
  );
}
