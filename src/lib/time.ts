// Semua logika waktu memakai WIB (UTC+7, tanpa DST).
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

export function wibParts(ms: number) {
  const d = new Date(ms + WIB_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}

/** "dd/MM/yyyy HH:mm:ss" WIB */
export function formatWIB(ms: number): string {
  const p = wibParts(ms);
  return `${pad(p.d)}/${pad(p.mo)}/${p.y} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

export function parseWIB(text: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    (text ?? "").trim(),
  );
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) - WIB_OFFSET_MS;
}

/** Kunci tanggal WIB "yyyy-MM-dd", untuk hitungan "hari ini". */
export function wibDateKey(ms: number): string {
  const p = wibParts(ms);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

export function greetingFor(ms: number): string {
  const h = wibParts(ms).h;
  if (h >= 3 && h <= 10) return "Selamat Pagi";
  if (h >= 11 && h <= 14) return "Selamat Siang";
  if (h >= 15 && h <= 17) return "Selamat Sore";
  return "Selamat Malam";
}
