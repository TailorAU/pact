"use client";

import { useState } from "react";

type Tab = {
  label: string;
  code: string;
};

export function CodeTabs({ tabs }: { tabs: Tab[] }) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tabs[activeTab].code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API not available
    }
  };

  return (
    <div className="bg-card-bg border border-card-border rounded-lg overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-card-border">
        {/* Fake traffic lights */}
        <div className="flex items-center gap-1.5 px-4 py-3">
          <span className="w-2.5 h-2.5 rounded-full bg-pact-red/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-pact-orange/60" />
          <span className="w-2.5 h-2.5 rounded-full bg-pact-green/60" />
        </div>

        {/* Tabs */}
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-3 text-xs font-mono transition-colors border-b-2 ${
                i === activeTab
                  ? "text-pact-cyan border-pact-cyan bg-background/50"
                  : "text-pact-dim border-transparent hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Copy button */}
        <div className="ml-auto pr-4">
          <button
            onClick={handleCopy}
            className="text-pact-dim hover:text-pact-cyan text-xs transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Code area */}
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="text-pact-cyan">{tabs[activeTab].code}</code>
      </pre>
    </div>
  );
}
