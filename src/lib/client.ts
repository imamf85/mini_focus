export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Fetch JSON; 401 mengarahkan ke /login. Tidak pernah dipanggil dalam interval otomatis < 15 dtk. */
export async function api<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    window.location.href = "/login";
    throw new ApiError("UNAUTHORIZED", "Silakan login", 401);
  }
  if (!res.ok) {
    throw new ApiError(data.error ?? "ERROR", data.message ?? "Terjadi kesalahan", res.status, data.retryAfter);
  }
  return data as T;
}

export const MIN_REFRESH_MS = 15_000;
