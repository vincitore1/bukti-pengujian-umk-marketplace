================================================================================
REPOSITORI BUKTI PENGUJIAN EMPIRIS & VALIDASI SISTEM
PENGEMBANGAN MARKETPLACE BERBASIS WEB UNTUK KOMUNITAS KAMPUS UNIVERSITAS MURIA KUDUS
Target Publikasi: Jurnal Sistem Informasi dan Informatika (JUSIM)
Penulis: Mukhammadd Irkham
================================================================================

Folder ini memuat seluruh bukti fisik empiris, log mutasi basis data, tangkapan
layar antarmuka pengguna, rekaman eksekusi pengujian otomatis, serta data mentah
yang digunakan untuk menjawab catatan revisi Dewan Reviewer JUSIM.

Struktur Repositori:
--------------------------------------------------------------------------------
1. [uji_101/]
   Memuat berkas 'Rekapitulasi_Lengkap_101_Test_Cases.xlsx' yang mendokumentasikan
   secara mendalam seluruh 101 kasus uji black-box pada 6 modul sistem dengan
   tingkat kelulusan 100% (101 PASS, 0 FAIL, 0 BLOCKED).

2. [log_pengujian_mentah/]
   Memuat berkas log mentah (.log) yang merekam jejak audit mutasi basis data:
   - 'manual_a04_db_mutation.log': Mutasi siklus hidup akun mahasiswa (@std.umk.ac.id)
     dari PENDING_VERIFICATION ke ACTIVE dan pembersihan OTP otomatis (PURGED).
   - 'L02_webhook_midtrans.log': Rekaman verifikasi signature HMAC-SHA512,
     perubahan status pembayaran (PAID), pemotongan stok, dan uji idempotensi.
   - 'L05_concurrency_50_iterations.log': Hasil pengujian beban 50 iterasi serentak
     yang membuktikan tidak terjadinya race condition (double stock decrement).

3. [Screenshot_pengujian/]
   Tangkapan layar resolusi tinggi sebagai bukti visual otentik:
   - [otp/]: Alur verifikasi OTP email Brevo, validasi kode kedaluwarsa,
     cooldown rate-limiting 60 detik, dan dasbor profil mahasiswa aktif.
   - [screenshot_midtrans/]: Dasbor Midtrans Sandbox yang menampilkan transaksi
     berstatus Settlement atas nama akun mahasiswa UMK (202351149@std.umk.ac.id).
   - [webhook_midtrans/]: Terminal eksekusi pengujian webhook berstatus PASS.
   - 'Konkurensi 50 Iterasi.png': Ringkasan hasil uji konkurensi (50 PASS, 0 FAIL).

4. [Skrip_Pengujian/]
   Skrip otomasi pengujian independen berbasis Node.js & TypeScript:
   - 'test_a04_a08_otp.ts': Skrip uji otomatis klaster OTP (A04–A08).
   - 'test_l02_webhook.ts': Skrip uji otomatis webhook settlement dan idempotensi.
   - 'test_l05_concurrency.ts': Skrip uji beban konkurensi konfirmasi serentak (L05).

5. [data_sus/]
   Memuat data kuesioner respon pengguna System Usability Scale (SUS)
   'kuesioner (Jawaban).xlsx'.

================================================================================
Catatan: Pengujian dijalankan pada lingkungan basis data terisolasi (isolated
sandbox environment) untuk menjamin objektivitas, integritas data, dan
keterulangan (reproducibility) pengujian ilmiah.
================================================================================
