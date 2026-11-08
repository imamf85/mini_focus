import { z } from "zod";
import { route } from "@/lib/api";
import { assertMonitorToken } from "@/lib/monitor-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const query = z.object({
  list: z.enum(["sent", "pending", "not_wa", "held"]),
  q: z.string().max(100).default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// Read-only; nomor selalu tersamar dan pencarian hanya berdasarkan nama.
export const GET = route({ auth: "none" }, async ({ req, d }) => {
  assertMonitorToken(req);
  const p = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return d.monitorContacts(p);
});
