import type { AgentRow, AppConfig, Contact, EventAction, SheetEvent } from "./types";
import { formatWIB, parseWIB } from "./time";
import { parseTable } from "./sheets/table";
import { quoteSheet, type CellUpdate, type SheetsClient } from "./sheets/types";

export const EVENTS_SHEET = "events";
export const AGENTS_SHEET = "agents";
export const EVENTS_HEADER = ["ts", "contact_id", "action", "agent", "batch_id", "note"];
export const AGENTS_HEADER = ["name", "pin_hash", "is_admin", "daily_limit", "active"];
export const CONTACT_COLUMNS = [
  "name",
  "phone_number",
  "status",
  "session",
  "sent_at",
  "id",
  "operator",
  "claimed_at",
];

const ACTIONS: EventAction[] = ["claim", "sent", "skip", "release", "expire", "admin_release"];

export interface Snapshot {
  contacts: Contact[];
  contactCols: Record<string, number>;
  events: SheetEvent[];
  agents: AgentRow[];
  fetchedAt: number;
}

const truthy = (v: string) => ["true", "1", "ya", "yes", "y"].includes(v.trim().toLowerCase());

export class Store {
  private cache: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;
  private generation = 0;

  constructor(
    readonly client: SheetsClient,
    readonly config: AppConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Membaca contacts + events + agents dalam SATU batchGet. `fresh` melewati cache; `maxAgeMs` memperketat TTL. */
  async snapshot(opts: { fresh?: boolean; maxAgeMs?: number } = {}): Promise<Snapshot> {
    if (!opts.fresh) {
      const ttl = opts.maxAgeMs ?? this.config.cacheTtlMs;
      if (this.cache && this.now() - this.cache.fetchedAt < ttl) return this.cache;
      if (this.inflight) return this.inflight;
    }
    const gen = this.generation;
    const p = this.load().then((snap) => {
      if (gen === this.generation) this.cache = snap;
      return snap;
    });
    if (!opts.fresh) {
      this.inflight = p;
      p.then(
        () => (this.inflight = null),
        () => (this.inflight = null),
      );
    }
    return p;
  }

  invalidate() {
    this.generation++;
    this.cache = null;
    this.inflight = null;
  }

  private async load(): Promise<Snapshot> {
    const sheet = quoteSheet(this.config.contactsSheet);
    const [contactsRaw, eventsRaw, agentsRaw] = await this.client.batchGet([
      `${sheet}!A:Z`,
      `${EVENTS_SHEET}!A:F`,
      `${AGENTS_SHEET}!A:E`,
    ]);
    const ct = parseTable(contactsRaw ?? []);
    for (const need of ["id", "name", "phone_number", "status"]) {
      if (!(need in ct.col)) {
        throw new Error(`Kolom "${need}" tidak ada di sheet ${this.config.contactsSheet}. Jalankan npm run init-sheet.`);
      }
    }
    const contacts: Contact[] = [];
    for (const r of ct.rows) {
      const id = r.get("id");
      if (!id) continue;
      contacts.push({
        id,
        rowNumber: r.rowNumber,
        name: r.get("name"),
        phone: r.get("phone_number"),
        status: r.get("status"),
        session: r.get("session"),
        sentAt: r.get("sent_at"),
        operator: r.get("operator"),
        claimedAt: r.get("claimed_at"),
      });
    }

    const events: SheetEvent[] = [];
    for (const r of parseTable(eventsRaw ?? []).rows) {
      const ts = parseWIB(r.get("ts"));
      const action = r.get("action") as EventAction;
      if (ts === null || !ACTIONS.includes(action) || !r.get("contact_id")) continue;
      events.push({
        ts,
        contactId: r.get("contact_id"),
        action,
        agent: r.get("agent"),
        batchId: r.get("batch_id"),
        note: r.get("note"),
      });
    }

    const agents: AgentRow[] = [];
    for (const r of parseTable(agentsRaw ?? []).rows) {
      const name = r.get("name");
      if (!name) continue;
      const limit = Number(r.get("daily_limit"));
      agents.push({
        name,
        pinHash: r.get("pin_hash"),
        isAdmin: truthy(r.get("is_admin")),
        dailyLimit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50,
        active: truthy(r.get("active")),
      });
    }
    return { contacts, contactCols: ct.col, events, agents, fetchedAt: this.now() };
  }

  /** Satu panggilan append untuk semua event. */
  async appendEvents(events: SheetEvent[]): Promise<void> {
    if (events.length === 0) return;
    this.invalidate();
    await this.client.append(
      `${EVENTS_SHEET}!A:F`,
      events.map((e) => [formatWIB(e.ts), e.contactId, e.action, e.agent, e.batchId, e.note]),
    );
  }

  async writeCells(updates: CellUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    this.invalidate();
    await this.client.batchUpdate(updates);
  }
}
