/** Cliente HTTP + SSE mínimo para `opencode serve` (sin dependencias). */

export interface OcHttp {
  baseUrl: string;
  authHeader: string;
  directory: string;
}

export function basicAuth(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export async function ocFetch(h: OcHttp, method: string, path: string, body?: unknown, signal?: AbortSignal, timeoutMs = 15_000): Promise<Response> {
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  return fetch(h.baseUrl + path, {
    method,
    headers: {
      authorization: h.authHeader,
      "content-type": "application/json",
      "x-opencode-directory": encodeURIComponent(h.directory),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: sig,
  });
}

export async function ocJson<T>(h: OcHttp, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await ocFetch(h, method, path, body, signal);
  if (!r.ok) throw new Error(`${method} ${path} -> HTTP ${r.status}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Parsea un cuerpo SSE; emite el JSON de cada `data:`. */
export async function* parseSse(res: Response): AsyncGenerator<unknown> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        try {
          yield JSON.parse(data);
        } catch {
          /* línea no JSON: se ignora */
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}
