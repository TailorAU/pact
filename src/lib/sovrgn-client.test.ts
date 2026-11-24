import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SOVRGN_API_URL,
  DEFAULT_SOVRGN_MODEL,
  getSovrgnClient,
  getSovrgnModel,
  normalizeSovrgnBaseUrl,
  resetSovrgnClientCache,
  supportsCustomTemperature,
} from "./sovrgn-client";
import { llmMatch } from "./scenarios/llm-match";
import { POST as vehiclePost } from "../app/api/vehicle/route";

describe("sovrgn-client", () => {
  afterEach(() => {
    resetSovrgnClientCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("normalizes valid HTTPS URLs to /v1 baseURL", () => {
    expect(normalizeSovrgnBaseUrl(undefined)).toBe(DEFAULT_SOVRGN_API_URL);
    expect(normalizeSovrgnBaseUrl("")).toBe(DEFAULT_SOVRGN_API_URL);
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai")).toBe("https://api.sovrgn.ai/v1");
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/")).toBe("https://api.sovrgn.ai/v1");
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1")).toBe("https://api.sovrgn.ai/v1");
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1/")).toBe("https://api.sovrgn.ai/v1");
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1/chat/completions")).toBe(
      "https://api.sovrgn.ai/v1",
    );
  });

  it("rejects non-HTTPS, malformed, query/fragment, or credentialed URLs (fail-closed)", () => {
    expect(normalizeSovrgnBaseUrl("http://api.sovrgn.ai/v1")).toBeNull();
    expect(normalizeSovrgnBaseUrl("ftp://api.sovrgn.ai/v1")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://user:pass@api.sovrgn.ai/v1")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1?foo=bar")).toBeNull();
    expect(normalizeSovrgnBaseUrl("https://api.sovrgn.ai/v1#frag")).toBeNull();
    expect(normalizeSovrgnBaseUrl("/v1/chat/completions")).toBeNull();
  });

  it("returns null when SOVRGN_API_KEY is unset or SOVRGN_API_URL is invalid", () => {
    expect(getSovrgnClient({})).toBeNull();
    expect(getSovrgnClient({ SOVRGN_API_KEY: "   " })).toBeNull();
    expect(
      getSovrgnClient({
        SOVRGN_API_KEY: "sk-test",
        SOVRGN_API_URL: "http://insecure.example/v1",
      }),
    ).toBeNull();
  });

  it("resolves model default and gates custom temperature for capability/reasoning tiers", () => {
    expect(getSovrgnModel({})).toBe(DEFAULT_SOVRGN_MODEL);
    expect(getSovrgnModel({ SOVRGN_MODEL: "au-inregion-gpt-41-mini" })).toBe(
      "au-inregion-gpt-41-mini",
    );
    expect(supportsCustomTemperature("tailor-fast")).toBe(false);
    expect(supportsCustomTemperature("gpt-5-mini")).toBe(false);
    expect(supportsCustomTemperature("gpt-4.1-mini")).toBe(true);
    expect(supportsCustomTemperature("au-inregion-gpt-41-mini")).toBe(true);
  });

  it("llmMatch degrades gracefully to null when SOVRGN_API_KEY is unset", async () => {
    vi.stubEnv("SOVRGN_API_KEY", "");
    const res = await llmMatch([{ id: "s1", title: "Test", predicates: {} }], { q: "x" });
    expect(res).toBeNull();
  });

  it("llmMatch routes through api.sovrgn.ai/v1 and validates returned scenarioId", async () => {
    vi.stubEnv("SOVRGN_API_KEY", "sovrgn-test-key");
    vi.stubEnv("SOVRGN_API_URL", "https://api.sovrgn.ai/v1");
    vi.stubEnv("SOVRGN_MODEL", "tailor-fast");

    let capturedUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-match",
          object: "chat.completion",
          created: 1700000000,
          model: "au-inregion-gpt-41-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({ scenarioId: "s1", rationale: "Matches predicates." }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const res = await llmMatch([{ id: "s1", title: "Test", predicates: {} }], { q: "x" });
    expect(capturedUrl).toBe("https://api.sovrgn.ai/v1/chat/completions");
    expect(res).toEqual({
      model: "au-inregion-gpt-41-mini",
      scenarioId: "s1",
      rationale: "Matches predicates.",
    });
  });

  it("POST /api/vehicle returns 503 when SOVRGN_API_KEY is unset", async () => {
    vi.stubEnv("SOVRGN_API_KEY", "");
    const req = new Request("https://pact.tailor.au/api/vehicle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "2022 Toyota Hilux" }),
    });
    const res = await vehiclePost(req);
    expect(res.status).toBe(503);
  });

  it("POST /api/vehicle routes to https://api.sovrgn.ai/v1 with Bearer auth, X-Sovrgn-Tenant, and redirect:error", async () => {
    vi.stubEnv("SOVRGN_API_KEY", "sovrgn-test-key");
    vi.stubEnv("SOVRGN_API_URL", "https://api.sovrgn.ai");
    vi.stubEnv("SOVRGN_MODEL", "tailor-fast");

    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1700000000,
          model: "au-inregion-gpt-41-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  make: "Toyota",
                  model: "Hilux",
                  year: 2022,
                  variant: "SR5 4x4",
                  fuel_type: "diesel",
                  consumption_l_per_100km: 8.5,
                  tank_litres: 80,
                  confidence: "high",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const req = new Request("https://pact.tailor.au/api/vehicle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "2022 Toyota Hilux" }),
    });
    const res = await vehiclePost(req);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe("https://api.sovrgn.ai/v1/chat/completions");
    expect(capturedInit?.redirect).toBe("error");
    const hdrs = new Headers(capturedInit?.headers);
    expect(hdrs.get("authorization")).toBe("Bearer sovrgn-test-key");
    expect(hdrs.get("x-sovrgn-tenant")).toBe("pact");

    const sentBody = JSON.parse(String(capturedInit?.body));
    expect(sentBody.model).toBe("tailor-fast");
    expect(sentBody.temperature).toBeUndefined();

    const json = await res.json();
    expect(json.make).toBe("Toyota");
    expect(json.display_name).toBe("2022 Toyota Hilux");
    expect(json.consumption_l_per_100km).toBe(8.5);
  });
});
