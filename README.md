# Mini FOKUS Dispatch

Web app internal untuk beberapa agen (kebanyakan lewat HP) mengirim pesan WhatsApp manual (link `wa.me`) ke daftar dokter gigi **tanpa kontak ganda**, dengan tracker progres real-time. Database: Google Spreadsheet. Hosting: Vercel (Hobby, tanpa Cron).

> Repo ini berisi data pribadi (nomor telepon dokter): **jaga repo tetap private**.

## Arsitektur singkat

- **Next.js (App Router) + TypeScript + Tailwind**; UI berbahasa Indonesia; semua waktu WIB (Asia/Jakarta).
- **Google Sheets = database**, diakses lewat service account (`@googleapis/sheets`).
  - `delivery_kitchen` (sudah ada, dipakai bot WAHA): kolom dibaca **berdasarkan nama header**.
  - `events` (append-only): sumber kebenaran klaim. `agents`: nama, PIN ber-hash, admin, batas harian.
- **Anti double-send**: Sheets tidak punya transaksi, jadi dipakai *event log + urutan baris sebagai arbiter*. `reduceEvents()` (`src/lib/state.ts`, fungsi murni) memutar ulang log; klaim yang lebih awal di log menang. Agen hanya memakai kontak yang **terbukti dimenangkannya** setelah membaca ulang log secara segar.
- **Ambil jatah** = 1 append berisi seluruh klaim batch, baca ulang segar, hitung ulang, kembalikan hanya yang dimenangkan (maks 2 percobaan ulang bila kurang). Dipilih dari **bawah** daftar.
- **Sinkronisasi balik** ke `delivery_kitchen` (status, operator, claimed_at, sent_at): satu `batchUpdate`, idempoten, jeda minimal 30 dtk, berjalan malas di akhir request (`after()`) dan saat dashboard admin dibuka.
- Auth: cookie sesi JWT (jose, HS256), PIN bcrypt, validasi zod.

```
src/lib/state.ts      reduceEvents / replayEvents (inti anti double-send)
src/lib/service.ts    Dispatch: klaim, sent/skip, release, admin, sync
src/lib/store.ts      baca batchGet + cache 10 dtk, append events, tulis sel
src/lib/sheets/       klien Google, mock in-memory, retry backoff, parser tabel
src/lib/message.ts    template pesan + link wa.me
src/lib/{phone,time,pacing,config,session,throttle}.ts
src/app/api/*         endpoint (semua cek sesi/peran)
src/components/*      UI agen, admin, login
scripts/              init-sheet, hash-pin
tests/                vitest (memakai mock Sheets, tidak menyentuh Google)
```

## 1. Menyiapkan Google Cloud

1. Buka <https://console.cloud.google.com>, buat **project** baru.
2. **APIs & Services → Library** → cari **Google Sheets API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** (nama bebas, tanpa role project).
4. Buka service account itu → tab **Keys → Add key → Create new key → JSON**. File JSON terunduh. **Jangan di-commit.**
5. Buka spreadsheet → **Share** → tempel email service account (`...@...iam.gserviceaccount.com`) sebagai **Editor**.
6. Salin ID spreadsheet dari URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

## 2. Konfigurasi lokal

```bash
cp .env.example .env.local   # isi nilainya; .env.local sudah di-.gitignore
npm install
```

