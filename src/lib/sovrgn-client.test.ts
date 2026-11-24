import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SOVRGN_API_URL,
  DEFAULT_SOVRGN_MODEL,
  SOVRGN_TENANT_HEADER,
  getSovrgnClient,
  getSovrgnModel,
  normalizeSovrgnBaseUrl,
  resetSovrgnClientCache,
  supportsCustomTemperature,
} from "./sovrgn-client";
import { llmMatch } from "./scenarios/llm-match";
import { POST as vehiclePost } from "../app/api/vehicle/route";

const ORIGINAL_ENV = {
  SOVRGN_API_KEY: process.env.SOVRGN_API_KEY,
  SOVRGN_API_URL: process.env.SOVRGN_API_URL,
  SOVRGN_MODEL: process.env.SOVRGN_MODEL,
  OPENAI_ORG_ID: process.env.OPENAI_ORG_ID,
  OPENAI_PROJECT_ID: process.env.OPENAI_PROJECT_ID,
};

afterEach(() => {
  vi.restoreAllMocks();
  resetSovrgnClientCache();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function chatCompletionResponse(
  content: string | null,
  model = "gpt-5-mini",
  finishReason = "stop",
): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1700000000,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: finishReason,
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function getHeader(headers: RequestInit["headers"], name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String((headers as Record<string, string>)[key]) : null;
}

describe("sovrgn-client", () => {
  it("normalizes valid HTTPS URLs to /v1 without trailing slash", () => {
    expect(normalizeSovrgnBaseUrl(undefined)).toBe(DEFAULT_SOVRGN_API_URL);
    expect(normalizeSovrgnBaseUrl("")).toBe(DEFAULT_SOVRGN_API_URL);
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai")).toBe("https://api.sovrgn.ai/v1");
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/")).toBe("https://api.sovrgn.ai/v1");
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1/")).toBe("https://api.sovrgn.ai/v1");
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1/chat/completions")).toBe(
      "https://api.sovrgn.ai/v1",
    );
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1//chat/completions")).toBe(
      "https://api.sovrgn.ai/v1",
    );
  });

  it("rejects non-HTTPS, credentialed, query, fragment, or malformed URLs fail-closed", () => {
    expect(normalizeSovrgnBaseUrl("http://api.sovrgn.ai/v1")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://user:pass@api.sovrgn.ai/v1")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://:@api.sovrgn.ai/v1")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1?foo=bar")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1?")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1#frag")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1#")).toBeNull();
    expect(normalizeSovrgnBaseUrl("not-a-url")).toBeNull();
  });

  it("fails closed when SOVRGN_API_KEY is unset or SOVRGN_API_URL is invalid", () => {
    expect(getSovrgnClient({})).toBeNull();
    expect(getSovrgnClient({ SOVRGN_API_KEY: "   " })).toBeNull();
    expect(
      getSovrgnClient({
        SOVRGN_API_KEY: "test-key",
        SOVRGN_API_URL: "http://evil.example/v1",
      }),
    ).toBeNull();
  });

  it("resolves default model and gates temperature by model capability", () => {
    expect(getSovrgnModel({})).toBe(DEFAULT_SOVRGN_MODEL);
    expect(getSovrgnModel({ SOVRGN_MODEL: "au-inregion-gpt-41-mini" })).toBe(
      "au-inregion-gpt-41-mini",
    );
    expect(supportsCustomTemperature("tailor-fast")).toBe(false);
    expect(supportsCustomTemperature("gpt-5-mini")).toBe(false);
    expect(supportsCustomTemperature("gpt-4.1-mini")).toBe(true);
    expect(supportsCustomTemperature("au-inregion-gpt-41-mini")).toBe(true);
  });
});

describe("llmMatch via Tailor Routing", () => {
  const sampleScenarios = [
    { id: "sc-1", title: "Home Purchase QLD", predicates: { state: "QLD" } },
  ];

  it("returns null gracefully when SOVRGN_API_KEY is unset", async () => {
    delete process.env.SOVRGN_API_KEY;
    const result = await llmMatch(sampleScenarios, { intent: "buy house" });
    expect(result).toBeNull();
  });

  it("routes through api.sovrgn.ai with Bearer, tenant header, no-redirect, and reasoning token budget", async () => {
    process.env.SOVRGN_API_KEY = "sovrgn_test_key";
    process.env.SOVRGN_API_URL = "https://api.sovrgn.ai/v1";
    process.env.OPENAI_ORG_ID = "org-should-not-leak";
    process.env.OPENAI_PROJECT_ID = "proj-should-not-leak";
    delete process.env.SOVRGN_MODEL;

    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedInit = init;
      return chatCompletionResponse(
        JSON.stringify({ scenarioId: "sc-1", rationale: "Matches QLD purchase" }),
        "gpt-5-mini",
      );
    });

    const result = await llmMatch(sampleScenarios, { intent: "buy house in Brisbane" });

    expect(result).toEqual({
      model: "gpt-5-mini",
      scenarioId: "sc-1",
      rationale: "Matches QLD purchase",
    });
    expect(capturedUrl).toBe("https://api.sovrgn.ai/v1/chat/completions");
    expect(capturedInit?.redirect).toBe("error");
    expect(capturedInit?.signal).toBeDefined();
    expect(getHeader(capturedInit?.headers, "authorization")).toBe("Bearer sovrgn_test_key");
    expect(getHeader(capturedInit?.headers, "x-sovrgn-tenant")).toBe(SOVRGN_TENANT_HEADER);
    expect(getHeader(capturedInit?.headers, "openai-organization")).toBeNull();
    expect(getHeader(capturedInit?.headers, "openai-project")).toBeNull();

    const sentBody = JSON.parse(String(capturedInit?.body));
    expect(sentBody.model).toBe("tailor-fast");
    expect(sentBody.temperature).toBeUndefined();
    expect(sentBody.max_tokens).toBeGreaterThanOrEqual(2500);
  });

  it("rejects hallucinated scenarioId to null while keeping rationale", async () => {
    process.env.SOVRGN_API_KEY = "sovrgn_test_key";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      chatCompletionResponse(
        JSON.stringify({ scenarioId: "sc-invented", rationale: "Hallucinated id" }),
      ),
    );

    const result = await llmMatch(sampleScenarios, { intent: "unknown" });
    expect(result).toEqual({
      model: "gpt-5-mini",
      scenarioId: null,
      rationale: "Hallucinated id",
    });
  });

  it("returns null gracefully on empty completion, non-object JSON, or upstream 500", async () => {
    process.env.SOVRGN_API_KEY = "sovrgn_test_key";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(chatCompletionResponse("", "gpt-5-mini", "length"));
    expect(await llmMatch(sampleScenarios, { intent: "empty" })).toBeNull();

    fetchSpy.mockResolvedValueOnce(chatCompletionResponse("[]"));
    expect(await llmMatch(sampleScenarios, { intent: "array" })).toBeNull();

    fetchSpy.mockResolvedValueOnce(new Response("upstream error", { status: 500 }));
    expect(await llmMatch(sampleScenarios, { intent: "500" })).toBeNull();
  });
});

