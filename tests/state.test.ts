import { describe, expect, it } from "vitest";
import { canResolve, reduceEvents } from "@/lib/state";
import type { EventAction, SheetEvent } from "@/lib/types";

const MIN = 60_000;
const cfg = { claimTimeoutMs: 60 * MIN };
const T0 = Date.UTC(2026, 10, 5, 3, 0, 0);

const ev = (
  action: EventAction,
  agent: string,
  contactId: string,
  tMin: number,
  batchId = "b1",
): SheetEvent => ({ ts: T0 + tMin * MIN, contactId, action, agent, batchId, note: "" });

describe("reduceEvents", () => {
  it("kontak tanpa klaim tidak punya state; klaim pertama membuat claimed", () => {
    const s = reduceEvents([ev("claim", "A", "c1", 0)], T0 + MIN, cfg);
    expect(s.get("c1")).toMatchObject({ state: "claimed", holder: "A", claimedAt: T0 });
  });

  it("dua agen klaim kontak sama: yang event-nya lebih awal di log menang", () => {
    const s = reduceEvents([ev("claim", "A", "c1", 0), ev("claim", "B", "c1", 0)], T0, cfg);
    expect(s.get("c1")?.holder).toBe("A");
    const s2 = reduceEvents([ev("claim", "B", "c1", 0), ev("claim", "A", "c1", 0)], T0, cfg);
    expect(s2.get("c1")?.holder).toBe("B");
  });

  it("klaim pada kontak yang sedang dipegang diabaikan (batch id tidak tertimpa)", () => {
    const s = reduceEvents(
      [ev("claim", "A", "c1", 0, "bA"), ev("claim", "B", "c1", 5, "bB")],
      T0 + 6 * MIN,
      cfg,
    );
    expect(s.get("c1")).toMatchObject({ holder: "A", batchId: "bA" });
  });

  it("klaim kedaluwarsa bisa diambil agen lain; sent pemegang lama ditolak", () => {
    const events = [
      ev("claim", "A", "c1", 0),
      ev("claim", "B", "c1", 61), // A tidak aktif > 60 menit
      ev("sent", "A", "c1", 62),
    ];
    const s = reduceEvents(events, T0 + 63 * MIN, cfg);
    expect(s.get("c1")).toMatchObject({ state: "claimed", holder: "B" });
    expect(canResolve(s.get("c1"), "A")).toBe(false);
    expect(canResolve(s.get("c1"), "B")).toBe(true);
  });

  it("aktivitas pemegang di kontak lain menjaga klaimnya tetap hidup", () => {
    const events = [
      ev("claim", "A", "c1", 0),
      ev("claim", "A", "c2", 0),
      ev("sent", "A", "c2", 50),
      ev("claim", "B", "c1", 70), // A aktif di menit 50 -> belum kedaluwarsa
    ];
    const s = reduceEvents(events, T0 + 71 * MIN, cfg);
    expect(s.get("c1")?.holder).toBe("A");
    expect(s.get("c2")?.state).toBe("sent");
  });

  it("klaim kedaluwarsa diproyeksikan free, pemegang lama masih boleh sent jika belum diambil", () => {
    const events = [ev("claim", "A", "c1", 0)];
    const s = reduceEvents(events, T0 + 90 * MIN, cfg);
    expect(s.get("c1")).toMatchObject({ state: "free", expired: true, lapsedHolder: "A" });
    expect(canResolve(s.get("c1"), "A")).toBe(true);
    expect(canResolve(s.get("c1"), "B")).toBe(false);
    const s2 = reduceEvents([...events, ev("sent", "A", "c1", 91)], T0 + 92 * MIN, cfg);
    expect(s2.get("c1")?.state).toBe("sent");
  });

  it("sent/skip hanya sah dari pemegang", () => {
    const s = reduceEvents(
      [ev("claim", "A", "c1", 0), ev("sent", "B", "c1", 1), ev("claim", "A", "c2", 0), ev("skip", "A", "c2", 1)],
      T0 + 2 * MIN,
      cfg,
    );
    expect(s.get("c1")?.state).toBe("claimed");
    expect(s.get("c2")).toMatchObject({ state: "skipped", resolvedBy: "A" });
  });

  it("sent/skipped bersifat final: klaim, release, admin_release sesudahnya diabaikan", () => {
    const s = reduceEvents(
      [
        ev("claim", "A", "c1", 0),
        ev("sent", "A", "c1", 1),
        ev("claim", "B", "c1", 2),
        ev("release", "A", "c1", 3),
        ev("admin_release", "Z", "c1", 4),
      ],
      T0 + 5 * MIN,
      cfg,
    );
    expect(s.get("c1")).toMatchObject({ state: "sent", resolvedBy: "A" });
  });

  it("release oleh pemegang mengembalikan ke free; oleh non-pemegang diabaikan", () => {
    const s = reduceEvents(
      [ev("claim", "A", "c1", 0), ev("release", "B", "c1", 1), ev("claim", "A", "c2", 0), ev("release", "A", "c2", 1)],
      T0 + 2 * MIN,
      cfg,
    );
    expect(s.get("c1")?.state).toBe("claimed");
    expect(s.get("c2")).toMatchObject({ state: "free", holder: null });
  });

  it("admin_release mengembalikan kontak ke free dan bisa diklaim lagi", () => {
    const s = reduceEvents(
      [ev("claim", "A", "c1", 0), ev("admin_release", "Admin", "c1", 1), ev("claim", "B", "c1", 2)],
      T0 + 3 * MIN,
      cfg,
    );
    expect(s.get("c1")).toMatchObject({ state: "claimed", holder: "B" });
    const s2 = reduceEvents([ev("claim", "A", "c1", 0), ev("admin_release", "Admin", "c1", 1)], T0 + 3 * MIN, cfg);
    expect(s2.get("c1")?.state).toBe("free");
  });

  it("event expire hanya berlaku jika klaim memang kedaluwarsa", () => {
    const early = reduceEvents([ev("claim", "A", "c1", 0), ev("expire", "B", "c1", 10)], T0 + 11 * MIN, cfg);
    expect(early.get("c1")?.state).toBe("claimed");
    const late = reduceEvents([ev("claim", "A", "c1", 0), ev("expire", "B", "c1", 70)], T0 + 71 * MIN, cfg);
    expect(late.get("c1")?.state).toBe("free");
  });

  it("lastActivityAt memuat aktivitas terakhir pemegang", () => {
    const s = reduceEvents([ev("claim", "A", "c1", 0), ev("claim", "A", "c2", 7)], T0 + 8 * MIN, cfg);
    expect(s.get("c1")?.lastActivityAt).toBe(T0 + 7 * MIN);
  });
});
