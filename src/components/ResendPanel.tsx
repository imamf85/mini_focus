"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { ResendCandidates, ResendMatch } from "@/lib/service";

const PAGE = 25;
const input = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

interface Props {
  /** Dipanggil setelah kontak dibuka ulang, supaya ringkasan admin dimuat ulang. */
  onChanged: () => void;
}

/** Admin memilih kontak yang sudah pernah terkirim untuk dikirim ulang. */
export function ResendPanel({ onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState("all");
  const [operator, setOperator] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ResendCandidates | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");
  const [match, setMatch] = useState<ResendMatch | null>(null);

  async function matchPaste() {
    setBusy(true);
    try {
      const r = await api<ResendMatch>("/api/admin/resend/match", { method: "POST", body: { text: paste } });
      setMatch(r);
      setSelected((s) => new Set([...s, ...r.ids]));
      setMsg("");
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal mencocokkan");
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(async () => {
    const p = new URLSearchParams({ q, source, operator, offset: String(page * PAGE), limit: String(PAGE) });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    try {
      setData(await api<ResendCandidates>(`/api/admin/resend?${p}`));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal memuat");
    }
  }, [q, from, to, source, operator, page]);

  // Debounce singkat agar mengetik pencarian tidak menembak API tiap huruf.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [open, load]);

  const resetPage = () => setPage(0);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pageIds = data?.items.map((i) => i.id) ?? [];
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  async function submit() {
    const ids = [...selected];
    const recent = data?.items.filter((i) => selected.has(i.id) && i.recent).length ?? 0;
    const warn = recent > 0 ? `\n\n${recent} kontak di halaman ini baru dikirim < ${data?.recentDays} hari lalu.` : "";
    if (!confirm(`Kirim ulang ke ${ids.length} kontak? Kontak masuk antrean dan bisa diambil agen mana pun.${warn}`)) return;
    setBusy(true);
    try {
      const r = await api<{ reopened: number; skipped: number }>("/api/admin/resend", {
        method: "POST",
        body: { contactIds: ids },
      });
      setMsg(`${r.reopened} kontak masuk antrean kirim ulang${r.skipped ? `, ${r.skipped} dilewati (tidak layak)` : ""}.`);
      setSelected(new Set());
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal membuka ulang");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between font-semibold">
        <span>Kirim ulang pesan</span>
        <span className="text-gray-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <details className="rounded-xl border border-gray-200 p-3">
            <summary className="cursor-pointer font-medium">Tempel daftar nomor</summary>
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                className={`${input} h-32 font-mono`}
                placeholder={"Satu nomor per baris (atau pisah koma), mis.\n0812xxxxxxx\n+62 813-xxxx-xxxx"}
                value={paste}
                onChange={(e) => { setPaste(e.target.value); setMatch(null); }}
              />
              <div className="flex items-center gap-3">
                <button
                  disabled={busy || !paste.trim()}
                  onClick={matchPaste}
                  className="rounded-lg bg-emerald-700 px-3 py-2 font-medium text-white disabled:opacity-50"
                >
                  Cocokkan &amp; pilih
                </button>
                {match && (
                  <span className="text-gray-600">
                    {match.parsed} nomor dibaca: <b className="text-emerald-700">{match.ids.length} dipilih</b>
                    {match.notFound.length > 0 && <>, {match.notFound.length} tidak ditemukan</>}
                    {match.ineligible.length > 0 && <>, {match.ineligible.length} belum layak</>}
                  </span>
                )}
              </div>
              {match && match.notFound.length > 0 && (
                <p className="text-xs text-gray-500">Tidak ditemukan: {match.notFound.join(", ")}</p>
              )}
              {match && match.ineligible.length > 0 && (
                <p className="text-xs text-gray-500">
                  Belum layak:{" "}
                  {match.ineligible.map((i) => `${i.phone} (${i.reason === "queued" ? "sudah antre" : "belum pernah terkirim"})`).join(", ")}
                </p>
              )}
            </div>
          </details>

          <div className="flex flex-wrap gap-2">
            <input className={`${input} min-w-40 flex-1`} placeholder="Cari nama…" value={q} onChange={(e) => { setQ(e.target.value); resetPage(); }} />
            <label className="flex items-center gap-1 text-gray-500">
              Dari <input type="date" className={input} value={from} onChange={(e) => { setFrom(e.target.value); resetPage(); }} />
            </label>
            <label className="flex items-center gap-1 text-gray-500">
              Sampai <input type="date" className={input} value={to} onChange={(e) => { setTo(e.target.value); resetPage(); }} />
            </label>
            <select className={input} value={source} onChange={(e) => { setSource(e.target.value); resetPage(); }}>
              <option value="all">Bot + manual</option>
              <option value="bot">Bot saja</option>
              <option value="manual">Manual saja</option>
            </select>
            <input className={`${input} w-36`} placeholder="Agen pengirim" value={operator} onChange={(e) => { setOperator(e.target.value); resetPage(); }} />
          </div>

          {error && <p role="alert" className="rounded-xl bg-red-100 p-2 text-red-800">{error}</p>}
          {msg && <p className="rounded-xl bg-emerald-100 p-2 text-emerald-900">{msg}</p>}

          {data && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-600">
                  {data.total} kontak layak · {selected.size} dipilih
                </span>
                <span className="flex gap-2">
                  <button
                    className="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-50"
                    disabled={data.total === 0}
                    onClick={() => setSelected(new Set(data.ids))}
                  >
                    Pilih semua hasil filter{data.idsCapped ? ` (maks ${data.ids.length})` : ""}
                  </button>
                  <button className="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-50" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                    Kosongkan
                  </button>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label="Pilih halaman ini"
                          checked={pageAll}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              for (const id of pageIds) pageAll ? n.delete(id) : n.add(id);
                              return n;
                            })
                          }
                        />
                      </th>
                      {["Nama", "Nomor", "Dikirim oleh", "Waktu kirim", "Kirim ulang"].map((h) => (
                        <th key={h} className="px-2 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((i) => (
                      <tr key={i.id} className="border-t border-gray-100">
                        <td className="px-2 py-2">
                          <input type="checkbox" aria-label={`Pilih ${i.name}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                        </td>
                        <td className="px-2 py-2 font-medium">{i.name}</td>
                        <td className="px-2 py-2 tabular-nums">{i.phone}</td>
                        <td className="px-2 py-2">{i.source === "bot" ? "Bot" : i.operator || "Manual"}</td>
                        <td className="px-2 py-2 tabular-nums">
                          {i.sentAt ?? "-"}
                          {i.recent && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">baru</span>}
                        </td>
                        <td className="px-2 py-2 tabular-nums">{i.resends > 0 ? `${i.resends}×` : "-"}</td>
                      </tr>
                    ))}
                    {data.items.length === 0 && (
                      <tr><td colSpan={6} className="px-2 py-3 text-gray-500">Tidak ada kontak yang cocok.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex gap-2">
                  <button className="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-50" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Sebelumnya
                  </button>
                  <button className="rounded-lg bg-gray-100 px-3 py-2 disabled:opacity-50" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>
                    Berikutnya
                  </button>
                </span>
                <button
                  disabled={busy || selected.size === 0}
                  onClick={submit}
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-50"
                >
                  Kirim ulang ({selected.size})
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
