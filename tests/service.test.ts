import { describe, expect, it } from "vitest";
import { DispatchError } from "@/lib/service";
import { COL, MIN, makeWorld, viewIds } from "./fixtures";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DispatchError) return e;
    throw e;
  }
  return null;
};

describe("ambil jatah", () => {
  it("mengambil dari BAWAH daftar, tepat BATCH_SIZE, dengan satu append", async () => {
    const w = makeWorld(30);
    const d = w.dispatch();
    const view = await d.claimBatch("Ani");
    expect(view.claimedNow).toBe(10);
    expect(view.held).toBe(10);
    expect((await viewIds(d, "Ani")).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `c${29 - i}`).sort(),
    );
    expect(w.sheets.log.filter((l) => l.op === "append")).toHaveLength(1);
  });

  it("tiga agen mengambil jatah bersamaan: tidak pernah ada kontak yang sama", async () => {
    const w = makeWorld(60);
    const ds = ["Ani", "Budi", "Citra"].map(() => w.dispatch());
    await Promise.all(ds.map((d, i) => d.claimBatch(["Ani", "Budi", "Citra"][i])));
    const sets = await Promise.all(ds.map((d, i) => viewIds(d, ["Ani", "Budi", "Citra"][i])));
    const all = sets.flat();
    expect(new Set(all).size).toBe(all.length); // tidak ada duplikat
    expect(all.length).toBeGreaterThan(0);
    for (const s of sets) expect(s.length).toBeLessThanOrEqual(10);
  });

  it("agen yang kalah balapan mengisi kekurangan lewat percobaan ulang (maks 2x)", async () => {
    const w = makeWorld(40);
    const ds = ["Ani", "Budi", "Citra"].map(() => w.dispatch());
    await Promise.all(ds.map((d, i) => d.claimBatch(["Ani", "Budi", "Citra"][i])));
    const sets = await Promise.all(ds.map((d, i) => viewIds(d, ["Ani", "Budi", "Citra"][i])));
    expect(sets.flat().length).toBe(30); // 40 kontak cukup untuk 3x10, tidak ada yang tersisa kurang
  });

  it("kontak bot (sent, image_ok, error) tidak pernah diklaim", async () => {
    const w = makeWorld([
      { status: "sent" },
      { status: "image_ok" },
      { status: "error: timeout" },
      {},
      { status: "manual_sent" },
      { status: "not_wa" },
    ]);
    const view = await w.dispatch().claimBatch("Ani");
    expect(view.held).toBe(1);
    expect(await viewIds(w.dispatch(), "Ani")).toEqual(["c3"]);
  });

  it("menolak jika masih memegang jatah", async () => {
    const w = makeWorld(30);
    const d = w.dispatch();
    await d.claimBatch("Ani");
    expect((await code(d.claimBatch("Ani")))?.code).toBe("HAS_ACTIVE");
  });
});

