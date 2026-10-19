# Place Finder

Web statis untuk mencari tempat di dalam area yang digambar di peta. Data dari OpenStreetMap (Overpass API), tanpa API key.

## Menjalankan
```bash
python3 -m http.server 8000
```
Buka http://localhost:8000, gambar area (polygon, kotak, atau lingkaran), pilih kategori, klik **Cari tempat**. Hasil bisa diunduh sebagai CSV atau GeoJSON.

## Catatan
- Area maksimal 500 km² per pencarian (server Overpass publik dipakai bersama).
- Rating dan ulasan tidak tersedia di OSM; telepon, website, dan jam buka hanya ada jika kontributor mengisinya.
- Data © OpenStreetMap contributors, lisensi ODbL.
