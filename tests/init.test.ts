import { describe, expect, it } from "vitest";
import { initSheet } from "@/lib/init";
import { MemorySheets } from "@/lib/sheets/memory";
import { testConfig } from "./fixtures";

describe("init-sheet", () => {
  const make = () =>
    new MemorySheets({
      delivery_kitchen: [
        ["name", "phone_number", "status", "session", "sent_at"],
        ["Dr A", "0811", "sent", "s1", "01/11/2026 10:00:00"],
        ["Dr B", "0812", "", "", ""],
        ["", "", "", "", ""],
        ["Dr C", "0813", "", "", ""],
      ],
    });

  it("menambah kolom, id unik, sheet events/agents; data lama tidak berubah; idempoten", async () => {
    const s = make();
    await initSheet(s, testConfig, () => {});
    const rows = s.sheets.get("delivery_kitchen")!;
    expect(rows[0].slice(0, 5)).toEqual(["name", "phone_number", "status", "session", "sent_at"]);
    expect(rows[0].slice(5)).toEqual(["id", "operator", "claimed_at"]);
    expect(rows[1].slice(0, 5)).toEqual(["Dr A", "0811", "sent", "s1", "01/11/2026 10:00:00"]);
    const ids = [rows[1][5], rows[2][5], rows[4][5]];
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(rows[3][5] ?? "").toBe("");
    expect(s.sheets.get("events")![0]).toEqual(["ts", "contact_id", "action", "agent", "batch_id", "note"]);
    expect(s.sheets.get("agents")![0]).toEqual(["name", "pin_hash", "is_admin", "daily_limit", "active"]);

    const snapshot = JSON.stringify([...s.sheets]);
    const writes = s.calls.writes;
    await initSheet(s, testConfig, () => {});
    expect(JSON.stringify([...s.sheets])).toBe(snapshot);
    expect(s.calls.writes).toBe(writes);
  });

  it("gagal jelas bila sheet kontak tidak ada", async () => {
    await expect(initSheet(new MemorySheets(), testConfig, () => {})).rejects.toThrow(/tidak ditemukan/);
  });
});
