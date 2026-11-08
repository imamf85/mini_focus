import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { loadMonitorToken } from "./config";
import { DispatchError } from "./service";

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Token halaman monitor (read-only) lewat header x-monitor-key; bukan sesi agen. */
export function assertMonitorToken(req: NextRequest) {
  const token = loadMonitorToken();
  if (!token) throw new DispatchError("NOT_FOUND", "Monitor tidak aktif", 404);
  const given = req.headers.get("x-monitor-key") ?? "";
  if (!timingSafeEqual(digest(given), digest(token))) throw new DispatchError("FORBIDDEN", "Token tidak valid", 403);
}
