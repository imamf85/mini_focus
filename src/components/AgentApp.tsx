"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, MIN_REFRESH_MS } from "@/lib/client";
import type { AgentView } from "@/lib/service";

const OPENED_KEY = "mf_opened";

function formatPhone(p: string) {
  return "+" + p.replace(/^(\d{2})(\d{3})(\d{4})(\d+)$/, "$1 $2-$3-$4");
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function AgentApp() {
  const [view, setView] = useState<AgentView | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [poster, setPoster] = useState(false);
  const [unlockAt, setUnlockAt] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const lastFetch = useRef(0);
  const openedFor = useRef<string | null>(null);

  const apply = useCallback((v: AgentView) => {
    setView(v);
    lastFetch.current = Date.now();
    setUnlockAt(v.current?.locked ? Date.now() + v.current.retryAfter * 1000 : null);
    const stored = sessionStorage.getItem(OPENED_KEY);
    if (stored && v.current && !v.current.locked && v.current.id === stored) {
      openedFor.current = stored;
      setSheetFor(stored);
    } else if (!v.current || v.current.id !== stored) {
      sessionStorage.removeItem(OPENED_KEY);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api<AgentView>("/api/me"));
      setError("");
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setError(e instanceof ApiError ? e.message : "Gagal memuat");
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh hanya saat halaman kembali aktif (maks 1x / 15 dtk); tanpa polling.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (openedFor.current) {
        setSheetFor(openedFor.current); // kembali dari WhatsApp: tanyakan hasilnya
      } else if (Date.now() - lastFetch.current >= MIN_REFRESH_MS) {
        load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [load]);

  // Hitung mundur pacing; saat habis, ambil link kontak dari server.
  useEffect(() => {
    if (unlockAt === null) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((unlockAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        setUnlockAt(null);
        load();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [unlockAt, load]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  async function run(fn: () => Promise<AgentView>) {
    setBusy(true);
    setError("");
    try {
      apply(await fn());
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "CONFLICT") {
          setWarning(e.message);
          setSheetFor(null);
          openedFor.current = null;
          sessionStorage.removeItem(OPENED_KEY);
          await load();
        } else if (e.code === "PACING" && e.retryAfter) {
          setToast(`Tunggu ${e.retryAfter} detik sebelum pengiriman berikutnya`);
          setUnlockAt(Date.now() + e.retryAfter * 1000);
        } else {
          setError(e.message);
        }
      } else {
        setError("Koneksi bermasalah, coba lagi");
      }
    } finally {
      setBusy(false);
    }
  }

  const cur = view?.current && !view.current.locked ? view.current : null;

  function openWa(url: string, id: string) {
    openedFor.current = id;
    sessionStorage.setItem(OPENED_KEY, id);
    window.open(url, "_blank", "noopener");
  }

  function decide(action: "sent" | "skip") {
    const id = sheetFor ?? cur?.id;
    if (!id) return;
    openedFor.current = null;
    sessionStorage.removeItem(OPENED_KEY);
    setSheetFor(null);
    run(() => api<AgentView>("/api/action", { method: "POST", body: { contactId: id, action } }));
  }

  async function logout() {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  if (!view) {
    return <main className="p-6 text-center text-gray-600">{error || "Memuat…"}</main>;
  }

  const sheetContact = sheetFor && view.current?.id === sheetFor ? view.current : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4 pb-32">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">Masuk sebagai</p>
          <p className="font-semibold">{view.agent.name}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {view.agent.isAdmin && (
            <a href="/admin" className="rounded-lg bg-white px-3 py-2 font-medium text-emerald-800 shadow-sm">
              Admin
            </a>
          )}
          <button onClick={logout} className="rounded-lg px-3 py-2 text-gray-600">
            Keluar
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <p className="text-2xl font-bold">{view.remaining}</p>
          <p className="text-xs text-gray-500">Sisa kontak global</p>
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <p className="text-2xl font-bold">
            {view.sentToday}
            <span className="text-base font-medium text-gray-400"> / {view.agent.dailyLimit}</span>
          </p>
          <p className="text-xs text-gray-500">Terkirim hari ini</p>
        </div>
      </section>

      {warning && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-red-500 bg-red-50 p-4 text-red-900">
          <p className="flex-1 font-semibold">⚠️ {warning}</p>
          <button onClick={() => setWarning("")} className="text-sm underline">
            Tutup
          </button>
        </div>
      )}
      {view.botTaken > 0 && (
        <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900">
          {view.botTaken} kontak di jatahmu sudah diproses bot dan disembunyikan.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-100 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {view.held === 0 || !view.current ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
          {view.limitReached ? (
            <p className="text-lg font-semibold text-amber-800">Batas harian tercapai. Terima kasih!</p>
          ) : (
            <>
              {view.claimedNow === 0 && <p className="text-gray-600">Tidak ada kontak tersisa untuk diambil.</p>}
              <button
                disabled={busy}
                onClick={() => run(() => api<AgentView>("/api/claim", { method: "POST" }))}
                className="h-20 w-full rounded-2xl bg-emerald-700 text-xl font-bold text-white shadow disabled:opacity-60"
              >
                {busy ? "Mengambil…" : `Ambil jatah (${view.settings.batchSize} kontak)`}
              </button>
            </>
          )}
        </section>
      ) : (
        <>
          {view.batch && (
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">Progres jatah</span>
                <span>
                  {view.batch.done}/{view.batch.total}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${(view.batch.done / Math.max(1, view.batch.total)) * 100}%` }}
                />
              </div>
            </div>
          )}

          <section className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">Kontak sekarang</p>
            <h1 className="mt-1 text-2xl font-bold leading-tight">dr. {view.current.name}</h1>
            {cur ? (
              <>
                <p className="mt-1 text-lg tabular-nums text-gray-700">{formatPhone(cur.phone)}</p>
                {cur.lapsed && (
                  <p className="mt-2 rounded-lg bg-amber-100 p-2 text-sm text-amber-900">
                    Jatah ini sempat kedaluwarsa. Cek dulu sebelum mengirim.
                  </p>
                )}
                <button
                  onClick={() => openWa(cur.waUrl, cur.id)}
                  className="mt-4 h-16 w-full rounded-2xl bg-emerald-600 text-xl font-bold text-white active:bg-emerald-700"
                >
                  Buka WhatsApp
                </button>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    onClick={async () => {
                      await copyText(cur.message);
                      setToast("Pesan disalin");
                    }}
                    className="h-14 rounded-xl border border-gray-300 font-medium"
                  >
                    Salin pesan
                  </button>
                  <button
                    onClick={() => openWa(cur.chatUrl, cur.id)}
                    className="h-14 rounded-xl border border-gray-300 font-medium"
                  >
                    Buka chat saja
                  </button>
                </div>
                <button
                  onClick={() => setPoster(true)}
                  className="mt-3 h-14 w-full rounded-xl border border-emerald-600 font-medium text-emerald-800"
                >
                  Simpan poster
                </button>
              </>
            ) : (
              <div className="mt-4 rounded-2xl bg-gray-100 p-5 text-center">
                <p className="text-sm text-gray-600">Jeda antar pengiriman. Link kontak dibuka dalam</p>
                <p className="my-2 text-5xl font-bold tabular-nums">{left}</p>
                <p className="text-sm text-gray-600">detik</p>
              </div>
            )}
          </section>

          {cur && (
            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={busy}
                onClick={() => decide("sent")}
                className="h-16 rounded-2xl bg-emerald-800 font-bold text-white disabled:opacity-60"
              >
                Sudah terkirim
              </button>
              <button
                disabled={busy}
                onClick={() => decide("skip")}
                className="h-16 rounded-2xl bg-gray-700 font-semibold text-white disabled:opacity-60"
              >
                Tidak ada WA / lewati
              </button>
            </div>
          )}

          <button
            disabled={busy}
            onClick={() => {
              if (confirm(`Lepas ${view.held} kontak yang belum dikirim?`)) {
                run(() => api<AgentView>("/api/release", { method: "POST" }));
              }
            }}
            className="mt-2 h-12 rounded-xl text-sm font-medium text-red-700 underline disabled:opacity-50"
          >
            Lepas sisa jatah ({view.held})
          </button>
        </>
      )}

      {toast && (
        <div className="fixed inset-x-4 bottom-6 z-20 mx-auto max-w-md rounded-xl bg-gray-900 p-3 text-center text-white shadow-lg">
          {toast}
        </div>
      )}

      {sheetContact && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/50" role="dialog" aria-modal="true">
          <div className="w-full rounded-t-3xl bg-white p-5 pb-8">
            <h2 className="mb-4 text-xl font-bold">Sudah terkirim ke dr. {sheetContact.name}?</h2>
            <div className="flex flex-col gap-3">
              <button onClick={() => decide("sent")} className="h-16 rounded-2xl bg-emerald-700 text-lg font-bold text-white">
                Sudah terkirim
              </button>
              <button onClick={() => decide("skip")} className="h-16 rounded-2xl bg-gray-700 text-lg font-semibold text-white">
                Tidak ada WA
              </button>
              <button
                onClick={() => {
                  openedFor.current = null;
                  sessionStorage.removeItem(OPENED_KEY);
                  setSheetFor(null);
                }}
                className="h-14 rounded-2xl border border-gray-300 text-lg font-medium"
              >
                Belum
              </button>
            </div>
          </div>
        </div>
      )}

      {poster && (
        <div className="fixed inset-0 z-40 flex flex-col items-center gap-3 overflow-auto bg-black/90 p-4">
          <p className="rounded-lg bg-white/10 p-3 text-center text-sm text-white">
            Tekan-tahan gambar, lalu pilih <b>Simpan ke Foto</b> / <b>Download image</b>. Lampirkan sendiri di chat WhatsApp.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/poster.jpg" alt="Poster Mini FOKUS 2026" className="max-h-[75dvh] w-auto rounded-lg" />
          <button onClick={() => setPoster(false)} className="h-14 w-full max-w-xs rounded-xl bg-white font-semibold">
            Tutup
          </button>
        </div>
      )}
    </main>
  );
}
