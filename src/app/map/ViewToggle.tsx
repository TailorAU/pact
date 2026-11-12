"use client";

import { useState, lazy, Suspense } from "react";

const ConsensusGraph = lazy(() => import("./ConsensusGraph"));
const ConsensusTree = lazy(() => import("./ConsensusTree"));

type ViewMode = "graph" | "tree";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-[600px] bg-black rounded-lg border border-card-border">
      <div className="text-white animate-pulse text-lg font-mono">Loading visualization...</div>
    </div>
  );
}

export default function ViewToggle() {
  const [view, setView] = useState<ViewMode>("graph");

  return (
    <div>
      {/* Toggle buttons */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center bg-card-bg border border-card-border rounded-lg p-1">
          <button
            onClick={() => setView("graph")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              view === "graph"
                ? "bg-foreground text-background border border-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            3D Space Graph
          </button>
          <button
            onClick={() => setView("tree")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              view === "tree"
                ? "bg-foreground text-background border border-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            Dependency Tree
          </button>
        </div>
        <span className="text-xs text-muted ml-2">
          {view === "graph" ? "Orbit · Zoom · Click nodes" : "Click to expand · Double-click to open · Scroll to zoom · Drag to pan"}
        </span>
      </div>

      {/* View content */}
      <Suspense fallback={<LoadingFallback />}>
        {view === "graph" ? <ConsensusGraph /> : <ConsensusTree />}
      </Suspense>
    </div>
  );
}
