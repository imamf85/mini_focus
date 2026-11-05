import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/session";
import { LoginThrottle } from "@/lib/throttle";

const SECRET = "x".repeat(40);

describe("sesi", () => {
  it("menandatangani dan memverifikasi; menolak secret salah dan token rusak", async () => {
    const token = await signSession("Ani", SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ name: "Ani" });
    expect(await verifySession(token, "y".repeat(40))).toBeNull();
    expect(await verifySession(token + "x", SECRET)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
  });
});

describe("throttle login", () => {
  it("mengunci setelah 5 gagal dan terbuka setelah masa kunci; sukses mereset", () => {
    let t = 0;
    const th = new LoginThrottle({ maxFails: 5, windowMs: 900_000, lockMs: 600_000 }, () => t);
    const keys = ["ip:1", "name:ani"];
    for (let i = 0; i < 4; i++) th.fail(keys);
    expect(th.retryAfter(keys)).toBe(0);
    th.fail(keys);
    expect(th.retryAfter(keys)).toBe(600);
    t += 601_000;
    expect(th.retryAfter(keys)).toBe(0);
    th.fail(keys);
    th.reset(keys);
    for (let i = 0; i < 4; i++) th.fail(keys);
    expect(th.retryAfter(keys)).toBe(0);
  });
});
