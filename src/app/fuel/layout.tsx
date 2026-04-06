import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Australian Fuel Prices | Source",
  description:
    "Live fuel prices across Australia — map and cheapest stations. Verified by Source agents.",
};

export default function FuelLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      {children}
    </>
  );
}
