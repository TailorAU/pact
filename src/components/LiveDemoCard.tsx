"use client";
import { useState, useEffect, type ReactNode } from "react";

const ACCENT_STYLES = {
  "green-500": {
    border: "border-green-500/30",
    hoverBorder: "hover:border-green-500/60",
    text: "text-green-500",
  },
  "pact-cyan": {
    border: "border-pact-cyan/30",
    hoverBorder: "hover:border-pact-cyan/60",
    text: "text-pact-cyan",
  },
} as const;

type AccentKey = keyof typeof ACCENT_STYLES;

interface LiveDemoCardProps {
  title: string;
  question: string;
  apiUrl: string;
  renderResult: (data: Record<string, unknown> | Record<string, unknown>[]) => ReactNode;
  cta: string;
  accent?: AccentKey;
}

export function LiveDemoCard({ title, question, apiUrl, renderResult, cta, accent = "pact-cyan" }: LiveDemoCardProps) {
  const [result, setResult] = useState<ReactNode>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const a = ACCENT_STYLES[accent];

  useEffect(() => {
    fetch(apiUrl)
      .then(r => r.json())
      .then(d => { setResult(renderResult(d)); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  return (
    <div className={`bg-card-bg border ${a.border} rounded-xl p-6 ${a.hoverBorder} transition-colors`}>
      <div className={`text-xs font-bold ${a.text} uppercase tracking-widest mb-1`}>{title}</div>
      <div className="text-lg font-bold mb-3 text-foreground">&ldquo;{question}&rdquo;</div>

      <div className="min-h-[120px]">
        {loading && (
          <div className="flex items-center gap-2 text-pact-dim text-xs animate-pulse">
            <div className="w-2 h-2 bg-pact-cyan rounded-full animate-ping" />
            Querying Source...
          </div>
        )}
        {error && <div className="text-xs text-red-400">Could not fetch live data</div>}
        {!loading && !error && result}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[10px] text-pact-dim/50 font-mono truncate max-w-[60%]">
          {apiUrl.replace("https://source.tailor.au", "")}
        </span>
        <a
          href={apiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-xs ${a.text} hover:underline`}
        >
          Try it &rarr;
        </a>
      </div>

      <div className="mt-2 text-xs text-pact-dim">{cta}</div>
    </div>
  );
}