describe("POST /api/vehicle via Tailor Routing", () => {
  it("returns 400 on malformed JSON and 503 when unconfigured or invalid URL (zero outbound calls)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const badJsonRes = await vehiclePost(
      new Request("https://pact.tailor.au/api/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(badJsonRes.status).toBe(400);

    delete process.env.SOVRGN_API_KEY;
    const unconfiguredRes = await vehiclePost(
      new Request("https://pact.tailor.au/api/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "2022 Toyota Hilux" }),
      }),
    );
    expect(unconfiguredRes.status).toBe(503);

    process.env.SOVRGN_API_KEY = "sovrgn_test_key";
    process.env.SOVRGN_API_URL = "http://insecure.example/v1";
    const invalidUrlRes = await vehiclePost(
      new Request("https://pact.tailor.au/api/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "2022 Toyota Hilux" }),
      }),
    );
    expect(invalidUrlRes.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls api.sovrgn.ai/v1/chat/completions, formats display_name, and supports non-reasoning temperature", async () => {
    process.env.SOVRGN_API_KEY = "sovrgn_vehicle_key";
    process.env.SOVRGN_API_URL = "https://api.sovrgn.ai";
    process.env.SOVRGN_MODEL = "au-inregion-gpt-41-mini";

    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedInit = init;
      return chatCompletionResponse(
        JSON.stringify({
          make: "Toyota",
          model: "Hilux",
          year: 2022,
          variant: "SR5 2.8L Turbo Diesel",
          fuel_type: "diesel",
          consumption_l_per_100km: 8.4,
          tank_litres: 80,
          confidence: "high",
          display_name: "",
        }),
        "au-inregion-gpt-41-mini",
      );
    });

    const res = await vehiclePost(
      new Request("https://pact.tailor.au/api/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "2022 Toyota Hilux SR5" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.make).toBe("Toyota");
    expect(body.fuel_type).toBe("diesel");
    expect(body.display_name).toBe("2022 Toyota Hilux");

    expect(capturedUrl).toBe("https://api.sovrgn.ai/v1/chat/completions");
    expect(capturedInit?.redirect).toBe("error");
    expect(capturedInit?.signal).toBeDefined();
    expect(getHeader(capturedInit?.headers, "authorization")).toBe("Bearer sovrgn_vehicle_key");
    expect(getHeader(capturedInit?.headers, "x-sovrgn-tenant")).toBe(SOVRGN_TENANT_HEADER);

    const sentBody = JSON.parse(String(capturedInit?.body));
    expect(sentBody.model).toBe("au-inregion-gpt-41-mini");
    expect(sentBody.temperature).toBe(0.1);
    expect(sentBody.max_tokens).toBeGreaterThanOrEqual(2048);
  });

  it("fails closed with 502 on empty or non-vehicle completions instead of fabricating 200 specs", async () => {
    process.env.SOVRGN_API_KEY = "sovrgn_secret_never_leak";
    delete process.env.SOVRGN_MODEL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(chatCompletionResponse(null, "gpt-5-mini", "content_filter"));
    const nullRes = await vehiclePost(
      new Request("https://pact.tailor.au/api/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "2022 Toyota Hilux" }),
      }),
    );
    expect(nullRes.status).toBe(502);

    fetchSpy.mockResolvedValueOnce(chatCompletionResponse("{}", "gpt-5-mini", "stop"));
    const emptyObjRes = await vehiclePost(
      new Request("https://pact.tailor.au/api/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "2022 Toyota Hilux" }),
      }),
    );
    expect(emptyObjRes.status).toBe(502);

    fetchSpy.mockRejectedValueOnce(new TypeError("redirect error with sovrgn_secret_never_leak"));
    const errRes = await vehiclePost(
      new Request("https://pact.tailor.au/api/vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "2022 Toyota Hilux" }),
      }),
    );
    expect(errRes.status).toBe(500);
    const errText = await errRes.text();
    expect(errText).not.toContain("sovrgn_secret_never_leak");
  });
});
