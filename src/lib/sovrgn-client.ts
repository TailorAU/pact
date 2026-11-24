/**
 * Shared Tailor Routing (SOVRGN) OpenAI-compatible client for PACT.
 *
 * Routes LLM calls through `https://api.sovrgn.ai/v1` (override via
 * `SOVRGN_API_URL`) using the caller's server-side `SOVRGN_API_KEY`
 * (`Authorization: Bearer <key>`) and `X-Sovrgn-Tenant: pact`.
 *
 * Fail-closed: returns `null` when `SOVRGN_API_KEY` is unset or when
 * `SOVRGN_API_URL` is not a valid credential-free HTTPS URL. Never follows
 * HTTP redirects (prevents leaking bearer tokens or prompts on 3xx).
 */
import OpenAI from "openai";

export const DEFAULT_SOVRGN_API_URL = "https://api.sovrgn.ai/v1";
export const DEFAULT_SOVRGN_MODEL = "tailor-fast";
export const SOVRGN_TENANT_HEADER = "pact";
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Validates and normalizes `SOVRGN_API_URL` into an OpenAI-SDK `baseURL`
 * ending in `/v1` (without trailing slash). Returns `null` when invalid,
 * non-HTTPS, or carrying embedded credentials (`user:pass@`).
 */
export function normalizeSovrgnBaseUrl(raw?: string | null): string | null {
  const input = (raw ?? "").trim() || DEFAULT_SOVRGN_API_URL;
  // Reject explicit query, fragment, or userinfo markers even when empty (e.g. "?", "#", ":@").
  if (input.includes("?") || input.includes("#") || input.includes("@")) return null;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.search || parsed.hash) return null;

  const path = parsed.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    const base = path.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
    return `${parsed.origin}${base || "/v1"}`;
  }
  if (path.endsWith("/v1")) {
    return `${parsed.origin}${path}`;
  }
  return `${parsed.origin}${path}/v1`;
}

export function getSovrgnModel(env: Record<string, string | undefined> = process.env): string {
  return (env.SOVRGN_MODEL ?? "").trim() || DEFAULT_SOVRGN_MODEL;
}

const NON_REASONING_MODELS = new Set([
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "au-inregion-gpt-4o",
  "au-inregion-gpt-41-mini",
]);

/**
 * Only send custom `temperature` to known non-reasoning models; capability
 * aliases (`tailor-fast`, `tailor-smart`, `tailor-sovereign`) and `gpt-5*` /
 * `o*` models may reject or ignore non-default temperature.
 */
export function supportsCustomTemperature(model: string): boolean {
  return NON_REASONING_MODELS.has(model.trim().toLowerCase());
}

const noRedirectFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: "error" });

let _cachedClient: OpenAI | null = null;
let _cachedKey = "";
let _cachedBaseUrl = "";

export function getSovrgnClient(env: Record<string, string | undefined> = process.env): OpenAI | null {
  const apiKey = (env.SOVRGN_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const baseURL = normalizeSovrgnBaseUrl(env.SOVRGN_API_URL);
  if (!baseURL) return null;

  // Avoid leaking cached instance across test env mutations.
  if (env === process.env && _cachedClient && _cachedKey === apiKey && _cachedBaseUrl === baseURL) {
    return _cachedClient;
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    organization: null,
    project: null,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
    fetch: noRedirectFetch,
    defaultHeaders: {
      "X-Sovrgn-Tenant": SOVRGN_TENANT_HEADER,
    },
  });

  if (env === process.env) {
    _cachedClient = client;
    _cachedKey = apiKey;
    _cachedBaseUrl = baseURL;
  }
  return client;
}

export function resetSovrgnClientCache(): void {
  _cachedClient = null;
  _cachedKey = "";
  _cachedBaseUrl = "";
}
