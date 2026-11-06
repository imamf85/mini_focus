"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MonitorSummary } from "@/lib/service";

const REFRESH_MS = 60_000;
const KEY = "mf_monitor_key";

const nf = new Intl.NumberFormat("id-ID");
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

function Row({ label, hint, value, total, color }: { label: string; hint: string; value: number; total: number; color: string }) {
  return (
    <li className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span className="text-2xl font-bold tabular-nums">{nf.format(value)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full ${color}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
      <p className="mt-1 flex justify-between text-xs text-gray-500">
        <span>{hint}</span>
        <span className="tabular-nums">{pct(value, total)}%</span>
      </p>
    </li>
  );
}

export function MonitorApp() {
  const [data, setData] = useState<MonitorSummary | null>(null);
  const [error, setError] = useState("");
  const key = useRef("");
  const last = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/monitor", { cache: "no-store", headers: { "x-monitor-key": key.current } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setData(null);
        setError(res.status === 403 ? "Tautan tidak valid. Minta tautan monitor yang benar." : (body.message ?? "Gagal memuat"));
        return;
      }
      setData(body as MonitorSummary);
      last.current = Date.now();
      setError("");
    } catch {
      setError("Gagal memuat, akan dicoba lagi");
    }
  }, []);

  useEffect(() => {
    // Token ada di URL fragment (#key=...) agar tidak ikut terkirim ke server/log; simpan lalu bersihkan URL.
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (fromHash) {
      sessionStorage.setItem(KEY, fromHash);
      history.replaceState(null, "", window.location.pathname);
    }
    key.current = sessionStorage.getItem(KEY) ?? "";
    if (!key.current) {
      setError("Buka halaman ini lewat tautan monitor yang diberikan.");
      return;
    }
    load();
    const tick = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= REFRESH_MS) load();
    };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  if (!data) return <main className="p-6 text-center text-gray-600">{error || "Memuat…"}</main>;
  const t = data.totals;
  const remaining = t.unprocessed + t.held;
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.manualSent));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 p-4">
      <header>
        <h1 className="text-xl font-bold text-emerald-800">Monitoring pengiriman pesan</h1>
        <p className="text-sm text-gray-500">
          Diperbarui {data.serverTime} WIB · otomatis tiap 1 menit
          {data.lastActivityAt ? ` · aktivitas terakhir ${data.lastActivityAt} WIB` : ""}
        </p>
      </header>
      {error && <p role="alert" className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">{error}</p>}

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Progres keseluruhan</span>
          <span className="text-3xl font-bold tabular-nums text-emerald-700">{t.percentDone}%</span>
        </div>
        <div className="mt-2 h-4 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-emerald-600" style={{ width: `${t.percentDone}%` }} />
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {nf.format(t.sent + t.notWa)} dari {nf.format(t.total)} kontak sudah selesai diproses (terkirim + tidak terdaftar WA).
          Sisa {nf.format(remaining)} kontak.
        </p>
      </section>

      <ul className="flex flex-col gap-3">
        <Row label="Sudah terkirim" hint="Pesan dikirim dalam persen (%)" value={t.sent} total={t.total} color="bg-emerald-600" />
        <Row label="Belum dikirim" hint="Menunggu diambil agen" value={t.unprocessed} total={t.total} color="bg-gray-500" />
        <Row label="Sedang dikerjakan agen" hint="Sudah dipegang agen, belum terkirim" value={t.held} total={t.total} color="bg-amber-500" />
        <Row label="Nomor tidak terdaftar WhatsApp" hint="Tidak ada WA / dilewati" value={t.notWa} total={t.total} color="bg-sky-500" />
        <Row label="Gagal / error" hint="Error dari bot atau terkirim sebagian" value={t.error} total={t.total} color="bg-red-600" />
      </ul>
      {t.invalidPhone > 0 && (
        <p className="text-xs text-gray-500">
          Catatan: {nf.format(t.invalidPhone)} dari “belum dikirim” memiliki format nomor tidak valid dan tidak akan diambil agen.
        </p>
      )}

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">Pengiriman pesan 7 hari terakhir</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {data.daily.map((d) => (
            <li key={d.date} className="flex items-center gap-3">
              <span className="w-24 shrink-0 tabular-nums text-gray-500">{d.date.slice(8)}/{d.date.slice(5, 7)}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full bg-emerald-600" style={{ width: `${(d.manualSent / maxDaily) * 100}%` }} />
              </div>
              <span className="w-10 text-right tabular-nums">{nf.format(d.manualSent)}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
