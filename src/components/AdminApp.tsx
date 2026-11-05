"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, MIN_REFRESH_MS } from "@/lib/client";
import type { AdminSummary } from "@/lib/service";

const ACTION_LABEL: Record<string, string> = {
  claim: "mengambil",
  sent: "mengirim",
  skip: "melewati",
  release: "melepas",
  expire: "kedaluwarsa",
  admin_release: "dipaksa lepas",
};

function Tile({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 text-center shadow-sm">
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

export function AdminApp() {
  const [data, setData] = useState<AdminSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const last = useRef(0);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminSummary>("/api/admin/summary"));
      last.current = Date.now();
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        window.location.href = "/";
        return;
      }
      setError(e instanceof ApiError ? e.message : "Gagal memuat");
    }
  }, []);

  // Polling 15 dtk hanya saat tab terlihat, plus saat kembali aktif.
  useEffect(() => {
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= MIN_REFRESH_MS) load();
    }, MIN_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= MIN_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function forceRelease(agent: string) {
    if (!confirm(`Paksa lepas semua klaim ${agent}?`)) return;
    setBusy(agent);
    try {
      await api("/api/admin/release", { method: "POST", body: { agent } });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal melepas");
    } finally {
      setBusy("");
    }
  }

  if (!data) return <main className="p-6 text-center text-gray-600">{error || "Memuat…"}</main>;
  const t = data.totals;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-emerald-800">Admin: progres</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">{data.serverTime} WIB</span>
          <a href="/" className="rounded-lg bg-white px-3 py-2 font-medium shadow-sm">
            Jatah saya
          </a>
        </div>
      </header>
      {error && <p role="alert" className="rounded-xl bg-red-100 p-3 text-sm text-red-800">{error}</p>}

      <section>
        <div className="mb-1 flex justify-between text-sm font-medium">
          <span>Selesai</span>
          <span>{t.percentDone}%</span>
        </div>
        <div className="h-4 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-emerald-600" style={{ width: `${t.percentDone}%` }} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Total kontak" value={t.total} />
        <Tile label="Terkirim bot" value={t.botSent} />
        <Tile label="Terkirim manual" value={t.manualSent} tone="text-emerald-700" />
        <Tile label="Tidak ada WA" value={t.notWa} />
        <Tile label="Error bot" value={t.error + t.botPartial} tone={t.error ? "text-red-700" : ""} />
        <Tile label="Sedang dipegang" value={t.held} tone="text-amber-700" />
        <Tile label="Belum diproses" value={t.unprocessed} />
      </section>

      {data.stuck.length > 0 && (
        <section className="rounded-2xl border border-amber-400 bg-amber-50 p-4">
          <h2 className="mb-2 font-semibold text-amber-900">Klaim macet</h2>
          <ul className="flex flex-col gap-2">
            {data.stuck.map((s) => (
              <li key={s.agent} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <b>{s.agent}</b>: {s.held} kontak, tidak aktif {s.idleMinutes} menit{s.expired ? " (kedaluwarsa)" : ""}
                </span>
                <button
                  disabled={busy === s.agent}
                  onClick={() => forceRelease(s.agent)}
                  className="rounded-lg bg-red-700 px-3 py-2 font-medium text-white disabled:opacity-50"
                >
                  Paksa lepas
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              {["Agen", "Kirim pertama", "Kirim terakhir", "Hari ini", "Total", "Dilewati", "Dipegang", "Status"].map((h) => (
                <th key={h} className="px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.agents.map((a) => (
              <tr key={a.name} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium">{a.name}</td>
                <td className="px-3 py-2 tabular-nums">{a.firstSentAt ?? "-"}</td>
                <td className="px-3 py-2 tabular-nums">{a.lastSentAt ?? "-"}</td>
                <td className="px-3 py-2 tabular-nums">{a.sentToday}/{a.dailyLimit}</td>
                <td className="px-3 py-2 tabular-nums">{a.sentTotal}</td>
                <td className="px-3 py-2 tabular-nums">{a.skipped}</td>
                <td className="px-3 py-2 tabular-nums">{a.held}</td>
                <td className="px-3 py-2">{a.active ? "Aktif" : "Nonaktif"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">Aktivitas terbaru</h2>
        <ul className="flex flex-col divide-y divide-gray-100 text-sm">
          {data.feed.map((f, i) => (
            <li key={i} className="flex justify-between gap-3 py-2">
              <span>
                <b>{f.agent}</b> {ACTION_LABEL[f.action] ?? f.action} dr. {f.contact}
                {f.note ? <span className="text-gray-500"> ({f.note})</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-gray-500">{f.ts.slice(11)}</span>
            </li>
          ))}
          {data.feed.length === 0 && <li className="py-2 text-gray-500">Belum ada aktivitas.</li>}
        </ul>
      </section>
    </main>
  );
}