Isi `.env.local` dari file JSON: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY` (boleh dengan `\n` literal, bungkus tanda kutip), serta `SPREADSHEET_ID`. Buat `SESSION_SECRET` dengan `openssl rand -base64 48`.

| Env | Default | Arti |
|---|---|---|
| `CONTACTS_SHEET` | `delivery_kitchen` | nama sheet kontak |
| `BATCH_SIZE` | 10 | kontak per jatah |
| `CLAIM_TIMEOUT_MIN` | 60 | klaim kedaluwarsa bila pemegang tak aktif selama ini |
| `PACING_SECONDS_MIN/MAX` | 20 / 60 | jeda acak antar pengiriman |

### Inisialisasi sheet

```bash
npm run init-sheet
```

Menambah kolom `id`, `operator`, `claimed_at` (di kanan, kolom lama tidak diubah), mengisi `id` unik untuk baris yang belum punya, dan membuat sheet `events` + `agents` beserta header. **Idempoten**, aman diulang (mis. setelah menambah kontak baru, jalankan lagi untuk memberi `id`).

### Mengisi sheet `agents`

Buat hash PIN:

```bash
npm run hash-pin -- 1234
```

Tempel hasilnya ke kolom `pin_hash`. Contoh baris:

| name | pin_hash | is_admin | daily_limit | active |
|---|---|---|---|---|
| Ani | `$2b$10$...` | FALSE | 50 | TRUE |
| Imam | `$2b$10$...` | TRUE | 100 | TRUE |

`is_admin` / `active` dianggap benar bila `TRUE`, `1`, `ya`, atau `yes`. Kosong = salah. `daily_limit` kosong/tidak valid = 50. Mengelola agen cukup lewat sheet ini (tanpa UI CRUD); set `active=FALSE` untuk menonaktifkan.

### Menjalankan

```bash
npm run dev      # http://localhost:3000
npm test         # vitest
npm run build
```

Di mode development, terminal mencetak jumlah panggilan Sheets API per request (`[sheets] GET /api/me -> baca=1 tulis=0`).

## 3. Deploy ke Vercel

1. Push ke repo **private**, lalu **Add New → Project** di Vercel dan impor repo.
2. **Settings → Environment Variables**: isi `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID`, `SESSION_SECRET` (dan opsional variabel lain). Untuk `GOOGLE_PRIVATE_KEY`, tempel nilai apa adanya dari JSON (dengan `\n`); aplikasi mengubahnya menjadi baris baru.
3. Deploy. Paket Hobby cukup; tidak ada Vercel Cron (sinkronisasi dipicu oleh request).
4. Di HP, buka URL lalu **Tambah ke Layar Utama** (PWA opsional).

## 4. Cara tes dengan 2 HP

1. Pastikan sheet `agents` punya minimal 2 agen aktif + 1 admin, dan `delivery_kitchen` berisi kontak uji (nomor milik sendiri).
2. HP-A login sebagai agen A, HP-B sebagai agen B. Keduanya tekan **Ambil jatah** *bersamaan*. Pastikan daftar kontak keduanya tidak beririsan (cek di dashboard admin / sheet `events`).
3. Di HP-A: **Buka WhatsApp** → kembali ke aplikasi → muncul *bottom sheet* → **Sudah terkirim**. Hitung mundur pacing muncul sebelum kontak berikutnya.
4. Buka `/admin` di laptop: progres, tabel agen, dan feed harus ikut berubah dalam hitungan detik (maks. 15 dtk); `delivery_kitchen` ikut terisi `manual_claimed` / `manual_sent` setelah sinkronisasi (≤30 dtk).
5. Uji konflik: biarkan satu agen diam > `CLAIM_TIMEOUT_MIN` (atau kecilkan nilainya), agen lain ambil jatah, lalu agen pertama coba menandai terkirim → harus muncul peringatan "Kontak ini sudah diambil agen lain…".
6. Uji **Lepas sisa jatah** dan tombol **Paksa lepas** di admin.

## 5. Kompatibilitas dengan bot Apps Script (WAHA)

- **Nilai kolom `status`** yang dipakai bersama:
  | Nilai | Pemilik | Boleh diklaim agen? |
  |---|---|---|
  | `""` (kosong) | belum diproses | **ya, satu-satunya** |
  | `manual_claimed` | dipegang agen | tidak |
  | `manual_sent` | terkirim manual | tidak |
  | `not_wa` | tidak ada WA / dilewati | tidak |
  | `sent`, `image_ok`, `error: ...` | bot | **tidak, dan tidak pernah ditimpa** |
- **"Bot dari atas, web dari bawah"**: bot mengirim dari baris paling atas; aplikasi mengklaim dari baris paling bawah, sehingga keduanya baru bertemu di tengah.
- **Bot harus membaca ulang status sel tepat sebelum mengirim** dan hanya mengirim bila masih `""`. Ini penutup celah terakhir: aplikasi menulis `manual_claimed` ke sel saat sinkronisasi (≤30 dtk setelah klaim), jadi ada jeda singkat saat sel masih kosong padahal sudah diklaim agen. Pembacaan ulang oleh bot memastikan bot tidak mengambil kontak yang sudah ditulis `manual_claimed`.
- Sebaliknya, bila bot sempat mengambil kontak yang baru diklaim agen, sinkronisasi membatalkan klaim itu (event `release`, catatan "bentrok dengan bot") dan kontak tersebut disembunyikan dari agen. Aplikasi tidak pernah menimpa sel `sent`/`image_ok`/`error...`.
- Kolom baru (`id`, `operator`, `claimed_at`) ditambahkan di kanan; urutan kolom lama tidak berubah. Aplikasi membaca kolom lewat **nama header**.
- Timestamp memakai format `dd/MM/yyyy HH:mm:ss` WIB dan ditulis dengan `valueInputOption=RAW` agar tidak diubah Sheets menjadi tanggal.
- Kontak bertatus `manual_claimed` yang sudah punya riwayat event dan state-nya kembali free (setelah release/kedaluwarsa) boleh diklaim ulang, supaya tidak macet menunggu sinkronisasi.

## 6. Kuota Google Sheets API

Menurut [dokumentasi resmi](https://developers.google.com/workspace/sheets/api/limits): **300 baca/menit/project dan 60 baca/menit/pengguna/project**, tulis sama. Semua request memakai satu service account, jadi batas efektifnya **60 baca dan 60 tulis per menit**. Desain:

- `batchGet` tunggal untuk kontak + events + agents; cache in-memory 10 dtk; pembacaan simultan digabung.
- Satu `append` per aksi agen; satu `batchUpdate` per sinkronisasi (maks 1x/30 dtk per instance).
- Retry exponential backoff + jitter untuk 429/5xx.
- Klien tidak polling: refresh hanya saat aksi dan saat halaman kembali aktif (maks 1x/15 dtk); dashboard admin 15 dtk.
- Sinkronisasi memakai snapshot yang baru saja dibaca request itu (≤3 dtk), bukan baca tambahan.

Simulasi 10 agen selama 10 menit (`tests/quota.test.ts`, setiap agen = instance terpisah tanpa cache bersama, skenario terburuk): **rata-rata ≈ 36 baca/menit, puncak ≤ 59 baca dan ≤ 38 tulis per menit**. Marginnya untuk baca **tipis** di menit-menit awal saat banyak agen mengambil jatah bersamaan; di atas ~10 agen aktif, pertimbangkan menaikkan `PACING_SECONDS_*` atau `BATCH_SIZE`. Bila kuota terlewati, Google membalas 429 dan retry backoff menanganinya.

## 7. Keamanan & privasi

- Cookie sesi `httpOnly`, `sameSite=lax`, `secure` (di production), berlaku 12 jam. Semua endpoint API memeriksa sesi dan peran; input divalidasi zod; POST wajib `application/json`.
- Throttle percobaan login gagal (5x → kunci 10 menit, per IP dan per nama). Disimpan in-memory per instance, sehingga memperlambat brute-force tetapi bukan jaminan mutlak di serverless.
- `noindex`: meta robots, header `X-Robots-Tag`, dan `robots.txt`. Tanpa analytics pihak ketiga.
- Nomor telepon tidak dicetak ke log; nomor hanya dikirim ke agen untuk **kontak yang sedang dipegangnya** (dan baru setelah jeda pacing selesai). `GOOGLE_PRIVATE_KEY` tidak pernah dikirim ke klien.

## 8. Asumsi & catatan

- "Aktivitas pemegang" untuk kedaluwarsa dihitung **global per agen** (event apa pun dari agen itu), bukan per kontak.
- Pacing berlaku untuk "Sudah terkirim" maupun "Tidak ada WA"; jedanya acak tetapi deterministik per (agen, pengiriman terakhir) agar server tetap stateless.
- Batas harian menghitung **terkirim** (bukan lewati); jatah dipotong sesuai sisa batas.
- Event `admin_release` hanya ditulis oleh endpoint admin; reducer mempercayai event itu, jadi akses tulis langsung ke sheet `events` harus dibatasi.
- Poster: ganti `public/poster.jpg` (sekarang placeholder). Link `wa.me` hanya mengisi teks; agen melampirkan poster sendiri.
