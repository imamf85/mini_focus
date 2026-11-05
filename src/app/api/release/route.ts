import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = route({ auth: "agent", sync: true }, async ({ user, d }) => d.releaseMine(user));
