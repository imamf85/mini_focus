export interface TableRow {
  rowNumber: number; // nomor baris di sheet (1-based, header = 1)
  get(name: string): string;
}

export interface Table {
  header: string[];
  col: Record<string, number>;
  rows: TableRow[];
}

/** Baca tabel berdasarkan NAMA header, bukan indeks kolom. */
export function parseTable(values: string[][]): Table {
  const header = (values[0] ?? []).map((h) => (h ?? "").trim());
  const col: Record<string, number> = {};
  header.forEach((h, i) => {
    if (h && !(h in col)) col[h] = i;
  });
  const rows: TableRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i] ?? [];
    rows.push({
      rowNumber: i + 1,
      get: (name) => (name in col ? (raw[col[name]] ?? "").trim() : ""),
    });
  }
  return { header, col, rows };
}
