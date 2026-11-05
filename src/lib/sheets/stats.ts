import { AsyncLocalStorage } from "node:async_hooks";

interface Stats {
  label: string;
  reads: number;
  writes: number;
}

const als = new AsyncLocalStorage<Stats>();

export function recordCall(kind: "read" | "write") {
  const s = als.getStore();
  if (!s) return;
  if (kind === "read") s.reads++;
  else s.writes++;
}

/** Mode development: catat jumlah panggilan Sheets API per request untuk audit kuota. */
export async function withCallStats<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const stats: Stats = { label, reads: 0, writes: 0 };
  try {
    return await als.run(stats, fn);
  } finally {
    if (process.env.NODE_ENV === "development") {
      console.log(`[sheets] ${label} -> baca=${stats.reads} tulis=${stats.writes}`);
    }
  }
}
