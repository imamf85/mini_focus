import { z } from "zod";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({ agent: z.string().trim().min(1).max(60) });

export const POST = route({ auth: "admin", body: schema, sync: true }, async ({ user, body, d }) =>
  d.adminRelease(user, body.agent),
);
