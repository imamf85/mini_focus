import { z } from "zod";
import type { AppConfig } from "./types";

const num = (def: number) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? def : Number(v)),
    z.number().int().positive(),
  );

const schema = z.object({
  CONTACTS_SHEET: z.string().trim().min(1).default("delivery_kitchen"),
  BATCH_SIZE: num(10),
  CLAIM_TIMEOUT_MIN: num(60),
  PACING_SECONDS_MIN: num(20),
  PACING_SECONDS_MAX: num(60),
});

export function loadAppConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const e = schema.parse({
    CONTACTS_SHEET: env.CONTACTS_SHEET || undefined,
    BATCH_SIZE: env.BATCH_SIZE,
    CLAIM_TIMEOUT_MIN: env.CLAIM_TIMEOUT_MIN,
    PACING_SECONDS_MIN: env.PACING_SECONDS_MIN,
    PACING_SECONDS_MAX: env.PACING_SECONDS_MAX,
  });
  if (e.PACING_SECONDS_MAX < e.PACING_SECONDS_MIN) {
    throw new Error("PACING_SECONDS_MAX harus >= PACING_SECONDS_MIN");
  }
  return {
    contactsSheet: e.CONTACTS_SHEET,
    batchSize: e.BATCH_SIZE,
    claimTimeoutMs: e.CLAIM_TIMEOUT_MIN * 60_000,
    pacingMinSec: e.PACING_SECONDS_MIN,
    pacingMaxSec: e.PACING_SECONDS_MAX,
    syncMinIntervalMs: 30_000,
    cacheTtlMs: 7_000,
  };
}

export interface GoogleEnv {
  email: string;
  privateKey: string;
  spreadsheetId: string;
}

/** Menangani private key dengan \n literal dan tanda kutip pembungkus. */
export function normalizePrivateKey(raw: string): string {
  let k = raw.trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return k.replace(/\\n/g, "\n");
}

export function loadGoogleEnv(env: Record<string, string | undefined> = process.env): GoogleEnv {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = env.SPREADSHEET_ID;
  if (!email || !key || !spreadsheetId) {
    throw new Error(
      "Env GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, dan SPREADSHEET_ID wajib diisi",
    );
  }
  return { email, privateKey: normalizePrivateKey(key), spreadsheetId };
}

export function loadSessionSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET wajib diisi (minimal 32 karakter)");
  return s;
}