describe("sent / skip, pacing, batas harian", () => {
  it("pacing ditegakkan di server: 429 + retryAfter, link terkunci, lalu terbuka", async () => {
    const w = makeWorld(20);
    const d = w.dispatch();
    let view = await d.claimBatch("Ani");
    expect(view.current?.locked).toBe(false);
    const first = view.current!.id;
    view = await d.resolve("Ani", first, "sent");
    expect(view.current?.locked).toBe(true);
    const wait = (view.current as { retryAfter: number }).retryAfter;
    expect(wait).toBeGreaterThanOrEqual(19);
    expect(wait).toBeLessThanOrEqual(60);
    expect(view.current).not.toHaveProperty("waUrl");

    const err = await code(d.resolve("Ani", view.current!.id, "sent"));
    expect(err).toMatchObject({ code: "PACING", status: 429 });
    expect(err!.extra.retryAfter).toBeGreaterThan(0);

    w.clock.t += 61_000;
    view = await d.getView("Ani");
    expect(view.current?.locked).toBe(false);
    expect((view.current as { waUrl: string }).waUrl).toMatch(/^https:\/\/wa\.me\/62\d+\?text=/);
    await d.resolve("Ani", view.current!.id, "sent");
  });

  it("batas harian (daily_limit) menolak pengiriman dan klaim baru", async () => {
    const w = makeWorld(20, [{ name: "Ani", dailyLimit: 2 }]);
    const d = w.dispatch();
    let view = await d.claimBatch("Ani");
    expect(view.held).toBe(2); // jatah dipotong sisa limit
    for (let i = 0; i < 2; i++) {
      w.clock.t += 61_000;
      view = await d.getView("Ani");
      view = await d.resolve("Ani", view.current!.id, "sent");
    }
    expect(view.sentToday).toBe(2);
    expect(view.limitReached).toBe(true);
    expect((await code(d.claimBatch("Ani")))?.code).toBe("DAILY_LIMIT");
  });

  it("batas harian menolak sent bila limit tercapai di tengah jatah", async () => {
    const w = makeWorld(20, [{ name: "Ani", dailyLimit: 3 }]);
    const d = w.dispatch();
    await d.claimBatch("Ani");
    // limit dikecilkan di sheet setelah jatah diambil
    w.sheets.sheets.get("agents")![1][3] = "1";
    d.store.invalidate();
    let view = await d.getView("Ani");
    view = await d.resolve("Ani", view.current!.id, "sent");
    w.clock.t += 61_000;
    d.store.invalidate();
    view = await d.getView("Ani");
    expect(view.limitReached).toBe(true);
    const held = await viewIds(d, "Ani");
    expect((await code(d.resolve("Ani", held[0], "sent")))?.code).toBe("DAILY_LIMIT");
  });

  it("klaim kedaluwarsa diambil agen lain; sent pemegang lama -> conflict", async () => {
    const w = makeWorld(5);
    const a = w.dispatch();
    const b = w.dispatch();
    await a.claimBatch("Ani");
    const mine = await viewIds(a, "Ani");
    expect(mine).toHaveLength(5);
    w.clock.t += 61 * MIN;
    await b.claimBatch("Budi");
    expect(await viewIds(b, "Budi")).toHaveLength(5);
    const err = await code(a.resolve("Ani", mine[0], "sent"));
    expect(err).toMatchObject({ code: "CONFLICT", status: 409 });
    expect(err!.message).toBe("Kontak ini sudah diambil agen lain, cek dulu sebelum mengirim");
    // budi sebagai pemegang baru boleh
    const view = await b.getView("Budi");
    await b.resolve("Budi", view.current!.id, "sent");
  });

  it("dua agen: sent dari non-pemegang ditolak", async () => {
    const w = makeWorld(5);
    const a = w.dispatch();
    const b = w.dispatch();
    await a.claimBatch("Ani");
    const ids = await viewIds(a, "Ani");
    expect((await code(b.resolve("Budi", ids[0], "sent")))?.code).toBe("CONFLICT");
  });

  it("tap ganda sent bersifat idempoten", async () => {
    const w = makeWorld(5);
    const d = w.dispatch();
    const view = await d.claimBatch("Ani");
    const id = view.current!.id;
    await d.resolve("Ani", id, "sent");
    const again = await d.resolve("Ani", id, "sent");
    expect(again.sentToday).toBe(1);
  });
});

describe("release", () => {
  it("lepas sisa jatah mengembalikan kontak ke free dan sheet kembali kosong setelah sync", async () => {
    const w = makeWorld(12);
    const d = w.dispatch();
    await d.claimBatch("Ani");
    await d.sync({ force: true });
    expect(w.status(11)).toBe("manual_claimed");
    const view = await d.releaseMine("Ani");
    expect(view.held).toBe(0);
    await d.sync({ force: true });
    for (let i = 0; i < 12; i++) expect(w.status(i)).toBe("");
    expect(w.sheets.cell("delivery_kitchen", 13, COL.operator)).toBe("");
    // bisa diklaim lagi oleh agen lain
    const v2 = await w.dispatch().claimBatch("Budi");
    expect(v2.held).toBe(10);
  });

  it("admin_release memaksa lepas klaim agen tertentu; non-admin ditolak", async () => {
    const w = makeWorld(12);
    const a = w.dispatch();
    await a.claimBatch("Ani");
    expect((await code(w.dispatch().adminRelease("Budi", "Ani")))?.code).toBe("FORBIDDEN");
    const res = await w.dispatch().adminRelease("Admin", "Ani");
    expect(res.released).toBe(10);
    expect(await viewIds(a, "Ani")).toHaveLength(0);
    expect((await w.dispatch().claimBatch("Citra")).held).toBe(10);
  });
});

