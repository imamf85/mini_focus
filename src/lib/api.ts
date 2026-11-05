import { after, NextRequest, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { DispatchError, type Dispatch } from "./service";
import { getRuntime, getSessionSecret } from "./runtime";
import { SESSION_COOKIE, verifySession } from "./session";
import { withCallStats } from "./sheets/stats";

interface Ctx<T> {
  req: NextRequest;
  body: T;
  /** Nama agen dari sesi (kosong untuk rute tanpa auth). */
  user: string;
  d: Dispatch;
}

interface Options<T> {
  auth: "none" | "agent" | "admin";
  body?: ZodType<T>;
  /** Jalankan sinkronisasi balik ke sheet secara malas di akhir request. */
  sync?: boolean;
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(data, { status: init.status ?? 200, headers: { ...NO_STORE, ...init.headers } });
}

export function route<T = undefined>(opts: Options<T>, handler: (ctx: Ctx<T>) => Promise<unknown>) {
  return (req: NextRequest) =>
    withCallStats(`${req.method} ${req.nextUrl.pathname}`, async () => {
      try {
        const { dispatch } = getRuntime();
        let user = "";
        if (opts.auth !== "none") {
          const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, getSessionSecret());
          if (!s) throw new DispatchError("UNAUTHORIZED", "Silakan login", 401);
          user = s.name;
          if (opts.auth === "admin") {
            const snap = await dispatch.store.snapshot();
            if (!dispatch.requireAgent(snap, user).isAdmin) throw new DispatchError("FORBIDDEN", "Khusus admin", 403);
          }
        }

        let body = undefined as T;
        if (opts.body) {
          if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
            return json({ error: "BAD_REQUEST", message: "Content-Type harus application/json" }, { status: 415 });
          }
          body = opts.body.parse(await req.json().catch(() => ({})));
        }

        const out = await handler({ req, body, user, d: dispatch });
        if (opts.sync) after(() => dispatch.sync().catch((e) => console.error("[sync]", e instanceof Error ? e.message : e)));
        return out instanceof Response ? out : json(out);
      } catch (e) {
        if (e instanceof DispatchError) {
          const headers: Record<string, string> = {};
          if (typeof e.extra.retryAfter === "number") headers["Retry-After"] = String(e.extra.retryAfter);
          return json({ error: e.code, message: e.message, ...e.extra }, { status: e.status, headers });
        }
        if (e instanceof ZodError) return json({ error: "BAD_REQUEST", message: "Input tidak valid" }, { status: 400 });
        // jangan bocorkan detail internal (bisa memuat kredensial/URL) ke klien
        console.error("[api]", e instanceof Error ? e.message : "kesalahan tidak dikenal");
        return json({ error: "INTERNAL", message: "Terjadi kesalahan server" }, { status: 500 });
      }
    });
}
