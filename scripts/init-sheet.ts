import { loadEnvFiles } from "./env";
import { loadAppConfig, loadGoogleEnv } from "../src/lib/config";
import { createGoogleClient } from "../src/lib/sheets/google";
import { initSheet } from "../src/lib/init";

loadEnvFiles();
const g = loadGoogleEnv();
initSheet(
  createGoogleClient({ email: g.email, privateKey: g.privateKey, spreadsheetId: g.spreadsheetId }),
  loadAppConfig(),
).catch((e) => {
  console.error("Gagal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
