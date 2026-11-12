"use client";
import { useAudience, type AudienceMode } from "@/contexts/audience";

const options: { value: AudienceMode; label: string; desc: string }[] = [
  { value: "explore", label: "For Humans", desc: "Browse" },
  { value: "integrate", label: "For Agents", desc: "Build" },
];

export function AudienceToggle() {
  const { mode, setMode } = useAudience();

  return (
    <div className="flex items-center bg-background border border-card-border rounded-none p-0.5 text-xs font-mono">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          className={`px-3 py-1 transition-all ${
            mode === opt.value
              ? "bg-foreground text-background font-bold"
              : "text-pact-dim hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
