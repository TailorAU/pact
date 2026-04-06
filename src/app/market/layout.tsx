import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Market overview | Source",
  description: "Source market intelligence — fuel and grocery prices verified via PACT.",
};

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return children;
}