describe("sinkronisasi ke sheet kontak", () => {
  it("menulis status, operator, claimed_at, sent_at dalam satu batchUpdate; idempoten", async () => {
    const w = makeWorld(5);
    const d = w.dispatch();
    let view = await d.claimBatch("Ani");
    view = await d.resolve("Ani", view.current!.id, "sent"); // c4
    const before = w.sheets.log.filter((l) => l.op === "batchUpdate").length;
    const r = await d.sync({ force: true });
    expect(r.updated).toBeGreaterThan(0);
    expect(w.sheets.log.filter((l) => l.op === "batchUpdate").length).toBe(before + 1);
    expect(w.status(4)).toBe("manual_sent");
    expect(w.sheets.cell("delivery_kitchen", 6, COL.operator)).toBe("Ani");
    expect(w.sheets.cell("delivery_kitchen", 6, COL.sentAt)).toBe("05/11/2026 10:00:00");
    expect(w.status(3)).toBe("manual_claimed");
    expect(w.sheets.cell("delivery_kitchen", 5, COL.claimedAt)).toBe("05/11/2026 10:00:00");
    const writesBefore = w.sheets.calls.writes;
    const again = await d.sync({ force: true });
    expect(again.updated).toBe(0);
    expect(w.sheets.calls.writes).toBe(writesBefore); // idempoten: tidak ada tulis
  });

  it("skip ditulis sebagai not_wa", async () => {
    const w = makeWorld(3);
    const d = w.dispatch();
    const view = await d.claimBatch("Ani");
    await d.resolve("Ani", view.current!.id, "skip");
    await d.sync({ force: true });
    expect(w.status(2)).toBe("not_wa");
  });

  it("jeda minimal 30 detik antar sinkronisasi", async () => {
    const w = makeWorld(3);
    const d = w.dispatch();
    await d.claimBatch("Ani");
    expect((await d.sync()).skipped).toBe(false);
    w.clock.t += 10_000;
    expect((await d.sync()).skipped).toBe(true);
    w.clock.t += 21_000;
    expect((await d.sync()).skipped).toBe(false);
  });

  it("tidak pernah menimpa sent / image_ok / error, bahkan jika bot mengambilnya setelah klaim", async () => {
    const w = makeWorld(6);
    const d = w.dispatch();
    await d.claimBatch("Ani"); // klaim c0..c5
    // bot WAHA mengirim 3 kontak setelah klaim terjadi, sebelum sync
    const rows = w.sheets.sheets.get("delivery_kitchen")!;
    rows[1][COL.status] = "sent"; // c0
    rows[2][COL.status] = "image_ok"; // c1
    rows[3][COL.status] = "error: gagal"; // c2
    w.clock.t += 4_000; // snapshot <=3 dtk dipakai ulang oleh sync; bot menulis setelah itu
    const r = await d.sync({ force: true });
    expect(r.released).toBe(3);
    expect(w.status(0)).toBe("sent");
    expect(w.status(1)).toBe("image_ok");
    expect(w.status(2)).toBe("error: gagal");
    expect(w.status(3)).toBe("manual_claimed");
    // klaim dibatalkan dengan catatan
    const events = w.sheets.sheets.get("events")!;
    const releases = events.filter((e) => e[2] === "release" && e[5] === "bentrok dengan bot");
    expect(releases).toHaveLength(3);
    // agen tidak lagi melihat kontak itu
    expect((await w.dispatch().getView("Ani")).held).toBe(3);
  });

  it("tidak menimpa sent/image_ok/error walau state event bilang sent (sel milik bot)", async () => {
    const w = makeWorld([{ status: "sent" }, { status: "image_ok" }, { status: "error: x" }, {}]);
    const d = w.dispatch();
    // sisipkan event palsu seolah-olah kontak itu pernah diklaim dan dikirim manual
    const events = w.sheets.sheets.get("events")!;
    for (const id of ["c0", "c1", "c2"]) {
      events.push(["05/11/2026 10:00:00", id, "claim", "Ani", "b0", ""]);
      events.push(["05/11/2026 10:00:01", id, "sent", "Ani", "b0", ""]);
    }
    await d.sync({ force: true });
    expect(w.status(0)).toBe("sent");
    expect(w.status(1)).toBe("image_ok");
    expect(w.status(2)).toBe("error: x");
  });

  it("not_wa milik bot (tanpa operator) tidak ditimpa", async () => {
    const w = makeWorld([{ status: "not_wa" }]);
    const events = w.sheets.sheets.get("events")!;
    events.push(["05/11/2026 10:00:00", "c0", "claim", "Ani", "b0", ""]);
    const r = await w.dispatch().sync({ force: true });
    expect(w.status(0)).toBe("not_wa");
    expect(r.released).toBe(1);
  });
});

