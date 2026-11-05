import bcrypt from "bcryptjs";
import { MemorySheets } from "@/lib/sheets/memory";
import { Store } from "@/lib/store";
import { Dispatch } from "@/lib/service";
import type { AppConfig } from "@/lib/types";

export const T0 = Date.UTC(2026, 10, 5, 3, 0, 0); // 10:00 WIB
export const MIN = 60_000;

export const testConfig: AppConfig = {
  contactsSheet: "delivery_kitchen",
  batchSize: 10,
  claimTimeoutMs: 60 * MIN,
  pacingMinSec: 20,
  pacingMaxSec: 60,
  syncMinIntervalMs: 30_000,
  cacheTtlMs: 10_000,
};

export const CONTACT_HEADER = ["name", "phone_number", "status", "session", "sent_at", "id", "operator", "claimed_at"];
export const COL = { name: 0, phone: 1, status: 2, session: 3, sentAt: 4, id: 5, operator: 6, claimedAt: 7 };
export const PIN_HASH = bcrypt.hashSync("1234", 4);

export interface AgentSpec {
  name: string;
  isAdmin?: boolean;
  dailyLimit?: number;
  active?: boolean;
}

export interface World {
  sheets: MemorySheets;
  clock: { t: number };
  /** Instance Dispatch baru per agen = instance serverless terpisah (cache terpisah). */
  dispatch(config?: Partial<AppConfig>): Dispatch;
  status(i: number): string;
}

/** contact i (0-based) ada di baris sheet i+2 dengan id "c{i}". */
export function makeWorld(
  contacts: { status?: string; operator?: string }[] | number,
  agents: AgentSpec[] = [{ name: "Ani" }, { name: "Budi" }, { name: "Citra" }, { name: "Admin", isAdmin: true }],
): World {
  const list: { status?: string; operator?: string }[] =
    typeof contacts === "number" ? Array.from({ length: contacts }, () => ({})) : contacts;
  const clock = { t: T0 };
  const sheets = new MemorySheets({
    delivery_kitchen: [
      CONTACT_HEADER,
      ...list.map((c, i) => [
        `Dr ${i}`,
        `08123${String(i).padStart(6, "0")}`,
        c.status ?? "",
        "",
        "",
        `c${i}`,
        c.operator ?? "",
        "",
      ]),
    ],
    events: [["ts", "contact_id", "action", "agent", "batch_id", "note"]],
    agents: [
      ["name", "pin_hash", "is_admin", "daily_limit", "active"],
      ...agents.map((a) => [
        a.name,
        PIN_HASH,
        a.isAdmin ? "TRUE" : "FALSE",
        String(a.dailyLimit ?? 50),
        a.active === false ? "FALSE" : "TRUE",
      ]),
    ],
  });
  sheets.clock = () => clock.t;
  return {
    sheets,
    clock,
    dispatch: (config = {}) => {
      const cfg = { ...testConfig, ...config };
      return new Dispatch(new Store(sheets, cfg, () => clock.t), cfg, () => clock.t);
    },
    status: (i) => sheets.cell("delivery_kitchen", i + 2, COL.status),
  };
}

export async function viewIds(d: Dispatch, name: string): Promise<string[]> {
  const snap = await d.store.snapshot({ fresh: true });
  const { replayEvents } = await import("@/lib/state");
  const { states } = replayEvents(snap.events, d["now"](), { claimTimeoutMs: d.config.claimTimeoutMs });
  return [...states.values()].filter((s) => s.state === "claimed" && s.holder === name).map((s) => s.contactId);
}
