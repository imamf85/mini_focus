import { route } from "@/lib/api";
import { assertMonitorToken } from "@/lib/monitor-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Read-only, hanya agregat (tanpa nama/nomor kontak); diakses dengan token, bukan sesi agen.
export const GET = route({ auth: "none" }, async ({ req, d }) => {
  assertMonitorToken(req);
  return d.monitorSummary();
});
