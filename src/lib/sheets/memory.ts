import type { CellUpdate, SheetsClient } from "./types";
import { columnIndex } from "./a1";

const unquote = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);

/** Mock Sheets in-memory. Meniru semantik yang dipakai aplikasi: trim baris kosong, append berurutan. */
export class MemorySheets implements SheetsClient {
  sheets = new Map<string, string[][]>();
  calls = { reads: 0, writes: 0 };
  /** Jejak setiap panggilan: [waktu, jenis], dipakai simulasi kuota. */
  log: { at: number; kind: "read" | "write"; op: string }[] = [];
  clock: () => number = () => Date.now();
  /** Hook untuk menyisipkan perilaku (mis. bot menulis status) sebelum operasi berjalan. */
  beforeOp?: (op: string) => void;

  constructor(initial: Record<string, string[][]> = {}) {
    for (const [k, v] of Object.entries(initial)) this.sheets.set(k, v.map((r) => [...r]));
  }

  private tick(kind: "read" | "write", op: string) {
    if (kind === "read") this.calls.reads++;
    else this.calls.writes++;
    this.log.push({ at: this.clock(), kind, op });
    this.beforeOp?.(op);
  }

  private async yieldTurn() {
    await Promise.resolve();
    await new Promise<void>((r) => setImmediate(r));
  }

  async getTitles() {
    this.tick("read", "getTitles");
    await this.yieldTurn();
    return [...this.sheets.keys()];
  }

  async addSheet(title: string) {
    this.tick("write", "addSheet");
    await this.yieldTurn();
    if (this.sheets.has(title)) throw new Error(`Sheet ${title} sudah ada`);
    this.sheets.set(title, []);
  }

  private parseRange(range: string) {
    const bang = range.lastIndexOf("!");
    const title = unquote(range.slice(0, bang));
    const a1 = range.slice(bang + 1);
    const m = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(a1);
    if (!m) throw new Error(`Range tidak didukung: ${range}`);
    return {
      title,
      c1: columnIndex(m[1]),
      r1: m[2] ? Number(m[2]) : 1,
      c2: m[3] ? columnIndex(m[3]) : m[2] ? columnIndex(m[1]) : undefined,
      r2: m[4] ? Number(m[4]) : m[2] && !m[3] ? Number(m[2]) : undefined,
    };
  }

  async batchGet(ranges: string[]) {
    this.tick("read", "batchGet");
    await this.yieldTurn();
    return ranges.map((range) => {
      const { title, c1, r1, c2, r2 } = this.parseRange(range);
      const rows = this.sheets.get(title) ?? [];
      const last = r2 ?? rows.length;
      const out: string[][] = [];
      for (let r = r1; r <= Math.min(last, rows.length); r++) {
        const row = rows[r - 1] ?? [];
        const end = c2 ?? row.length - 1;
        const slice: string[] = [];
        for (let c = c1; c <= end; c++) slice.push(row[c] ?? "");
        while (slice.length && slice[slice.length - 1] === "") slice.pop();
        out.push(slice);
      }
      while (out.length && out[out.length - 1].length === 0) out.pop();
      return out;
    });
  }

  async append(range: string, newRows: string[][]) {
    this.tick("write", "append");
    await this.yieldTurn();
    const { title } = this.parseRange(range);
    const rows = this.sheets.get(title);
    if (!rows) throw new Error(`Sheet ${title} tidak ada`);
    for (const r of newRows) rows.push([...r]);
  }

  async batchUpdate(data: CellUpdate[]) {
    if (data.length === 0) return;
    this.tick("write", "batchUpdate");
    await this.yieldTurn();
    for (const u of data) {
      const { title, c1, r1 } = this.parseRange(u.range);
      const rows = this.sheets.get(title);
      if (!rows) throw new Error(`Sheet ${title} tidak ada`);
      u.values.forEach((vals, i) => {
        const r = r1 - 1 + i;
        while (rows.length <= r) rows.push([]);
        vals.forEach((v, j) => {
          const row = rows[r];
          while (row.length <= c1 + j) row.push("");
          row[c1 + j] = v;
        });
      });
    }
  }

  // --- helper test (tidak menghitung sebagai panggilan API) ---
  cell(title: string, rowNumber: number, col: number): string {
    return this.sheets.get(title)?.[rowNumber - 1]?.[col] ?? "";
  }
}
