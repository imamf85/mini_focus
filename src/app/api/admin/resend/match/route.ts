import { z } from "zod";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({ text: z.string().max(200_000) });

/** Cocokkan nomor telepon yang ditempel admin dengan kontak yang layak dikirim ulang. */
export const POST = route({ auth: "admin", body }, async ({ user, body, d }) => d.adminMatchPhones(user, body.text));
