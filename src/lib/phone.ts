/** Ambil digit saja; 0xxx -> 62xxx; 8xxx -> 628xxx. */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

/** Untuk log: jangan pernah mencetak nomor lengkap. */
export function maskPhone(raw: string): string {
  const p = normalizePhone(raw);
  if (p.length <= 6) return "***";
  return p.slice(0, 4) + "*".repeat(p.length - 6) + p.slice(-2);
}
