interface Entry {
  fails: number;
  firstAt: number;
  lockedUntil: number;
}

/**
 * Pembatas percobaan login gagal (in-memory). Di serverless tiap instance punya memori sendiri,
 * jadi ini perlambat brute-force, bukan jaminan mutlak; PIN tetap di-hash bcrypt.
 */
export class LoginThrottle {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly opts = { maxFails: 5, windowMs: 15 * 60_000, lockMs: 10 * 60_000 },
    private readonly now: () => number = Date.now,
  ) {}

  /** Detik yang harus ditunggu (0 jika boleh mencoba). */
  retryAfter(keys: string[]): number {
    const at = this.now();
    let wait = 0;
    for (const k of keys) {
      const e = this.entries.get(k);
      if (e && e.lockedUntil > at) wait = Math.max(wait, Math.ceil((e.lockedUntil - at) / 1000));
    }
    return wait;
  }

  fail(keys: string[]): void {
    const at = this.now();
    if (this.entries.size > 5000) this.prune(at);
    for (const k of keys) {
      let e = this.entries.get(k);
      if (!e || at - e.firstAt > this.opts.windowMs) e = { fails: 0, firstAt: at, lockedUntil: 0 };
      e.fails++;
      if (e.fails >= this.opts.maxFails) {
        e.lockedUntil = at + this.opts.lockMs;
        e.fails = 0;
        e.firstAt = at;
      }
      this.entries.set(k, e);
    }
  }

  reset(keys: string[]): void {
    for (const k of keys) this.entries.delete(k);
  }

  private prune(at: number) {
    for (const [k, e] of this.entries) {
      if (e.lockedUntil < at && at - e.firstAt > this.opts.windowMs) this.entries.delete(k);
    }
  }
}
