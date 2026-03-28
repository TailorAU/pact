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
