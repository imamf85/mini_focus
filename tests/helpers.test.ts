import { describe, expect, it } from "vitest";
import { normalizePhone, maskPhone } from "@/lib/phone";
import { buildMessage } from "@/lib/message";
import { formatWIB, greetingFor, parseWIB, wibDateKey } from "@/lib/time";
import { paceDelaySec, pacingWaitMs } from "@/lib/pacing";
import { loadAppConfig, normalizePrivateKey } from "@/lib/config";

describe("normalizePhone", () => {
  it.each([
    ["081234567890", "6281234567890"],
    ["81234567890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["+62 812-3456-7890", "6281234567890"],
    ["0812 3456 7890", "6281234567890"],
    ["(0812) 3456-7890", "6281234567890"],
    ["", ""],
  ])("%s -> %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it("maskPhone tidak membocorkan nomor penuh", () => {
    expect(maskPhone("081234567890")).toBe("6281*******90");
  });
});

describe("waktu WIB", () => {
  it("format dan parse bolak-balik", () => {
    const ms = Date.UTC(2026, 10, 5, 17, 30, 5); // 00:30:05 WIB 6 Nov
    expect(formatWIB(ms)).toBe("06/11/2026 00:30:05");
    expect(parseWIB("06/11/2026 00:30:05")).toBe(ms);
    expect(parseWIB("bukan tanggal")).toBeNull();
    expect(wibDateKey(ms)).toBe("2026-11-06");
  });

  it.each([
    [2, "Selamat Malam"],
    [3, "Selamat Pagi"],
    [10, "Selamat Pagi"],
    [11, "Selamat Siang"],
    [14, "Selamat Siang"],
    [15, "Selamat Sore"],
    [17, "Selamat Sore"],
    [18, "Selamat Malam"],
    [23, "Selamat Malam"],
  ])("jam WIB %i -> %s", (hour, expected) => {
    const ms = Date.UTC(2026, 10, 5, hour - 7 + 24, 0, 0); // hour WIB
    expect(greetingFor(ms)).toBe(expected);
  });
});

describe("buildMessage", () => {
  it("mengisi sapaan dan nama, tanpa placeholder tersisa", () => {
    const m = buildMessage("Selamat Pagi", "Budi $& Santoso");
    expect(m.startsWith("Selamat Pagi Dokter Budi $& Santoso\n📣📣")).toBe(true);
    expect(m).not.toContain("{{");
    expect(m.length).toBeGreaterThan(2500);
  });
});

describe("pacing", () => {
  it("jeda ada dalam rentang dan deterministik", () => {
    for (let i = 0; i < 200; i++) {
      const d = paceDelaySec("Ani", 1_000_000 + i * 1000, 20, 60);
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThanOrEqual(60);
      expect(d).toBe(paceDelaySec("Ani", 1_000_000 + i * 1000, 20, 60));
    }
  });
  it("pacingWaitMs", () => {
    expect(pacingWaitMs("Ani", null, 1000, 20, 60)).toBe(0);
    const w = pacingWaitMs("Ani", 0, 1000, 20, 60);
    expect(w).toBeGreaterThan(18_000);
    expect(pacingWaitMs("Ani", 0, 61_000, 20, 60)).toBe(0);
  });
});

describe("config", () => {
  it("default dan validasi", () => {
    const c = loadAppConfig({});
    expect(c).toMatchObject({ contactsSheet: "delivery_kitchen", batchSize: 10, pacingMinSec: 20, pacingMaxSec: 60 });
    expect(c.claimTimeoutMs).toBe(3_600_000);
    expect(() => loadAppConfig({ PACING_SECONDS_MIN: "50", PACING_SECONDS_MAX: "10" })).toThrow();
  });
  it("private key dengan \\n literal dan kutip", () => {
    expect(normalizePrivateKey('"-----BEGIN-----\\nabc\\n-----END-----\\n"')).toBe(
      "-----BEGIN-----\nabc\n-----END-----\n",
    );
  });
});
