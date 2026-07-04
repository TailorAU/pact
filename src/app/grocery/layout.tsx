import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Grocery search | PACT",
  description: "Search grocery products and compare prices across Australian retailers.",
};

export default function GroceryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
