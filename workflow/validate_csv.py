#!/usr/bin/env python3
"""
validate_csv.py — Validasi dasar untuk berkas CSV BT-KCH Inventory Monitoring Dashboard.

Tujuan: menangkap kesalahan format/struktur pada CSV hasil export VBA Macro
SEBELUM data tersebut tersedia ke pengguna dashboard, dengan menjalankan
script ini sebagai bagian dari GitHub Actions setiap kali ada push.

Validasi yang dilakukan per berkas:
  1. File harus ada dan tidak kosong (bukan 0 byte).
  2. File harus bisa diparsing sebagai CSV (encoding & delimiter wajar).
  3. Header harus memuat setidaknya satu alias dari setiap kolom wajib
     (mendukung variasi nama kolom yang sama seperti di script.js).
  4. Jumlah baris data (selain header) tidak boleh kosong (0 baris) —
     kecuali secara eksplisit diizinkan untuk berkas tertentu.
  5. Tidak ada baris yang seluruh kolom wajibnya kosong (indikasi baris sampah).

Script ini SENGAJA tidak memvalidasi bisnis logic (misalnya stok negatif
masih valid secara format), karena tujuannya hanya menjaga agar struktur
data tidak rusak sebelum sampai ke proses parsing JavaScript (PapaParse).

Exit code 0 = semua valid. Exit code 1 = ada error yang harus diperbaiki.
"""

import csv
import io
import sys
from pathlib import Path

# ── Konfigurasi: berkas & kolom wajib (alias, case-insensitive) ──
# Selaras dengan alias kolom yang sudah didukung oleh loadCSV()/loadMasterCSV() di script.js
FILES_CONFIG = {
    "data/outgoing.csv": {
        "required_columns": {
            "date":      ["Tanggal Pengambilan", "Tanggal", "Date", "TGL", "tgl"],
            "item_code": ["Kode Item", "Item Code", "Kode"],
            "qty":       ["Qty", "QTY", "qty", "Quantity"],
        },
        "allow_empty": False,
    },
    "data/outgoingexpense.csv": {
        "required_columns": {
            "date":      ["Tanggal Pengambilan", "Tanggal", "Date", "TGL", "tgl"],
            "item_code": ["Kode Item", "Item Code", "Kode"],
            "qty":       ["Qty", "QTY", "qty", "Quantity"],
        },
        # Expense CSV secara historis kadang kosong di periode tertentu — tidak fatal.
        "allow_empty": True,
    },
    "data/datamaster.csv": {
        "required_columns": {
            "item_code": ["New Code", "Kode Item", "Item Code", "Kode"],
            "stock":     ["STOCK", "Stock", "QTY", "Stok"],
        },
        "allow_empty": False,
    },
}

MIN_ROW_DROP_WARN_RATIO = 0.5  # peringatan jika baris berkurang >=50% (informasional, tidak fatal di CI)


def clean_header(name: str) -> str:
    return name.replace("\ufeff", "").strip()


def find_column(headers_lower_map, aliases):
    for alias in aliases:
        if alias.lower() in headers_lower_map:
            return headers_lower_map[alias.lower()]
    return None


def validate_file(relpath: str, config: dict) -> list:
    """Return list of error strings (kosong berarti valid)."""
    errors = []
    path = Path(relpath)

    if not path.exists():
        errors.append(f"[{relpath}] Berkas tidak ditemukan.")
        return errors

    if path.stat().st_size == 0:
        errors.append(f"[{relpath}] Berkas berukuran 0 byte (kosong total).")
        return errors

    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")  # otomatis strip BOM kalau ada
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
            errors.append(f"[{relpath}] PERINGATAN: berkas tidak UTF-8 (fallback latin-1 dipakai). "
                           f"Pastikan macro export menggunakan encoding UTF-8 agar karakter khusus tidak rusak.")
        except Exception as e:
            errors.append(f"[{relpath}] Gagal membaca encoding berkas: {e}")
            return errors

    try:
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
    except csv.Error as e:
        errors.append(f"[{relpath}] Gagal parsing CSV: {e}")
        return errors

    if len(rows) == 0:
        errors.append(f"[{relpath}] Tidak ada baris sama sekali (termasuk header).")
        return errors

    header = [clean_header(h) for h in rows[0]]
    headers_lower_map = {h.lower(): h for h in header if h}

    # Cek kolom wajib (berdasarkan alias)
    missing = []
    for canonical, aliases in config["required_columns"].items():
        found = find_column(headers_lower_map, aliases)
        if not found:
            missing.append(f"{canonical} (alias yang dicari: {', '.join(aliases)})")
    if missing:
        errors.append(f"[{relpath}] Kolom wajib tidak ditemukan di header: {'; '.join(missing)}.")
        # Tidak return langsung — tetap lanjut cek baris data untuk laporan yang lebih lengkap.

    data_rows = [r for r in rows[1:] if any(cell.strip() for cell in r)]  # buang baris benar2 kosong

    if len(data_rows) == 0 and not config["allow_empty"]:
        errors.append(f"[{relpath}] Tidak ada baris data (hanya header). "
                       f"Periksa apakah proses export macro berjalan sebelum file ini di-commit.")

    # Cek baris yang panjang kolomnya tidak konsisten dengan header (indikasi delimiter rusak)
    expected_len = len(header)
    inconsistent = [i + 2 for i, r in enumerate(data_rows) if len(r) != expected_len]  # +2: 1-index + skip header
    if inconsistent:
        sample = ", ".join(str(i) for i in inconsistent[:5])
        more = f" (dan {len(inconsistent) - 5} baris lainnya)" if len(inconsistent) > 5 else ""
        errors.append(f"[{relpath}] {len(inconsistent)} baris memiliki jumlah kolom tidak sesuai header "
                       f"(baris: {sample}{more}). Kemungkinan ada koma/delimiter yang tidak ter-escape.")

    return errors


def main():
    all_errors = []
    summary_lines = []

    for relpath, config in FILES_CONFIG.items():
        errors = validate_file(relpath, config)
        if errors:
            all_errors.extend(errors)
        else:
            path = Path(relpath)
            with path.open(newline="", encoding="utf-8-sig") as f:
                row_count = sum(1 for _ in csv.reader(f)) - 1
            summary_lines.append(f"  - {relpath}: OK ({row_count} baris data)")

    print("=" * 70)
    print("VALIDASI CSV — BT-KCH Inventory Monitoring Dashboard")
    print("=" * 70)

    if summary_lines:
        print("\nBerkas valid:")
        for line in summary_lines:
            print(line)

    if all_errors:
        print("\nDitemukan masalah:")
        for err in all_errors:
            print(f"  ✗ {err}")
        print(f"\nTotal {len(all_errors)} masalah ditemukan. Workflow akan ditandai GAGAL.")
        print("Perbaiki berkas CSV di atas sebelum push diterima, atau hubungi pemilik proses macro.")
        sys.exit(1)
    else:
        print("\nSemua berkas CSV lolos validasi struktur dasar.")
        sys.exit(0)


if __name__ == "__main__":
    main()
