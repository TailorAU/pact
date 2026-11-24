import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { readBodyBounded } from "@/lib/read-body-bounded";
import {
  getSovrgnClient,
  getSovrgnModel,
  supportsCustomTemperature,
} from "@/lib/sovrgn-client";

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
  const bounded = await readBodyBounded(req);
  if (!bounded.ok) return bounded.response;

  let body: unknown;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).query
      : undefined;
  if (!query || typeof query !== "string" || query.trim().length < 2) {
    return NextResponse.json({ error: "Vehicle query too short" }, { status: 400 });
  }

  try {
    const client = getSovrgnClient();
    if (!client) {
      return NextResponse.json(
        { error: "Vehicle identification service is not configured" },
        { status: 503 },
      );
    }

    const model = getSovrgnModel();
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query.trim() },
      ],
      ...(supportsCustomTemperature(model) ? { temperature: 0.1 } : {}),
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    const choice = completion.choices[0];
    const raw = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
    if (!raw) {
      log.warn(
        { op: "vehicle.lookup.post.empty", finishReason: choice?.finish_reason ?? null },
        "[vehicle] Empty LLM completion content",
      );
      return NextResponse.json({ error: "Failed to identify vehicle" }, { status: 502 });
    }

    const parsedUnknown: unknown = JSON.parse(raw);
    if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) {
      log.warn(
        { op: "vehicle.lookup.post.invalid_shape", finishReason: choice?.finish_reason ?? null },
        "[vehicle] Non-object LLM completion payload",
      );
      return NextResponse.json({ error: "Failed to identify vehicle" }, { status: 502 });
    }

    const parsed = parsedUnknown as Record<string, unknown>;
    const hasCoreField =
      typeof parsed.fuel_type === "string" ||
      typeof parsed.consumption_l_per_100km === "number" ||
      typeof parsed.make === "string" ||
      typeof parsed.display_name === "string";
    if (!hasCoreField) {
      log.warn(
        { op: "vehicle.lookup.post.missing_fields", finishReason: choice?.finish_reason ?? null },
        "[vehicle] LLM completion missing core vehicle fields",
      );
      return NextResponse.json({ error: "Failed to identify vehicle" }, { status: 502 });
    }

    const rawDisplayName =
      typeof parsed.display_name === "string" ? parsed.display_name.trim() : "";
    const fallbackDisplayName = parsed.make
      ? `${parsed.year ?? ""} ${parsed.make ?? ""} ${parsed.model ?? ""}`.trim()
      : query.trim();

    const result = {
      make: parsed.make ?? null,
      model: parsed.model ?? null,
      year: parsed.year ?? null,
      variant: parsed.variant ?? null,
      fuel_type: typeof parsed.fuel_type === "string" && parsed.fuel_type.trim() ? parsed.fuel_type.trim() : "petrol",
      consumption_l_per_100km: clamp(parsed.consumption_l_per_100km, 1, 40),
      tank_litres: clamp(parsed.tank_litres, 20, 200),
      confidence: typeof parsed.confidence === "string" && parsed.confidence.trim() ? parsed.confidence.trim() : "high",
      display_name: rawDisplayName || fallbackDisplayName,
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
