import { z } from "zod";
import { NextResponse } from "next/server";
import { DispatchError } from "@/lib/service";
import { route } from "@/lib/api";
import { getRuntime, getSessionSecret } from "@/lib/runtime";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({ name: z.string().trim().min(1).max(60), pin: z.string().min(4).max(12) });

export const POST = route({ auth: "none", body: schema }, async ({ req, body, d }) => {
  const { throttle } = getRuntime();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const keys = [`ip:${ip}`, `name:${body.name.toLowerCase()}`];
  const wait = throttle.retryAfter(keys);
  if (wait > 0) {
    throw new DispatchError("PACING", `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit`, 429, { retryAfter: wait });
  }
  let agent;
  try {
    agent = await d.verifyLogin(body.name, body.pin);
  } catch (e) {
    if (e instanceof DispatchError && e.code === "BAD_LOGIN") throttle.fail(keys);
    throw e;
  }
  throttle.reset(keys);
  const res = NextResponse.json({ ok: true, isAdmin: agent.isAdmin }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, await signSession(agent.name, getSessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
});
