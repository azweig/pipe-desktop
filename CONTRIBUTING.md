# Contributing to Pipe Desktop

Thanks for your interest in improving Pipe Desktop. This is the native ([Tauri](https://tauri.app)) client for the self-hostable [Pipe](https://github.com/azweig/pipe) hub.

## Getting started

```bash
npm install
npm run tauri dev   # native app with hot reload
# or, frontend only in a browser:
npm run dev
```

You'll need Node.js 20 LTS, the Rust toolchain, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS. Point the app at your own running Pipe hub on first launch.

## Before you open a PR

Please make sure these pass locally:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # vite build
npm run lint         # eslint
npm run format:check # prettier --check
npm run test         # vitest run
```

For changes to the Rust bridge, also run:

```bash
cd src-tauri && cargo build && cargo clippy
```

## Style

- TypeScript / React, formatted with Prettier (no semicolons, double quotes, 2-space indent). Run `npm run format:check` and lint before committing.
- Keep pure helpers pure and testable — see `src/lib/format.ts` and its tests as the pattern.
- The lint config is intentionally pragmatic for now (`no-explicit-any` is off, unused vars are warnings). Don't regress it into a wall of errors; tighten incrementally.

## Scope & good first contributions

- UI/UX fixes, accessibility, small features in the React app.
- Additional unit tests for pure helpers.
- Tooling and DX improvements.

## Reporting bugs & requesting features

Open an issue with clear steps to reproduce, your OS, and the app version. For security issues, **do not** open a public issue — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
