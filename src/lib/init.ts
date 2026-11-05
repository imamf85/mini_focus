import { randomBytes } from "node:crypto";
import type { AppConfig } from "./types";
import type { CellUpdate, SheetsClient } from "./sheets/types";
import { quoteSheet } from "./sheets/types";
import { columnLetter } from "./sheets/a1";
import { parseTable } from "./sheets/table";
import { AGENTS_HEADER, AGENTS_SHEET, CONTACT_COLUMNS, EVENTS_HEADER, EVENTS_SHEET } from "./store";

const genId = () => "c" + randomBytes(5).toString("hex").slice(0, 7);

/** Idempoten: aman dijalankan berulang. Tidak menghapus atau mengubah urutan kolom yang ada. */
export async function initSheet(
  client: SheetsClient,
  config: AppConfig,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const titles = await client.getTitles();
  if (!titles.includes(config.contactsSheet)) {
    throw new Error(`Sheet "${config.contactsSheet}" tidak ditemukan. Sheet ini harus sudah ada (dipakai bot).`);
  }

  // 1. kolom yang kurang di sheet kontak (ditambah di kanan, kolom lama tidak disentuh)
  const sheet = quoteSheet(config.contactsSheet);
  const [raw] = await client.batchGet([`${sheet}!A:Z`]);
  const header = [...(raw[0] ?? [])].map((h) => (h ?? "").trim());
  if (header.length === 0) throw new Error(`Sheet "${config.contactsSheet}" tidak punya baris header.`);
  const updates: CellUpdate[] = [];
  for (const name of CONTACT_COLUMNS) {
    if (header.includes(name)) continue;
    header.push(name);
    updates.push({ range: `${sheet}!${columnLetter(header.length - 1)}1`, values: [[name]] });
    log(`+ kolom ${name}`);
  }

  // 2. isi id untuk baris yang belum punya
  const table = parseTable([header, ...raw.slice(1)]);
  const used = new Set(table.rows.map((r) => r.get("id")).filter(Boolean));
  let created = 0;
  const idValues = table.rows.map((r) => {
    const existing = r.get("id");
    if (existing) return [existing];
    if (!r.get("name") && !r.get("phone_number")) return [""];
    let id = genId();
    while (used.has(id)) id = genId();
    used.add(id);
    created++;
    return [id];
  });
  if (created > 0) {
    const idCol = columnLetter(table.col.id);
    updates.push({ range: `${sheet}!${idCol}2:${idCol}${idValues.length + 1}`, values: idValues });
    log(`+ ${created} id baru`);
  }
  await client.batchUpdate(updates);

  // 3. sheet events dan agents
  for (const [title, head] of [
    [EVENTS_SHEET, EVENTS_HEADER],
    [AGENTS_SHEET, AGENTS_HEADER],
  ] as const) {
    if (!titles.includes(title)) {
      await client.addSheet(title);
      log(`+ sheet ${title}`);
    }
    const [existing] = await client.batchGet([`${title}!A1:${columnLetter(head.length - 1)}1`]);
    if ((existing[0] ?? []).join("|") !== head.join("|")) {
      await client.batchUpdate([{ range: `${title}!A1`, values: [[...head]] }]);
      log(`+ header ${title}`);
    }
  }
  log("Selesai.");
}
