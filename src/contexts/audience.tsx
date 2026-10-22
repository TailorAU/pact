"use client";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type AudienceMode = "explore" | "integrate";

interface AudienceContextValue {
  mode: AudienceMode;
  setMode: (m: AudienceMode) => void;
}

const AudienceContext = createContext<AudienceContextValue>({
  mode: "explore",
  setMode: () => {},
});

export const useAudience = () => useContext(AudienceContext);

function detectDefaultMode(): AudienceMode {
  if (typeof window === "undefined") return "explore";

  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "agent" || params.get("mode") === "integrate") return "integrate";

  const saved = localStorage.getItem("source-audience");
  if (saved === "explore" || saved === "integrate") return saved;

  return "explore";
}

export function AudienceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AudienceMode>("explore");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setModeState(detectDefaultMode());
    setHydrated(true);
  }, []);

  const setMode = (m: AudienceMode) => {
    setModeState(m);
    localStorage.setItem("source-audience", m);
  };

  return (
    <AudienceContext.Provider value={{ mode: hydrated ? mode : "explore", setMode }}>
      {children}
    </AudienceContext.Provider>
  );
}
