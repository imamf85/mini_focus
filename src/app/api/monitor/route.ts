import { createHash, timingSafeEqual } from "node:crypto";
import { route } from "@/lib/api";
import { loadMonitorToken } from "@/lib/config";
import { DispatchError } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const digest = (v: string) => createHash("sha256").update(v).digest();

// Read-only, hanya agregat (tanpa nama/nomor kontak); diakses dengan token, bukan sesi agen.
export const GET = route({ auth: "none" }, async ({ req, d }) => {
  const token = loadMonitorToken();
  if (!token) throw new DispatchError("NOT_FOUND", "Monitor tidak aktif", 404);
  const given = req.headers.get("x-monitor-key") ?? "";
  if (!timingSafeEqual(digest(given), digest(token))) throw new DispatchError("FORBIDDEN", "Token tidak valid", 403);
  return d.monitorSummary();
});