describe("ringkasan admin", () => {
  it("menghitung kategori dan persen selesai", async () => {
    const w = makeWorld([{ status: "sent" }, { status: "image_ok" }, { status: "error: x" }, { status: "not_wa" }, {}, {}, {}]);
    const d = w.dispatch();
    await d.claimBatch("Ani"); // klaim 3 sisa
    let view = await d.getView("Ani");
    await d.resolve("Ani", view.current!.id, "sent");
    const s = await w.dispatch().adminSummary("Admin");
    expect(s.totals).toMatchObject({
      total: 7, botSent: 1, botPartial: 1, error: 1, notWa: 1, manualSent: 1, held: 2, unprocessed: 0,
    });
    expect(s.totals.percentDone).toBeCloseTo(((1 + 1 + 1) / 7) * 100, 0);
    expect(s.agents.find((a) => a.name === "Ani")).toMatchObject({ sentToday: 1, sentTotal: 1, held: 2 });
    expect(s.feed[0].action).toBe("sent");
    expect((await code(w.dispatch().adminSummary("Ani")))?.code).toBe("FORBIDDEN");
  });
});

describe("ringkasan monitor", () => {
  it("hanya agregat: terkirim, tidak terdaftar, belum dikirim, dan nomor tidak valid", async () => {
    const w = makeWorld([{ status: "sent" }, { status: "image_ok" }, { status: "not_wa" }, {}, {}]);
    w.sheets.sheets.get("delivery_kitchen")![5][COL.phone] = "abc"; // contact c3: nomor tidak valid
    const d = w.dispatch();
    await d.claimBatch("Ani"); // hanya c4 yang bisa diklaim
    const view = await d.getView("Ani");
    await d.resolve("Ani", view.current!.id, "sent");
    const s = await w.dispatch().monitorSummary();
    expect(s.totals).toMatchObject({
      total: 5, sent: 2, botSent: 1, manualSent: 1, notWa: 1, error: 1, held: 0, unprocessed: 1, invalidPhone: 1,
    });
    expect(s.daily).toHaveLength(7);
    expect(s.daily[6].manualSent).toBe(1);
    expect(s.lastActivityAt).not.toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/08123/); // tidak ada nomor telepon
  });
});

describe("login", () => {
  it("memverifikasi PIN dan agen aktif", async () => {
    const w = makeWorld(1, [{ name: "Ani" }, { name: "Off", active: false }]);
    const d = w.dispatch();
    expect((await d.verifyLogin("Ani", "1234")).name).toBe("Ani");
    expect((await code(d.verifyLogin("Ani", "0000")))?.code).toBe("BAD_LOGIN");
    expect((await code(d.verifyLogin("Off", "1234")))?.code).toBe("BAD_LOGIN");
    expect(await d.activeAgentNames()).toEqual(["Ani"]);
  });
});
