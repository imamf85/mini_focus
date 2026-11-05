import type { ContactState, ContactStateName, SheetEvent } from "./types";

interface Internal {
  state: ContactStateName;
  holder: string | null;
  claimedAt: number | null;
  batchId: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
}

const fresh = (): Internal => ({
  state: "free",
  holder: null,
  claimedAt: null,
  batchId: null,
  resolvedBy: null,
  resolvedAt: null,
});

export interface ReduceConfig {
  claimTimeoutMs: number;
}

export interface Replay {
  states: Map<string, ContactState>;
  /** Aktivitas terakhir per agen (event apa pun, sah atau tidak). */
  agentLast: Map<string, number>;
}

/**
 * Memutar ulang log event. Urutan baris di sheet events adalah arbiter:
 * event yang lebih awal di log menang, event berikutnya yang tidak sah diabaikan.
 */
export function replayEvents(
  events: SheetEvent[],
  now: number,
  config: ReduceConfig,
): Replay {
  const internal = new Map<string, Internal>();
  const agentLast = new Map<string, number>();
  const timeout = config.claimTimeoutMs;

  const isLapsed = (s: Internal, at: number) =>
    s.state === "claimed" &&
    s.holder !== null &&
    at - (agentLast.get(s.holder) ?? s.claimedAt ?? at) > timeout;

  for (const e of events) {
    const s = internal.get(e.contactId) ?? fresh();
    internal.set(e.contactId, s);

    switch (e.action) {
      case "claim":
        if (s.state === "free" || isLapsed(s, e.ts)) {
          s.state = "claimed";
          s.holder = e.agent;
          s.claimedAt = e.ts;
          s.batchId = e.batchId || null;
        }
        break;
      case "sent":
      case "skip":
        if (s.state === "claimed" && s.holder === e.agent) {
          s.state = e.action === "sent" ? "sent" : "skipped";
          s.resolvedBy = e.agent;
          s.resolvedAt = e.ts;
        }
        break;
      case "release":
        if (s.state === "claimed" && s.holder === e.agent) {
          s.state = "free";
          s.holder = null;
          s.claimedAt = null;
          s.batchId = null;
        }
        break;
      case "admin_release":
        // Pemanggil sudah diverifikasi sebagai admin oleh API sebelum event ditulis.
        if (s.state === "claimed") {
          s.state = "free";
          s.holder = null;
          s.claimedAt = null;
          s.batchId = null;
        }
        break;
      case "expire":
        if (isLapsed(s, e.ts)) {
          s.state = "free";
          s.holder = null;
          s.claimedAt = null;
          s.batchId = null;
        }
        break;
    }
    // Aktivitas dicatat setelah evaluasi, supaya event si pemegang sendiri
    // tidak menyelamatkan klaimnya dari kedaluwarsa pada event yang sama.
    agentLast.set(e.agent, Math.max(agentLast.get(e.agent) ?? 0, e.ts));
  }

  const states = new Map<string, ContactState>();
  for (const [contactId, s] of internal) {
    const lastActivityAt = s.holder ? (agentLast.get(s.holder) ?? null) : null;
    const lapsed = isLapsed(s, now);
    states.set(contactId, {
      contactId,
      state: lapsed ? "free" : s.state,
      holder: lapsed ? null : s.holder,
      claimedAt: lapsed ? null : s.claimedAt,
      lastActivityAt,
      batchId: lapsed ? null : s.batchId,
      resolvedBy: s.resolvedBy,
      resolvedAt: s.resolvedAt,
      expired: lapsed,
      lapsedHolder: lapsed ? s.holder : null,
      hasHistory: true,
    });
  }
  return { states, agentLast };
}

export function reduceEvents(
  events: SheetEvent[],
  now: number,
  config: ReduceConfig,
): Map<string, ContactState> {
  return replayEvents(events, now, config).states;
}

/** Apakah agen boleh menandai sent/skip kontak ini sekarang? */
export function canResolve(st: ContactState | undefined, agent: string): boolean {
  if (!st) return false;
  if (st.state === "claimed") return st.holder === agent;
  return st.state === "free" && st.lapsedHolder === agent;
}

/** Kontak yang dipegang agen (termasuk klaim kedaluwarsa yang belum diambil orang lain). */
export function heldBy(st: ContactState | undefined, agent: string): boolean {
  return canResolve(st, agent);
}
