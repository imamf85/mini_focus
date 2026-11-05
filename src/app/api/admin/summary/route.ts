import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({ auth: "admin", sync: true }, async ({ user, d }) => d.adminSummary(user));
