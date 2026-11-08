import bcrypt from "bcryptjs";
import type { AgentRow, AppConfig, Contact, ContactState, SheetEvent } from "./types";
import { Store, type Snapshot } from "./store";
import { canResolve, replayEvents } from "./state";
import { formatWIB, greetingFor, parseWIB, wibDateKey } from "./time";
import { maskPhone, normalizePhone } from "./phone";
import { buildMessage, waLink } from "./message";
import { pacingWaitMs } from "./pacing";
import { columnLetter } from "./sheets/a1";
import { quoteSheet, type CellUpdate } from "./sheets/types";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_LOGIN"
  | "CONFLICT"
  | "PACING"
  | "DAILY_LIMIT"
  | "HAS_ACTIVE"
  | "NOT_FOUND";

export class DispatchError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const CONFLICT_MESSAGE = "Kontak ini sudah diambil agen lain, cek dulu sebelum mengirim";

const BOT_BLOCKED = (status: string) => {
  const s = status.trim().toLowerCase();
  return s === "sent" || s === "image_ok" || s.startsWith("error");
};

type Category =
  | "bot_sent"
  | "bot_partial"
  | "bot_error"
  | "manual_sent"
  | "not_wa"
  | "held"
  | "unprocessed";

export function classify(c: Contact, st: ContactState | undefined): Category {
  const s = c.status.trim().toLowerCase();
  if (s === "sent") return "bot_sent";
  if (s === "image_ok") return "bot_partial";
  if (s.startsWith("error")) return "bot_error";
  if (st?.state === "sent" || s === "manual_sent") return "manual_sent";
  if (st?.state === "skipped" || s === "not_wa") return "not_wa";
  if (st?.state === "claimed") return "held";
  if (s === "manual_claimed" && !st) return "held";
  return "unprocessed";
}

/** Boleh diklaim: status sheet kosong (atau manual_claimed sisa release/expire) DAN state free. */
export function isClaimable(c: Contact, st: ContactState | undefined): boolean {
  if (!normalizePhone(c.phone)) return false;
  const s = c.status.trim().toLowerCase();
  if (s === "") return !st || st.state === "free";
  if (s === "manual_claimed") return !!st && st.state === "free";
  return false;
}

export interface AgentView {
  agent: { name: string; isAdmin: boolean; dailyLimit: number };
  sentToday: number;
  limitReached: boolean;
  remaining: number;
  held: number;
  batch: { done: number; total: number } | null;
  current:
    | null
    | { locked: true; id: string; name: string; retryAfter: number }
    | {
        locked: false;
        id: string;
        name: string;
        phone: string;
        lapsed: boolean;
        message: string;
        waUrl: string;
        chatUrl: string;
      };
  botTaken: number;
  claimedNow?: number;
  settings: { batchSize: number; pacingMinSec: number; pacingMaxSec: number };
}

export interface AdminSummary {
  totals: {
    total: number;
    botSent: number;
    botPartial: number;
    manualSent: number;
    notWa: number;
    error: number;
    held: number;
    unprocessed: number;
    percentDone: number;
  };
  agents: {
    name: string;
    active: boolean;
    firstSentAt: string | null;
    lastSentAt: string | null;
    sentToday: number;
    sentTotal: number;
    skipped: number;
    held: number;
    dailyLimit: number;
  }[];
  stuck: { agent: string; held: number; idleMinutes: number; expired: boolean }[];
  feed: { ts: string; agent: string; action: string; contact: string; note: string }[];
  serverTime: string;
}

export interface MonitorSummary {
  totals: {
    total: number;
    /** Terkirim (bot + manual). */
    sent: number;
    botSent: number;
    manualSent: number;
    /** Nomor tidak terdaftar di WhatsApp / dilewati. */
    notWa: number;
    /** Error bot + terkirim sebagian (tanpa gambar). */
    error: number;
    held: number;
    unprocessed: number;
    /** Bagian dari unprocessed yang nomornya tidak valid (tidak akan pernah diklaim). */
    invalidPhone: number;
    percentDone: number;
  };
  /** 7 hari terakhir (WIB), pengiriman manual saja. */
  daily: { date: string; manualSent: number }[];
  lastActivityAt: string | null;
  serverTime: string;
}

export type MonitorList = "sent" | "pending" | "not_wa" | "held";

