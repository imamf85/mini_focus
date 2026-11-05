const TEMPLATE = `{{greeting}} Dokter {{name}}
📣📣 *It’s time to level up your clinical skills!* 📣📣

✨✨✨ *FKG Universitas Trisakti proudly presents: Mini FOKUS 2026 — Batch II* pada *3–4 Desember 2026* dan *Dental Expo* pada *1–4 Desember 2026* ✨✨✨

*(SKP dalam proses)*

📍 *Kampus B, Fakultas Kedokteran Gigi Universitas Trisakti, Jakarta Barat*

_*Workshop 01*_
*See Better, Shape Better, Seal Better: Workshop Endodontik Berbasis Dental Loupe, Access Opening, Preparasi dengan Endomotor, hingga Sealer-Based Obturation*
Dr. drg. Eko Fibryanto, Sp.KG(K)
📆 Kamis, 3 Desember 2026
🕘 09.00–15.00 WIB
🏷️ Rp1.250.000
👥 Dokter gigi umum dan Spesialis Konservasi Gigi

_*Workshop 02*_
*Molar in Crisis: Mastering Emergency Endodontic in Daily Practice*
drg. Rosita Stefani, MM, Sp.KG & drg. Rachendra Tiara Putri, Sp.KG
📆 Jumat, 4 Desember 2026
🕘 09.00–15.00 WIB
🏷️ Rp1.000.000
👥 Dokter gigi umum dan Spesialis Konservasi Gigi

_*Workshop 03*_
*Diagnosis Ortodontik Komprehensif: Interpretasi Sefalometri Dasar*
Dr. drg. Fajar Hamonangan Nasution, Sp.Ort
📆 Jumat, 4 Desember 2026
🕣 08.30–10.30 WIB
🏷️ Rp750.000
👥 Dokter gigi umum

_*Workshop 04*_
*Cone Beam-CT: Guided Implant Surgery*
drg. Muhammad Novo Perwira Lubis, Sp.RKG, Subsp. RDP(K), FICOI
📆 Jumat, 4 Desember 2026
🕣 08.30–12.00 WIB
🏷️ Rp1.000.000
👥 Dokter gigi umum dan spesialis radiologi kedokteran gigi

_*Workshop 05*_
*Know Your Material, Master Your Restoration From A–Z: Tips & Tricks, Hype or Reality? Understanding Materials for Better Direct & Indirect Composite Restorations*
Dr. drg. Deviyanti Pratiwi, M.Kes & drg. Rosalina Tjandrawinata, M.Si., Ph.D
📆 Jumat, 4 Desember 2026
🕘 09.00–15.00 WIB
🏷️ Rp800.000
👥 Dokter gigi umum

_*Workshop 06*_
*From Chairside to Mass Disasters: Mastering Forensic-grade Odontograms for General Practitioners*
drg. Rizki Tanjung, MM, M.Si, MARS, Sp.OF
📆 Kamis, 3 Desember 2026
🕐 13.00–16.00 WIB
🏷️ Rp400.000
👥 Dokter gigi umum

_*Workshop 07*_
*Oral Lesions in Focus: Bridging Clinical and Pathologic Findings – A Practical Workshop for Everyday Dental Practice*
drg. Firstine Kelsi Hartanto, MClinDent., Sp.PM & drg. Pretty Trisfilha, M.Biomed., Sp.PMM
📆 Kamis, 3 Desember 2026
🕤 09.30–12.00 WIB
🏷️ Rp700.000
👥 Dokter gigi umum, spesialis penyakit mulut, dan spesialis patologi mulut dan maksilofasial

📌 *Peserta wajib memiliki akun Satu Sehat SDMK/Plataran Sehat.*
📲 *Pendaftaran:* scan QR code pada poster.

*Info lebih lanjut:*
08119827102
082172223228
*(WhatsApp text only)*

*Pembayaran dilakukan melalui:*
🏦 BNI HARMONI
No. rekening: *1846472022*
a.n. *SEMINAR ILMIAH FKG USAKTI*

📸 *Instagram:* minifokus.usakti26
✉️ *Email:* minifokusfkgusakti@gmail.com*

Pilih kelas sesuai minat sejawat dan bergabung bersama kami di *Mini FOKUS 2026 Batch II!*

Kami tunggu kehadiran dokter sekalian 🙏🙏`;

export function buildMessage(greeting: string, name: string): string {
  // split/join (bukan replace dengan string) agar "$" pada nama tidak ditafsirkan khusus.
  return TEMPLATE.split("{{greeting}}")
    .join(greeting)
    .split("{{name}}")
    .join(name.trim());
}

export function waLink(phone: string, text?: string): string {
  return text
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${phone}`;
}
