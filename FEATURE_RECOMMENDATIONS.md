# Rekomendasi Fitur untuk Arcus

Dokumen ini berisi rekomendasi fitur yang cocok diimplementasikan berikutnya untuk aplikasi Postman-like berbasis Tauri + React + TypeScript.

## Prioritas Tinggi

### 1. Response Headers Tab

Tambahkan tab khusus untuk melihat response headers.

**Alasan:**
- Sangat penting untuk debugging API.
- Membantu melihat `content-type`, `set-cookie`, `cache-control`, rate limit headers, dan auth-related headers.
- Relatif mudah karena native Rust HTTP engine kemungkinan sudah bisa mengembalikan headers dari `reqwest`.

**Ide UI:**
- Di response panel, tambahkan tab:
  - `Preview`
  - `Raw`
  - `Headers`
- Tampilkan sebagai table key/value.
- Tambahkan tombol copy headers.

---

### 2. Auth Helpers

Tambahkan tab/section `Auth` untuk generate header authorization secara otomatis.

**Jenis auth yang direkomendasikan:**
- Bearer Token
- Basic Auth
- API Key
  - lewat header
  - lewat query params

**Alasan:**
- Fitur inti API client.
- Mengurangi kebutuhan user menulis header manual.
- Bisa diintegrasikan dengan environment variables di masa depan.

**Catatan implementasi:**
- Bearer Token menghasilkan:
  ```http
  Authorization: Bearer <token>
  ```
- Basic Auth menghasilkan:
  ```http
  Authorization: Basic base64(username:password)
  ```
- API Key bisa ditambahkan sebagai header atau query parameter.

---

### 3. Environment Variables

Tambahkan environment variables seperti di Postman.

**Contoh penggunaan:**

```txt
{{base_url}}/users/{{user_id}}
```

**Fitur minimal:**
- Buat environment.
- Tambah/edit/delete variable.
- Pilih active environment.
- Replace variable di URL, headers, dan body sebelum request dikirim.

**Alasan:**
- Sangat berguna untuk berpindah antara local, staging, dan production.
- Akan meningkatkan produktivitas user secara signifikan.

**Contoh environment:**

```json
{
  "name": "Local",
  "variables": {
    "base_url": "http://localhost:3000",
    "token": "dev-token"
  }
}
```

---

### 4. Import/Export Collections JSON

Tambahkan fitur export/import collections ke file JSON lokal.

**Alasan:**
- User bisa backup collection.
- Mudah share request antar device/developer.
- Penting untuk aplikasi desktop standalone.

**Fitur minimal:**
- Export semua collections ke `.json`.
- Import dari `.json`.
- Validasi schema sederhana saat import.
- Confirmation jika import akan merge atau replace data lama.

**Ide format:**

```json
{
  "version": 1,
  "collections": []
}
```

---

## Prioritas Menengah

### 5. Folders di dalam Collections

Tambahkan struktur folder untuk saved requests.

**Alasan:**
- Collection akan sulit dikelola jika request sudah banyak.
- Mirip workflow Postman/Insomnia.

**Fitur minimal:**
- Create folder.
- Rename folder.
- Delete folder.
- Save request ke folder tertentu.
- Drag/drop request bisa menjadi enhancement berikutnya.

---

### 6. Multi Tabs untuk Request

Tambahkan kemampuan membuka beberapa request sekaligus dalam tab.

**Alasan:**
- User sering membandingkan atau mengerjakan banyak endpoint sekaligus.
- UX akan terasa lebih seperti API client desktop modern.

**Fitur minimal:**
- Tombol `+` untuk tab baru.
- Close tab.
- Dirty state indicator jika request belum disimpan.
- Load saved request ke tab baru atau tab aktif.

---

### 7. Native Multipart Form-Data Support

Implementasikan dukungan multipart/form-data di Rust HTTP engine.

**Alasan:**
- Saat ini form-data native Tauri belum fully implemented.
- Dibutuhkan untuk upload file dan endpoint yang menerima multipart.

**Fitur minimal:**
- Key/value text fields.
- File picker untuk field file.
- Kirim multipart via `reqwest::multipart`.

**Catatan:**
- Perlu desain tipe data request body dari frontend ke Rust.
- File path dari Tauri harus diproses secara aman.

---

### 8. Query Params Editor

Tambahkan UI khusus query params, bukan hanya mengetik manual di URL.

**Alasan:**
- Lebih mudah menambah/menghapus query parameter.
- Membantu encode value secara benar.

**Fitur minimal:**
- Table key/value/enabled.
- Sinkronisasi dengan URL.
- Jika URL sudah punya query params, parse otomatis ke table.

---

## Prioritas Rendah / Enhancement

### 9. Request Timing Breakdown

Tampilkan informasi timing request.

**Contoh:**
- Total duration.
- DNS lookup.
- TCP connect.
- TLS handshake.
- Time to first byte.
- Download time.

**Catatan:**
- `reqwest` tidak langsung memberi semua breakdown detail seperti browser devtools.
- Bisa mulai dari total duration dulu.

---

### 10. Code Snippet Generator

Generate contoh request dalam berbagai bahasa.

**Target awal:**
- cURL
- JavaScript `fetch`
- Node.js `axios`
- Python `requests`

**Alasan:**
- Berguna untuk developer yang ingin copy request ke codebase.
- Sudah ada fitur Copy as cURL, jadi bisa diperluas.

---

### 11. Request Tests / Assertions

Tambahkan script sederhana untuk validasi response.

**Contoh assertion:**
- Status code harus 200.
- Response JSON punya field tertentu.
- Header tertentu harus ada.

**Alternatif aman:**
- Jangan langsung menjalankan JavaScript arbitrary.
- Mulai dengan UI assertion builder sederhana.

---

### 12. Global Settings

Tambahkan halaman settings.

**Opsi yang berguna:**
- Theme: system/light/dark.
- Request timeout default.
- Follow redirects on/off.
- Verify TLS certificate on/off untuk development.
- Max history entries.
- Clear history.

---

## Rekomendasi Urutan Implementasi

Urutan yang paling masuk akal:

1. Response Headers Tab
2. Auth Helpers
3. Query Params Editor
4. Environment Variables
5. Import/Export Collections JSON
6. Native Multipart Form-Data Support
7. Folders di Collections
8. Multi Tabs
9. Code Snippet Generator
10. Request Tests / Assertions

## Quick Wins

Jika ingin fitur yang cepat terlihat hasilnya:

- Response headers tab.
- Copy response body button.
- Clear history button.
- Duplicate saved request.
- Rename saved request.
- Search/filter collections.
- Status badge warna:
  - 2xx hijau
  - 3xx biru
  - 4xx kuning/oranye
  - 5xx merah

## Fitur yang Paling Bernilai untuk MVP+

Untuk menjadikan aplikasi ini terasa jauh lebih lengkap, fokus pada:

1. Auth Helpers
2. Environment Variables
3. Import/Export Collections
4. Response Headers
5. Native Multipart Form-Data

Kelima fitur ini akan membuat aplikasi lebih praktis digunakan untuk workflow API development sehari-hari.
