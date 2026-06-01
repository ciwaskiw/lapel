import { convert } from 'html-to-text';

export function stripHtml(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [{ selector: 'a', options: { ignoreHref: true } }],
  })
    .replace(/ /g, ' ')
    .trim();
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: { retries?: number; backoffMs?: number; init?: RequestInit; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const { retries = 3, backoffMs = 300, init, fetchImpl = fetch } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries)
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}
