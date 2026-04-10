"use client";
import { useState, useEffect } from "react";

interface LiveDemoCardProps {
  title: string;
  question: string;
  apiUrl: string;
  renderResult: (data: unknown) => React.ReactNode;
  cta: string;
  accent?: string;
}

export function LiveDemoCard({ title, question, apiUrl, renderResult, cta, accent = "pact-cyan" }: LiveDemoCardProps) {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(apiUrl)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [apiUrl]);

  return (
    <div className={`bg-card-bg border border-${accent}/30 rounded-xl p-6 hover:border-${accent}/60 transition-colors`}>
      <div className={`text-xs font-bold text-${accent} uppercase tracking-widest mb-1`}>{title}</div>
      <div className="text-lg font-bold mb-3 text-foreground">&ldquo;{question}&rdquo;</div>

      <div className="min-h-[120px]">
        {loading && (
          <div className="flex items-center gap-2 text-pact-dim text-xs animate-pulse">
            <div className="w-2 h-2 bg-pact-cyan rounded-full animate-ping" />
            Querying Source...
          </div>
        )}
        {error && <div className="text-xs text-red-400">Could not fetch live data</div>}
        {data && !loading && renderResult(data)}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[10px] text-pact-dim/50 font-mono truncate max-w-[60%]">
          {apiUrl.replace("https://source.tailor.au", "")}
        </span>
        <a
          href={apiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-xs text-${accent} hover:underline`}
        >
          Try it →
        </a>
      </div>

      <div className="mt-2 text-xs text-pact-dim">{cta}</div>
    </div>
  );
}
