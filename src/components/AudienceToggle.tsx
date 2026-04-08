"use client";
import { useAudience, type AudienceMode } from "@/contexts/audience";

const options: { value: AudienceMode; label: string; desc: string }[] = [
  { value: "explore", label: "For Humans", desc: "Browse" },
  { value: "integrate", label: "For Agents", desc: "Build" },
];

export function AudienceToggle() {
  const { mode, setMode } = useAudience();

  return (
    <div className="flex items-center bg-background/80 border border-card-border rounded-full p-0.5 text-xs">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setMode(opt.value)}
          className={`px-3 py-1 rounded-full transition-all ${
            mode === opt.value
              ? opt.value === "explore"
                ? "bg-pact-cyan text-background font-bold"
                : "bg-pact-purple text-background font-bold"
              : "text-pact-dim hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
