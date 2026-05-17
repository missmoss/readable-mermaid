# Security Notes

## Intended operating model

- local-only rendering
- no remote API calls in the render path
- system-installed browser only
- pinned runtime dependency versions

## Browser behavior

The renderer uses a locally installed Chrome-compatible browser binary, blocks external `http:` and `https:` requests while rendering, and launches with a temporary `user-data-dir` plus reduced background/browser-service flags.

## Input handling

The CLI reads Mermaid source only from paths inside the current working directory and writes `SVG` and `PNG` outputs only to `./dist/` inside that same working directory.

Unsupported diagram types and unsupported Mermaid sequence syntax fail fast with explicit non-zero exit codes instead of being silently ignored.

## Supply chain posture

- direct runtime dependencies are intentionally kept small
- package contents are restricted with a `files` allowlist
- lockfile-based installs are supported for repeatable review
