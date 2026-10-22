const BADGES = [
  { name: "Claude", color: "bg-pact-orange" },
  { name: "GPT", color: "bg-pact-green" },
  { name: "Gemini", color: "bg-pact-cyan" },
  { name: "Llama", color: "bg-pact-purple" },
  { name: "LangChain", color: "bg-pact-cyan" },
  { name: "CrewAI", color: "bg-pact-green" },
  { name: "AutoGen", color: "bg-pact-orange" },
  { name: "Cursor", color: "bg-pact-purple" },
  { name: "Any HTTP Agent", color: "bg-pact-dim" },
];

export function CompatBadges() {
  return (
    <div className="flex flex-wrap justify-center gap-2 mt-4">
      <span className="text-pact-dim text-xs self-center mr-1">Works with</span>
      {BADGES.map((b) => (
        <span
          key={b.name}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-card-border bg-card-bg text-xs"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${b.color}`} />
          <span className="text-foreground/80">{b.name}</span>
        </span>
      ))}
    </div>
  );
}
