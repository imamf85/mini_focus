import { existsSync } from "node:fs";

/** Muat .env.local / .env untuk script CLI (Node 22+). */
export function loadEnvFiles() {
  for (const f of [".env.local", ".env"]) {
    if (existsSync(f)) process.loadEnvFile(f);
  }
}
