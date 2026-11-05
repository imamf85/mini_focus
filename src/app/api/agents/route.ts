import { json, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = route({ auth: "none" }, async ({ d }) => json({ names: await d.activeAgentNames() }));
