"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

export function LoginForm() {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ names: string[] }>("/api/agents")
      .then((r) => {
        setNames(r.names);
        setName(r.names[0] ?? "");
      })
      .catch(() => setError("Gagal memuat daftar agen"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { method: "POST", body: { name, pin } });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal masuk");
      setPin("");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-emerald-800">Mini FOKUS Dispatch</h1>
        <p className="text-sm text-gray-600">Masuk untuk mengambil jatah kontak.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nama
          <select
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-14 rounded-xl border border-gray-300 bg-white px-3 text-lg"
          >
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="h-14 rounded-xl border border-gray-300 bg-white px-3 text-center text-2xl tracking-[0.5em]"
          />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-100 p-3 text-sm text-red-800">{error}</p>}
        <button
          disabled={busy || !name || pin.length < 4}
          className="h-14 rounded-xl bg-emerald-700 text-lg font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Masuk…" : "Masuk"}
        </button>
      </form>
    </main>
  );
}