export interface MonitorContact {
  name: string;
  /** Nomor tersamar (mis. 6281****89), bukan nomor lengkap. */
  phone: string;
  detail: string;
}

export interface MonitorContacts {
  total: number;
  items: MonitorContact[];
}

// Hash dummy valid supaya login untuk nama yang tidak ada memakan waktu serupa.
const DUMMY_HASH = bcrypt.hashSync("dummy-pin", 10);

const newId = (prefix: string) =>
  prefix + globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10);

export class Dispatch {
  private lastSyncAt = 0;
  private syncing = false;

  constructor(
    readonly store: Store,
    readonly config: AppConfig,
    private readonly now: () => number = Date.now,
  ) {}

  private reduce(snap: Snapshot, at = this.now()) {
    return replayEvents(snap.events, at, { claimTimeoutMs: this.config.claimTimeoutMs });
  }

  // ---------- auth ----------
  async activeAgentNames(): Promise<string[]> {
    const snap = await this.store.snapshot();
    return snap.agents.filter((a) => a.active).map((a) => a.name);
  }

  async verifyLogin(name: string, pin: string): Promise<AgentRow> {
    const snap = await this.store.snapshot();
    const agent = snap.agents.find((a) => a.active && a.name === name);
    // bandingkan ke hash dummy bila agen tidak ada agar waktu respons mirip
    const hash = agent?.pinHash || DUMMY_HASH;
    const ok = await bcrypt.compare(pin, hash).catch(() => false);
    if (!agent || !ok) throw new DispatchError("BAD_LOGIN", "Nama atau PIN salah", 401);
    return agent;
  }

  requireAgent(snap: Snapshot, name: string): AgentRow {
    const agent = snap.agents.find((a) => a.name === name && a.active);
    if (!agent) throw new DispatchError("UNAUTHORIZED", "Sesi tidak valid", 401);
    return agent;
  }

  // ---------- helpers ----------
  private sentToday(states: Map<string, ContactState>, agent: string, at: number): number {
    const today = wibDateKey(at);
    let n = 0;
    for (const st of states.values()) {
      if (st.state === "sent" && st.resolvedBy === agent && st.resolvedAt && wibDateKey(st.resolvedAt) === today) n++;
    }
    return n;
  }

  private lastResolvedAt(states: Map<string, ContactState>, agent: string): number | null {
    let last: number | null = null;
    for (const st of states.values()) {
      if (st.resolvedBy === agent && st.resolvedAt && (last === null || st.resolvedAt > last)) last = st.resolvedAt;
    }
    return last;
  }

  private heldContacts(snap: Snapshot, states: Map<string, ContactState>, agent: string): Contact[] {
    return snap.contacts
      .filter((c) => canResolve(states.get(c.id), agent))
      .sort((a, b) => {
        const ta = states.get(a.id)?.claimedAt ?? 0;
        const tb = states.get(b.id)?.claimedAt ?? 0;
        return ta - tb || b.rowNumber - a.rowNumber; // urutan klaim: dari bawah daftar
      });
  }

  private paceWait(states: Map<string, ContactState>, agent: string, at: number): number {
    return pacingWaitMs(agent, this.lastResolvedAt(states, agent), at, this.config.pacingMinSec, this.config.pacingMaxSec);
  }

