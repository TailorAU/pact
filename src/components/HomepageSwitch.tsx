"use client";
import { useAudience } from "@/contexts/audience";
import type { ReactNode } from "react";

export function ExploreOnly({ children }: { children: ReactNode }) {
  const { mode } = useAudience();
  if (mode !== "explore") return null;
  return <>{children}</>;
}

export function IntegrateOnly({ children }: { children: ReactNode }) {
  const { mode } = useAudience();
  if (mode !== "integrate") return null;
  return <>{children}</>;
}
