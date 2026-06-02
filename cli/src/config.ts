import Conf from 'conf';

interface PactConfig {
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
}

const config = new Conf<PactConfig>({
  projectName: 'pact-cli',
  schema: {
    baseUrl: { type: 'string' },
    apiKey: { type: 'string' },
    accessToken: { type: 'string' },
  },
});

let agentOverride: string | null = null;

export function setAgentOverride(apiKey: string | null): void {
  agentOverride = apiKey;
}

let principalOverride: string | null = null;

/** Set by the `--as <did>` global flag. Lets one CLI install act as a specific
 * principal — the load-bearing affordance for multi-agent flows where two
 * agents share a machine but must post under distinct identities. */
export function setPrincipalOverride(principal: string | null): void {
  principalOverride = principal;
}

/**
 * The caller principal to assert via the `X-Pact-Principal` header.
 * Resolution order: `--as` flag → `PACT_PRINCIPAL` env → none.
 *
 * NOTE: a *self-asserted* principal header is honoured by dev/test servers
 * (the @pact-protocol/reference-server) so multiple local agents can be told
 * apart. A production server MUST derive the principal from the authenticated
 * credential (bearer/api-key → server-side principal mapping) and ignore or
 * reject a client-claimed principal. Treat `--as` / `PACT_PRINCIPAL` as a
 * dev affordance, not a production auth path.
 */
export function getPrincipal(): string | null {
  return principalOverride ?? process.env.PACT_PRINCIPAL ?? null;
}

export function getBaseUrl(): string {
  const url = process.env.PACT_BASE_URL ?? config.get('baseUrl');
  if (!url) {
    throw new Error(
      'No PACT server configured. Run `pact config --server <url>` or set PACT_BASE_URL.'
    );
  }
  return url.replace(/\/+$/, '');
}

export function getAuthHeader(): { key: string; value: string } | null {
  if (agentOverride) return { key: 'X-Api-Key', value: agentOverride };

  const apiKey = process.env.PACT_API_KEY ?? config.get('apiKey');
  if (apiKey) return { key: 'X-Api-Key', value: apiKey };

  const token = config.get('accessToken');
  if (token) return { key: 'Authorization', value: `Bearer ${token}` };

  return null;
}

export function setConfig(opts: { server?: string; key?: string; token?: string }): void {
  if (opts.server) config.set('baseUrl', opts.server);
  if (opts.key) config.set('apiKey', opts.key);
  if (opts.token) config.set('accessToken', opts.token);
}

export function getConfigValues(): { baseUrl?: string; apiKey?: string; hasToken: boolean } {
  return {
    baseUrl: process.env.PACT_BASE_URL ?? config.get('baseUrl'),
    apiKey: process.env.PACT_API_KEY ? '(from env)' : config.get('apiKey') ? `${config.get('apiKey')!.slice(0, 12)}...` : undefined,
    hasToken: !!config.get('accessToken'),
  };
}

export function clearConfig(): void {
  config.clear();
}
