export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function isRetryable(err: unknown): boolean {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  const status = e?.response?.status ?? e?.status ?? (typeof e?.code === "number" ? e.code : undefined);
  if (status === 429 || (typeof status === "number" && status >= 500 && status <= 599)) return true;
  return typeof e?.code === "string" && ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNABORTED"].includes(e.code);
}

/** Exponential backoff + full jitter untuk 429/5xx. Total tunggu dijaga di bawah batas fungsi Vercel. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 4, baseMs = 400, maxMs = 5000 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const cap = Math.min(maxMs, baseMs * 2 ** attempt);
      await sleep(Math.floor(random() * cap) + Math.floor(cap / 2));
    }
  }
}
