import { describe, expect, it } from "vitest";
import { makeWorld, T0 } from "./fixtures";

/**
 * Simulasi 10 agen selama 10 menit virtual. Setiap agen punya instance Dispatch sendiri
 * (tanpa cache bersama = skenario terburuk di serverless). Agen refresh saat kembali dari
 * WhatsApp (1x per kontak) dan saat aksi; admin membuka dashboard tiap 15 detik.
 */
// PRNG ber-seed agar simulasi deterministik (bukan flaky).
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe("kuota Sheets API (simulasi 10 agen)", () => {
  it("baca dan tulis per menit tetap < 60 pada jendela geser mana pun, tanpa kontak ganda", async () => {
    const rnd = lcg(2);
    const names = Array.from({ length: 10 }, (_, i) => `Agen${i}`);
    const w = makeWorld(400, [...names.map((name) => ({ name, dailyLimit: 200 })), { name: "Admin", isAdmin: true }]);
    // agen mulai bergantian (login tidak serentak): satu agen tiap ~6 detik
    const agents = names.map((name, i) => ({ name, d: w.dispatch(), next: T0 + i * 6_000 }));
    const admin = w.dispatch();
    let nextAdmin = T0;

    const END = T0 + 10 * 60_000;
    for (let t = T0; t < END; t += 1000) {
      w.clock.t = t;
      for (const a of agents) {
        if (t < a.next) continue;
        let view = await a.d.getView(a.name); // kembali aktif -> refresh
        if (view.held === 0) {
          view = await a.d.claimBatch(a.name);
          a.next = t + 5_000;
        } else if (view.current && !view.current.locked) {
          await a.d.resolve(a.name, view.current.id, "sent");
          a.next = t + 1000 * (25 + Math.floor(rnd() * 40)); // waktu kirim manual + jeda
        } else if (view.current?.locked) {
          a.next = t + 1000 * view.current.retryAfter;
        } else {
          a.next = t + 30_000;
        }
        await a.d.sync(); // lazy di akhir request (dibatasi 30 dtk per instance)
      }
      if (t >= nextAdmin) {
        await admin.adminSummary("Admin");
        await admin.sync();
        nextAdmin = t + 15_000;
      }
    }

    // jendela geser 60 detik
    const log = w.sheets.log;
    let maxR = 0;
    let maxW = 0;
    for (let i = 0; i < log.length; i++) {
      let r = 0;
      let wr = 0;
      for (let j = i; j < log.length && log[j].at < log[i].at + 60_000; j++) {
        if (log[j].kind === "read") r++;
        else wr++;
      }
      maxR = Math.max(maxR, r);
      maxW = Math.max(maxW, wr);
    }
    console.log(`maks baca/menit=${maxR}, maks tulis/menit=${maxW}`);
    expect(maxR).toBeLessThan(60);
    expect(maxW).toBeLessThan(60);

    // tidak ada kontak yang dikirim dua agen: tiap contact_id punya paling banyak satu event sent sah
    const events = w.sheets.sheets.get("events")!.slice(1);
    const sentBy = new Map<string, Set<string>>();
    for (const e of events) if (e[2] === "sent") (sentBy.get(e[1]) ?? sentBy.set(e[1], new Set()).get(e[1])!).add(e[3]);
    const { replayEvents } = await import("@/lib/state");
    const snap = await admin.store.snapshot({ fresh: true });
    const { states } = replayEvents(snap.events, END, { claimTimeoutMs: 3_600_000 });
    const validSent = [...states.values()].filter((s) => s.state === "sent");
    expect(validSent.length).toBeGreaterThan(50);
    const claimsByContact = new Map<string, string[]>();
    for (const st of validSent) claimsByContact.set(st.contactId, [st.resolvedBy!]);
    for (const owners of claimsByContact.values()) expect(owners).toHaveLength(1);
  }, 120_000);
});
