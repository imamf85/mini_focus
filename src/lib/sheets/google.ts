import { auth, sheets as sheetsFactory } from "@googleapis/sheets";
import type { CellUpdate, SheetsClient } from "./types";
import { withRetry } from "./retry";
import { recordCall } from "./stats";

export interface GoogleClientOptions {
  email: string;
  privateKey: string;
  spreadsheetId: string;
}

export function createGoogleClient(opts: GoogleClientOptions): SheetsClient {
  const jwt = new auth.JWT({
    email: opts.email,
    key: opts.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const api = sheetsFactory({ version: "v4", auth: jwt });
  const spreadsheetId = opts.spreadsheetId;

  return {
    async getTitles() {
      recordCall("read");
      const res = await withRetry(() =>
        api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }),
      );
      return (res.data.sheets ?? []).map((s) => s.properties?.title ?? "");
    },

    async addSheet(title) {
      recordCall("write");
      await withRetry(() =>
        api.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title } } }] },
        }),
      );
    },

    async batchGet(ranges) {
      recordCall("read");
      const res = await withRetry(() =>
        api.spreadsheets.values.batchGet({
          spreadsheetId,
          ranges,
          valueRenderOption: "FORMATTED_VALUE",
        }),
      );
      return (res.data.valueRanges ?? []).map((r) => (r.values ?? []).map((row) => row.map(String)));
    },

    async append(range, rows) {
      recordCall("write");
      await withRetry(() =>
        api.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: rows },
        }),
      );
    },

    async batchUpdate(data: CellUpdate[]) {
      if (data.length === 0) return;
      recordCall("write");
      await withRetry(() =>
        api.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "RAW", data },
        }),
      );
    },
  };
}
