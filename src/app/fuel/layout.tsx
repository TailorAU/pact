import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Fuel Prices — Find Cheapest Petrol & Diesel | PACT",
  description:
    "Find the cheapest fuel near you with real-time prices, drive-time ranking, and route planning. Powered by PACT.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function FuelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
