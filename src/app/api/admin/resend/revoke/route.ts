import { z } from "zod";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Tanpa contactIds = batalkan semua kirim ulang yang masih antre.
const body = z.object({ contactIds: z.array(z.string().min(1).max(100)).min(1).max(5000).optional() });

/** Batalkan antrean kirim ulang yang belum diambil agen. */
export const POST = route({ auth: "admin", body, sync: true }, async ({ user, body, d }) =>
  d.adminRevokeReopen(user, body.contactIds),
);