  // ---------- tampilan agen ----------
  buildView(snap: Snapshot, name: string, extra: Partial<AgentView> = {}): AgentView {
    const at = this.now();
    const agent = this.requireAgent(snap, name);
    const { states } = this.reduce(snap, at);
    const sentToday = this.sentToday(states, name, at);

    const heldAll = this.heldContacts(snap, states, name);
    const held = heldAll.filter((c) => !BOT_BLOCKED(c.status));
    const botTaken = heldAll.length - held.length;

    let remaining = 0;
    for (const c of snap.contacts) {
      const cat = classify(c, states.get(c.id));
      if (cat === "unprocessed" || cat === "held") remaining++;
    }

    const limitReached = sentToday >= agent.dailyLimit;
    let current: AgentView["current"] = null;
    if (held.length > 0 && !limitReached) {
      const c = held[0];
      const wait = this.paceWait(states, name, at);
      if (wait > 0) {
        current = { locked: true, id: c.id, name: c.name, retryAfter: Math.ceil(wait / 1000) };
      } else {
        const phone = normalizePhone(c.phone);
        const message = buildMessage(greetingFor(at), c.name);
        current = {
          locked: false,
          id: c.id,
          name: c.name,
          phone,
          lapsed: states.get(c.id)?.expired ?? false,
          message,
          waUrl: waLink(phone, message),
          chatUrl: waLink(phone),
        };
      }
    }

    let batch: AgentView["batch"] = null;
    const batchId = held.length ? (states.get(held[0].id)?.batchId ?? null) : null;
    if (batchId) {
      let done = 0;
      let total = 0;
      for (const st of states.values()) {
        if (st.batchId !== batchId) continue;
        if (st.state === "claimed" && st.holder === name) total++;
        else if ((st.state === "sent" || st.state === "skipped") && st.resolvedBy === name) {
          total++;
          done++;
        }
      }
      batch = { done, total };
    }

    return {
      agent: { name: agent.name, isAdmin: agent.isAdmin, dailyLimit: agent.dailyLimit },
      sentToday,
      limitReached,
      remaining,
      held: held.length,
      batch,
      current,
      botTaken,
      settings: {
        batchSize: this.config.batchSize,
        pacingMinSec: this.config.pacingMinSec,
        pacingMaxSec: this.config.pacingMaxSec,
      },
      ...extra,
    };
  }

  async getView(name: string): Promise<AgentView> {
    return this.buildView(await this.store.snapshot(), name);
  }

  // ---------- ambil jatah ----------
  async claimBatch(name: string): Promise<AgentView> {
    let snap = await this.store.snapshot({ fresh: true });
    const agent = this.requireAgent(snap, name);
    let at = this.now();
    let { states } = this.reduce(snap, at);

    if (this.heldContacts(snap, states, name).length > 0) {
      throw new DispatchError("HAS_ACTIVE", "Selesaikan atau lepas jatah yang masih dipegang dulu", 409);
    }
    const remainingLimit = agent.dailyLimit - this.sentToday(states, name, at);
    if (remainingLimit <= 0) {
      throw new DispatchError("DAILY_LIMIT", "Batas harian tercapai", 403);
    }
    const want = Math.min(this.config.batchSize, remainingLimit);
    const batchId = newId("b");

    let won = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const need = want - won;
      const picks = snap.contacts
        .filter((c) => isClaimable(c, states.get(c.id)))
        .sort((a, b) => b.rowNumber - a.rowNumber) // dari BAWAH; bot WAHA dari ATAS
        .slice(0, need);
      if (picks.length === 0) break;

      at = this.now();
      const events: SheetEvent[] = picks.map((c) => ({
        ts: at,
        contactId: c.id,
        action: "claim",
        agent: name,
        batchId,
        note: "",
      }));
      await this.store.appendEvents(events); // SATU append untuk seluruh batch

      snap = await this.store.snapshot({ fresh: true }); // baca ulang segar
      at = this.now();
      ({ states } = this.reduce(snap, at));
      won = 0;
      for (const st of states.values()) {
        if (st.state === "claimed" && st.holder === name && st.batchId === batchId) won++;
      }
      if (won >= want) break;
    }

