# Session Handoff — Arcus

Project directory: `/mnt/ssd/Koding/personal/postman-tauri`

## Goal
Build a sleek API client using Tauri + React + TypeScript, not Electron.

## Current status
The project is implemented and builds successfully.

Run commands:

```bash
cd /mnt/ssd/Koding/personal/postman-tauri
npm run tauri:dev
```

Validate:

```bash
npm run build
cd src-tauri
cargo check
```

## Implemented features
- Tauri v2 + React + TypeScript + Vite app.
- Native Rust HTTP engine via `reqwest` to bypass browser CORS and support desktop-like requests.
- Browser fetch fallback for non-Tauri/Vite preview.
- HTTP methods and URL input.
- Editable headers table.
- Request body editor.
- Body type selector:
  - raw
  - form-data key/value UI
  - x-www-form-urlencoded key/value UI
- Raw JSON body helper features:
  - Format JSON button.
  - Auto format on blur.
  - Auto pair closing for `"`, `'`, `{}`, `[]`, `()`.
  - Skip over existing closing char.
  - Backspace removes empty pair.
- cURL import modal supporting Chrome/Firefox copied cURL.
- Copy as cURL button.
- Response viewer:
  - Preview tab.
  - Raw tab.
  - Collapsible JSON tree for valid JSON.
- Basic request history.
- Collections feature:
  - Add Collection modal.
  - Delete Collection confirmation modal.
  - Save current request.
  - If saved request is loaded, Save button becomes Update and updates same entry instead of creating duplicate.
  - Delete saved request.
  - Active saved request highlight.
- Responsive layout.
- Modern glassmorphism-like styling.
- Tauri native titlebar disabled and custom app-level titlebar added.
- Custom window buttons:
  - minimize
  - maximize/unmaximize
  - close

## Important files
Frontend:
- `src/main.tsx`
- `src/styles.css`
- `src/types.ts`
- `src/curl.ts`
- `src/http.ts`
- `src/JsonTree.tsx`
- `src/storage.ts`
- `src/windowControls.ts`
- `src/vite-env.d.ts`

Tauri/Rust:
- `src-tauri/src/http.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`

## Recent fixes
### Window controls did not work
Fixed by adding Tauri v2 permissions to `src-tauri/capabilities/default.json`:

```json
"core:window:allow-close",
"core:window:allow-minimize",
"core:window:allow-maximize",
"core:window:allow-unmaximize",
"core:window:allow-is-maximized"
```

### Native top bar removed
In `src-tauri/tauri.conf.json`, window config includes:

```json
"decorations": false
```

### AppImage bundling failed
The release build succeeded, but AppImage bundling failed because Tauri tried to download Linux AppImage tooling and network returned:

```txt
No route to host (os error 113)
```

Already built successfully before the AppImage step:
- Binary: `src-tauri/target/release/postman-tauri`
- DEB: `src-tauri/target/release/bundle/deb/Postman Tauri_0.1.0_amd64.deb`
- RPM: `src-tauri/target/release/bundle/rpm/Postman Tauri-0.1.0-1.x86_64.rpm`

If AppImage is not needed, change bundle targets in `src-tauri/tauri.conf.json` from `all` to only `deb` and `rpm`.

## Known limitations / next ideas
- Native Tauri form-data multipart is not fully implemented yet. Current form-data UI works in browser fetch mode using `FormData`, but native Rust command currently does not support true multipart file upload/boundaries.
- Add response headers tab.
- Add auth helpers: Bearer Token, Basic Auth, API Key.
- Add folders inside collections.
- Add tabs for multiple open requests.
- Add environment variables.
- Add import/export collections JSON.
- Add tests for cURL parser.

## Last successful validation
```bash
cd /mnt/ssd/Koding/personal/postman-tauri
npm run build
cd src-tauri
cargo check
```

Both succeeded.
