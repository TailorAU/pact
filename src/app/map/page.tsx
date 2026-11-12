import { PactEditorialSite } from "@/components/PactEditorialSite";

export const metadata = {
  title: "The Space — PACT (X, Y, Z, T Public Law & Shared Reality)",
  description:
    "Every 2D Fabric exists inside a shared 4D Space (X, Y, Z, T). Filter verified claims, legislation, and trigger scenarios across dependency depth.",
};

export default function MapPage() {
  return <PactEditorialSite initialPage="space" />;
}
