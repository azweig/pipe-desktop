# Pipe Desktop

A native desktop client for [Pipe](https://github.com/azweig/pipe) — the self-hostable unified inbox and AI second brain. Built with [Tauri](https://tauri.app) so it runs as a small native app on macOS, Linux, and Windows instead of a browser tab.

Pipe Desktop is a thin client: it holds **no server of its own**. On first launch you point it at **your own hub** (the URL where you run Pipe) and unlock it with your access PIN. Nothing is hardcoded — your data stays on your hub.

## What it does

- Native window for your Pipe hub: unified inbox, threads, contacts, notes, calendar, search.
- Talks to the hub over a small native bridge (Rust) so requests are same-origin and free of browser CORS friction.
- Local OS notifications, file/media pickers, and drag-and-drop, wired through Tauri plugins.

## Requirements

- [Node.js](https://nodejs.org) 20 LTS
- The [Rust toolchain](https://rustup.rs) (for Tauri)
- Platform build dependencies for Tauri — see the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- A running Pipe hub to connect to

## Setup

```bash
npm install
npm run tauri dev
```

This launches the app in development with hot reload. On first launch, enter your hub URL and PIN.

## Build

```bash
npm run tauri build
```

Produces a native installer/bundle for your platform under `src-tauri/target/release/`.

## Frontend-only development

The UI is a normal Vite + React app. To iterate on the frontend in a browser (the Vite dev server proxies `/api` to a hub on `localhost:3000`):

```bash
npm run dev
```

Other scripts: `npm run build` (Vite build), `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test`.

## Tech stack

- [Tauri 2](https://tauri.app) — native shell + Rust bridge
- [React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev) — build tooling
- Tauri plugins: HTTP, dialog, notification

## Contributing & security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
