import { z } from "zod";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const query = z.object({
  q: z.string().trim().max(100).default(""),
  from: day.optional(),
  to: day.optional(),
  source: z.enum(["all", "bot", "manual"]).default("all"),
  operator: z.string().trim().max(60).default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Daftar kontak yang bisa dikirim ulang (sudah pernah terkirim), dengan filter. */
export const GET = route({ auth: "admin" }, async ({ req, user, d }) => {
  const sp = req.nextUrl.searchParams;
  const opts = query.parse({
    q: sp.get("q") ?? undefined,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    source: sp.get("source") ?? undefined,
    operator: sp.get("operator") ?? undefined,
    offset: sp.get("offset") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  return d.adminResendCandidates(user, opts);
});

const body = z.object({ contactIds: z.array(z.string().min(1).max(100)).min(1).max(5000) });

/** Buka ulang kontak terpilih agar masuk antrean klaim biasa. */
export const POST = route({ auth: "admin", body, sync: true }, async ({ user, body, d }) =>
  d.adminReopen(user, body.contactIds),
);
