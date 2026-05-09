import { NextResponse } from "next/server";
import { AzureOpenAI } from "openai";
import { log } from "@/lib/logger";

let _client: AzureOpenAI | null = null;
function getClient(): AzureOpenAI {
  if (!_client) {
    _client = new AzureOpenAI({
      endpoint: "https://oai-tailor-app-prod.openai.azure.com/",
      apiKey: process.env.AZURE_OPENAI_KEY,
      apiVersion: "2025-01-01-preview",
    });
  }
  return _client;
}

const SYSTEM_PROMPT = `You are a vehicle fuel efficiency database. Given a vehicle description (make, model, year, or nickname), return its specs as JSON.

Rules:
- consumption_l_per_100km: combined/mixed driving cycle figure
- tank_litres: standard fuel tank capacity
- fuel_type: one of "petrol", "diesel", "hybrid-petrol", "hybrid-diesel", "lpg", "ev"
- If the vehicle is ambiguous (e.g. "Hilux" without specifying petrol vs diesel), pick the most common Australian variant
- For EVs, set consumption_l_per_100km to the kWh/100km equivalent and fuel_type to "ev"
- Use real-world consumption figures (slightly above manufacturer claims)
- If you don't recognise the vehicle, set "confidence" to "low" and make your best guess

Respond ONLY with JSON, no markdown fences.`;

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return NextResponse.json({ error: "Vehicle query too short" }, { status: 400 });
    }

    const completion = await getClient().chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query.trim() },
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    const result = {
      make: parsed.make ?? null,
      model: parsed.model ?? null,
      year: parsed.year ?? null,
      variant: parsed.variant ?? null,
      fuel_type: parsed.fuel_type ?? "petrol",
      consumption_l_per_100km: clamp(parsed.consumption_l_per_100km, 1, 40),
      tank_litres: clamp(parsed.tank_litres, 20, 200),
      confidence: parsed.confidence ?? "high",
      display_name: parsed.display_name ?? parsed.make
        ? `${parsed.year ?? ""} ${parsed.make ?? ""} ${parsed.model ?? ""}`.trim()
        : query.trim(),
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch (err: unknown) {
    log.error({ op: "vehicle.lookup.post.error", err }, "[vehicle] LLM error");
    return NextResponse.json({ error: "Failed to identify vehicle" }, { status: 500 });
  }
}

function clamp(val: unknown, min: number, max: number): number {
  const n = Number(val);
  if (isNaN(n)) return (min + max) / 2;
  return Math.max(min, Math.min(max, n));
}