    return this.buildView(snap, name, { claimedNow: won });
  }

  // ---------- sent / skip ----------
  async resolve(name: string, contactId: string, action: "sent" | "skip"): Promise<AgentView> {
    let snap = await this.store.snapshot();
    let agent = this.requireAgent(snap, name);
    let at = this.now();
    let { states } = this.reduce(snap, at);
    const wanted = action === "sent" ? "sent" : "skipped";

    // Cache bisa basi (instance serverless berbeda): penolakan selalu diverifikasi ulang secara segar.
    const rejected = () => {
      const st = states.get(contactId);
      const c = snap.contacts.find((x) => x.id === contactId);
      return !c || !canResolve(st, name) || BOT_BLOCKED(c.status);
    };
    const alreadyDone = () => {
      const st = states.get(contactId);
      return st?.state === wanted && st.resolvedBy === name;
    };
    if (!alreadyDone() && rejected()) {
      snap = await this.store.snapshot({ fresh: true });
      agent = this.requireAgent(snap, name);
      at = this.now();
      ({ states } = this.reduce(snap, at));
    }

    const contact = snap.contacts.find((c) => c.id === contactId);
    if (!contact) throw new DispatchError("NOT_FOUND", "Kontak tidak ditemukan", 404);
    const st = states.get(contactId);
    if (alreadyDone()) return this.buildView(snap, name); // idempoten (tap ganda)
    if (BOT_BLOCKED(contact.status)) {
      throw new DispatchError("CONFLICT", "Kontak ini sudah diproses bot, jangan kirim manual", 409);
    }
    if (!canResolve(st, name)) throw new DispatchError("CONFLICT", CONFLICT_MESSAGE, 409);

    const wait = this.paceWait(states, name, at);
    if (wait > 0) {
      const retryAfter = Math.ceil(wait / 1000);
      throw new DispatchError("PACING", `Tunggu ${retryAfter} detik sebelum pengiriman berikutnya`, 429, { retryAfter });
    }
    if (action === "sent" && this.sentToday(states, name, at) >= agent.dailyLimit) {
      throw new DispatchError("DAILY_LIMIT", "Batas harian tercapai", 403);
    }

    await this.store.appendEvents([
      { ts: at, contactId, action, agent: name, batchId: st?.batchId ?? "", note: "" },
    ]);

    snap = await this.store.snapshot({ fresh: true });
    const after = this.reduce(snap).states.get(contactId);
    // Arbiter urutan baris: jika klaim orang lain masuk lebih dulu, event kita tidak sah.
    if (!(after?.state === wanted && after.resolvedBy === name)) {
      throw new DispatchError("CONFLICT", CONFLICT_MESSAGE, 409);
    }
    return this.buildView(snap, name);
  }

  // ---------- lepas ----------
  async releaseMine(name: string): Promise<AgentView> {
    let snap = await this.store.snapshot({ fresh: true });
    this.requireAgent(snap, name);
    const at = this.now();
    const { states } = this.reduce(snap, at);
    const held = this.heldContacts(snap, states, name);
    if (held.length > 0) {
      await this.store.appendEvents(
        held.map((c) => ({
          ts: at,
          contactId: c.id,
          action: "release" as const,
          agent: name,
          batchId: states.get(c.id)?.batchId ?? "",
          note: "lepas sisa jatah",
        })),
      );
      snap = await this.store.snapshot({ fresh: true });
    }
    return this.buildView(snap, name);
  }

  async adminRelease(admin: string, target: string): Promise<{ released: number }> {
    const snap = await this.store.snapshot({ fresh: true });
    const me = this.requireAgent(snap, admin);
    if (!me.isAdmin) throw new DispatchError("FORBIDDEN", "Khusus admin", 403);
    const at = this.now();
    const { states } = this.reduce(snap, at);
    const held = this.heldContacts(snap, states, target);
    await this.store.appendEvents(
      held.map((c) => ({
        ts: at,
        contactId: c.id,
        action: "admin_release" as const,
        agent: admin,
        batchId: states.get(c.id)?.batchId ?? "",
        note: `paksa-lepas klaim ${target}`,
      })),
    );
    return { released: held.length };
  }

  private totals(snap: Snapshot, states: Map<string, ContactState>): AdminSummary["totals"] {
    const t = { total: 0, botSent: 0, botPartial: 0, manualSent: 0, notWa: 0, error: 0, held: 0, unprocessed: 0, percentDone: 0 };
    for (const c of snap.contacts) {
      t.total++;
      switch (classify(c, states.get(c.id))) {
        case "bot_sent": t.botSent++; break;
        case "bot_partial": t.botPartial++; break;
        case "bot_error": t.error++; break;
        case "manual_sent": t.manualSent++; break;
        case "not_wa": t.notWa++; break;
        case "held": t.held++; break;
        default: t.unprocessed++;
      }
    }
    t.percentDone = t.total ? Math.round(((t.botSent + t.manualSent + t.notWa) / t.total) * 1000) / 10 : 0;
    return t;
  }

  // ---------- monitoring (pemilik proyek, hanya agregat) ----------
  async monitorSummary(): Promise<MonitorSummary> {
    const snap = await this.store.snapshot();
    const at = this.now();
    const { states } = this.reduce(snap, at);
    const t = this.totals(snap, states);

    let invalidPhone = 0;
    for (const c of snap.contacts) {
      if (classify(c, states.get(c.id)) === "unprocessed" && !normalizePhone(c.phone)) invalidPhone++;
    }

    const perDay = new Map<string, number>();
    for (const st of states.values()) {
      if (st.state !== "sent" || !st.resolvedAt) continue;
      const k = wibDateKey(st.resolvedAt);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    let lastActivityAt: number | null = null;
    for (const e of snap.events) if (lastActivityAt === null || e.ts > lastActivityAt) lastActivityAt = e.ts;

    const daily: MonitorSummary["daily"] = [];
    for (let i = 6; i >= 0; i--) {
      const date = wibDateKey(at - i * 86_400_000);
      daily.push({ date, manualSent: perDay.get(date) ?? 0 });
    }

    return {
      totals: {
        total: t.total,
        sent: t.botSent + t.manualSent,
        botSent: t.botSent,
        manualSent: t.manualSent,
        notWa: t.notWa,
        error: t.error + t.botPartial,
        held: t.held,
        unprocessed: t.unprocessed,
        invalidPhone,
        percentDone: t.percentDone,
      },
      daily,
      lastActivityAt: lastActivityAt ? formatWIB(lastActivityAt) : null,
      serverTime: formatWIB(at),
    };
  }

  /** Daftar kontak per kategori untuk halaman monitor: cari berdasarkan nama, nomor selalu tersamar. */
  async monitorContacts(opts: { list: MonitorList; q: string; offset: number; limit: number }): Promise<MonitorContacts> {
    const snap = await this.store.snapshot();
    const { states } = this.reduce(snap, this.now());
    const q = opts.q.trim().toLowerCase();

    const rows: { c: Contact; detail: string; at: number }[] = [];
    for (const c of snap.contacts) {
      const st = states.get(c.id);
      const cat = classify(c, st);
      let detail: string;
      let at = 0;
      if (opts.list === "sent" && (cat === "bot_sent" || cat === "manual_sent")) {
        at = (cat === "manual_sent" ? st?.resolvedAt : parseWIB(c.sentAt)) ?? 0;
        detail = `${cat === "bot_sent" ? "Bot" : "Manual"}${at ? ` · ${formatWIB(at)}` : ""}`;
      } else if (opts.list === "not_wa" && cat === "not_wa") {
        at = st?.resolvedAt ?? 0;
        detail = at ? formatWIB(at) : "";
      } else if (opts.list === "held" && cat === "held") {
        at = st?.claimedAt ?? 0;
        detail = `${st?.holder ?? c.operator}${at ? ` · sejak ${formatWIB(at)}` : ""}`;
      } else if (opts.list === "pending" && cat === "unprocessed") {
        detail = normalizePhone(c.phone) ? "" : "Nomor tidak valid";
      } else continue;
      if (q && !c.name.toLowerCase().includes(q)) continue;
      rows.push({ c, detail, at });
    }

    // terbaru dulu bila ada waktu; selebihnya urutan sheet
    rows.sort((a, b) => b.at - a.at || a.c.rowNumber - b.c.rowNumber);
    return {
      total: rows.length,
      items: rows.slice(opts.offset, opts.offset + opts.limit).map(({ c, detail }) => ({
        name: c.name,
        phone: maskPhone(c.phone),
        detail,
      })),
    };
  }

  // ---------- admin ----------
  async adminSummary(admin: string): Promise<AdminSummary> {
    const snap = await this.store.snapshot();
    const me = this.requireAgent(snap, admin);
    if (!me.isAdmin) throw new DispatchError("FORBIDDEN", "Khusus admin", 403);
    const at = this.now();
    const { states, agentLast } = this.reduce(snap, at);

    const t = this.totals(snap, states);

    const today = wibDateKey(at);
    const agents = snap.agents.map((a) => {
      let first: number | null = null;
      let last: number | null = null;
      let sentToday = 0, sentTotal = 0, skipped = 0, held = 0;
      for (const st of states.values()) {
        if (st.state === "claimed" && st.holder === a.name) held++;
        if (st.resolvedBy !== a.name || !st.resolvedAt) continue;
        if (st.state === "skipped") skipped++;
        if (st.state !== "sent") continue;
        sentTotal++;
        if (wibDateKey(st.resolvedAt) === today) sentToday++;
        if (first === null || st.resolvedAt < first) first = st.resolvedAt;
        if (last === null || st.resolvedAt > last) last = st.resolvedAt;
      }
      return {
        name: a.name,
        active: a.active,
        firstSentAt: first ? formatWIB(first) : null,
        lastSentAt: last ? formatWIB(last) : null,
        sentToday,
        sentTotal,
        skipped,
        held,
        dailyLimit: a.dailyLimit,
      };
    });

    const heldPerAgent = new Map<string, number>();
    for (const st of states.values()) {
      if (st.state === "claimed" && st.holder) heldPerAgent.set(st.holder, (heldPerAgent.get(st.holder) ?? 0) + 1);
    }
    const stuckAfterMs = this.config.claimTimeoutMs / 2;
    const stuck = [...heldPerAgent]
      .map(([agent, held]) => {
        const idle = at - (agentLast.get(agent) ?? at);
        return { agent, held, idleMinutes: Math.floor(idle / 60_000), expired: idle > this.config.claimTimeoutMs, idle };
      })
      .filter((s) => s.idle >= stuckAfterMs)
      .map(({ idle: _idle, ...rest }) => rest);

    const nameOf = new Map(snap.contacts.map((c) => [c.id, c.name]));
    const feed = snap.events
      .slice(-40)
      .reverse()
      .map((e) => ({
        ts: formatWIB(e.ts),
        agent: e.agent,
        action: e.action,
        contact: nameOf.get(e.contactId) ?? e.contactId,
        note: e.note,
      }));

    return { totals: t, agents, stuck, feed, serverTime: formatWIB(at) };
  }

  // ---------- sinkronisasi balik ke sheet kontak ----------
  async sync(opts: { force?: boolean } = {}): Promise<{ skipped: boolean; updated: number; released: number }> {
    const at = this.now();
    if (this.syncing || (!opts.force && at - this.lastSyncAt < this.config.syncMinIntervalMs)) {
      return { skipped: true, updated: 0, released: 0 };
    }
    this.syncing = true;
    this.lastSyncAt = at;
    try {
      // Sync berjalan di akhir request yang baru saja membaca sheet: pakai snapshot <=3 dtk
      // (hemat kuota baca); jika lebih tua, baca ulang sehingga status sel bot tetap terbaru.
      const snap = await this.store.snapshot({ maxAgeMs: 3_000 });
      const { states } = this.reduce(snap, at);
      const cols = snap.contactCols;
      const sheet = quoteSheet(this.config.contactsSheet);
      const updates: CellUpdate[] = [];
      const releases: SheetEvent[] = [];

      for (const c of snap.contacts) {
        const st = states.get(c.id);
        if (!st) continue; // tanpa riwayat event: bukan urusan kita
        const cur = c.status.trim();
        const curL = cur.toLowerCase();
        const ours = curL === "" || curL.startsWith("manual_") || (curL === "not_wa" && c.operator !== "");

        let want: { status: string; operator?: string; claimed_at?: string; sent_at?: string } | null = null;
        if (st.state === "claimed") {
          if (curL !== "" && !curL.startsWith("manual_")) {
            // bot sudah mengambil/menyentuh kontak ini: batalkan klaim kita
            releases.push({ ts: at, contactId: c.id, action: "release", agent: st.holder!, batchId: st.batchId ?? "", note: "bentrok dengan bot" });
            continue;
          }
          want = { status: "manual_claimed", operator: st.holder!, claimed_at: formatWIB(st.claimedAt!) };
        } else if (st.state === "sent") {
          want = { status: "manual_sent", operator: st.resolvedBy!, sent_at: formatWIB(st.resolvedAt!) };
        } else if (st.state === "skipped") {
          want = { status: "not_wa", operator: st.resolvedBy!, sent_at: "" };
        } else if (curL === "manual_claimed") {
          want = { status: "", operator: "", claimed_at: "" };
        }
        // JANGAN PERNAH menimpa sent / image_ok / error...; hanya sel milik kita.
        if (!want || BOT_BLOCKED(cur) || !ours) continue;

        const current: Record<string, string> = {
          status: cur,
          operator: c.operator,
          claimed_at: c.claimedAt,
          sent_at: c.sentAt,
        };
        for (const [field, value] of Object.entries(want)) {
          if (!(field in cols) || current[field] === value) continue;
          updates.push({ range: `${sheet}!${columnLetter(cols[field])}${c.rowNumber}`, values: [[value]] });
        }
      }

      await this.store.writeCells(updates); // SATU batchUpdate
      await this.store.appendEvents(releases);
      return { skipped: false, updated: updates.length, released: releases.length };
    } finally {
      this.syncing = false;
    }
  }
}
