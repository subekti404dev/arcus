# Postman Tauri

A lightweight Postman-like API client built with **Tauri + React + TypeScript**, not Electron.

## Features

- HTTP method selector: GET, POST, PUT, PATCH, DELETE
- URL request bar
- Editable headers table
- Import cURL copied from Chrome DevTools or Firefox Network tab
- JSON/body editor
- Response status, timing, headers count, and formatted body viewer
- Local request history in app state
- Native desktop shell powered by Tauri

## Requirements

- Node.js + npm
- Rust toolchain
- Tauri system dependencies for your Linux distro

## Development

```bash
cd /mnt/ssd/Koding/personal/postman-tauri
npm install
npm run tauri:dev
```

## Web-only preview

```bash
npm install
npm run dev
```

## Build desktop app

```bash
npm run tauri:build
```

## Notes

Requests are sent through a Rust/Tauri command using `reqwest` when running as a desktop app. This behaves more like Postman than browser `fetch`, avoids browser-forbidden headers such as `Cookie` and `User-Agent`, and avoids CORS issues. The web-only Vite preview still falls back to browser `fetch`.
