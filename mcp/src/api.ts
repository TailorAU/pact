const baseUrl = (): string => {
  const url = process.env.PACT_BASE_URL;
  if (!url) throw new Error('PACT_BASE_URL environment variable is required.');
  return url.replace(/\/+$/, '');
};

const authHeader = (): Record<string, string> => {
  const key = process.env.PACT_API_KEY;
  if (key) return { 'X-Api-Key': key };
  const token = process.env.PACT_ACCESS_TOKEN;
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
};

export async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...authHeader(),
  };
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers as Record<string, string>)) {
      headers[k] = v;
    }
  }
  if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      const json = JSON.parse(body);
      if (json.title) message = json.title;
      if (json.detail) message += ` — ${json.detail}`;
    } catch { /* use raw */ }
    throw new Error(`HTTP ${res.status}: ${message.slice(0, 300)}`);
  }

  if (res.status === 204) return null as T;
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}
