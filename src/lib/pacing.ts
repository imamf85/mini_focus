function hash01(input: string): number {
  // FNV-1a -> [0,1). Deterministik agar server stateless menjawab jeda yang sama.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Jeda acak (detik) setelah pengiriman terakhir; konstan untuk (agen, anchor) yang sama. */
export function paceDelaySec(
  agent: string,
  anchorTs: number,
  minSec: number,
  maxSec: number,
): number {
  if (maxSec <= minSec) return minSec;
  return minSec + Math.floor(hash01(`${agent}|${anchorTs}`) * (maxSec - minSec + 1));
}

/** Sisa milidetik yang harus ditunggu; 0 jika boleh lanjut. */
export function pacingWaitMs(
  agent: string,
  lastResolvedAt: number | null,
  now: number,
  minSec: number,
  maxSec: number,
): number {
  if (lastResolvedAt == null) return 0;
  const allowedAt = lastResolvedAt + paceDelaySec(agent, lastResolvedAt, minSec, maxSec) * 1000;
  return Math.max(0, allowedAt - now);
}
