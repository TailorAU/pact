"use client";

import { useState, lazy, Suspense, useEffect } from "react";

const ConsensusGraph = lazy(() => import("./ConsensusGraph"));

export default function Graph3DSection() {
  const [show, setShow] = useState(true);
  const [webglOk, setWebglOk] = useState(true);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) setWebglOk(false);
    } catch {
      setWebglOk(false);
    }
  }, []);

  if (!webglOk) {
    return (
      <div className="mt-8 bg-card-bg border border-card-border rounded-lg p-6 text-center">
        <p className="text-pact-dim text-sm">
          3D visualization requires WebGL, which isn&apos;t available in your browser.
          The dependency tree above shows all the same data.
        </p>
      </div>
    );
  }

  if (!show) {
    return (
      <div className="mt-8 flex items-center gap-4 font-mono">
        <button
          onClick={() => setShow(true)}
          className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-foreground text-background border border-foreground hover:opacity-85 transition-opacity"
        >
          Load 3D Space Graph
        </button>
        <span className="text-xs text-pact-dim">
          Interactive 3D force-directed Space (X, Y, Z, T) &middot; Requires WebGL
        </span>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-3 font-mono">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          3D Space Coordinate Graph (X, Y, Z, T)
        </h2>
        <button
          onClick={() => setShow(false)}
          className="text-xs text-pact-dim hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Hide
        </button>
      </div>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-[600px] bg-card-bg border border-card-border">
            <div className="text-foreground font-mono animate-pulse text-sm uppercase tracking-wider">
              Loading 3D Space graph...
            </div>
          </div>
        }
      >
        <ConsensusGraph />
      </Suspense>
    </div>
  );
}
