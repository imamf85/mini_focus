export interface CellUpdate {
  range: string;
  values: string[][];
}

/** Abstraksi tipis atas Sheets API supaya bisa diganti mock in-memory saat test. */
export interface SheetsClient {
  getTitles(): Promise<string[]>;
  addSheet(title: string): Promise<void>;
  /** Satu panggilan baca untuk banyak range. Baris akhir yang kosong boleh terpotong. */
  batchGet(ranges: string[]): Promise<string[][][]>;
  /** Satu panggilan tulis; semua baris ditambahkan berurutan dan atomik. */
  append(range: string, rows: string[][]): Promise<void>;
  /** Satu panggilan tulis untuk banyak range (valueInputOption RAW). */
  batchUpdate(data: CellUpdate[]): Promise<void>;
}

export const quoteSheet = (title: string) => `'${title.replace(/'/g, "''")}'`;
