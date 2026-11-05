export type EventAction =
  | "claim"
  | "sent"
  | "skip"
  | "release"
  | "expire"
  | "admin_release";

export interface SheetEvent {
  ts: number; // epoch ms
  contactId: string;
  action: EventAction;
  agent: string;
  batchId: string;
  note: string;
}

export type ContactStateName = "free" | "claimed" | "sent" | "skipped";

export interface ContactState {
  contactId: string;
  state: ContactStateName;
  holder: string | null;
  claimedAt: number | null;
  /** Aktivitas terakhir pemegang (global, semua kontak) saat ini. */
  lastActivityAt: number | null;
  batchId: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  /** Klaim sudah kedaluwarsa (state diproyeksikan menjadi free). */
  expired: boolean;
  /** Pemegang klaim yang kedaluwarsa; masih boleh sent/skip jika belum diambil orang lain. */
  lapsedHolder: string | null;
  hasHistory: boolean;
}

export interface Contact {
  id: string;
  rowNumber: number;
  name: string;
  phone: string;
  status: string;
  session: string;
  sentAt: string;
  operator: string;
  claimedAt: string;
}

export interface AgentRow {
  name: string;
  pinHash: string;
  isAdmin: boolean;
  dailyLimit: number;
  active: boolean;
}

export interface AppConfig {
  contactsSheet: string;
  batchSize: number;
  claimTimeoutMs: number;
  pacingMinSec: number;
  pacingMaxSec: number;
  syncMinIntervalMs: number;
  cacheTtlMs: number;
}
