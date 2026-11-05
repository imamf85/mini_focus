import { z } from "zod";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({ contactId: z.string().min(1).max(40), action: z.enum(["sent", "skip"]) });

export const POST = route({ auth: "agent", body: schema, sync: true }, async ({ user, body, d }) =>
  d.resolve(user, body.contactId, body.action),
);
