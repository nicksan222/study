---
name: desktop-ui
description: Use when adding, moving or reviewing desktop pages, GPUI Kit controls, view state, interactions or styling in Study.
---

# Desktop UI

- The shell is `apps/desktop/src/ui/screens/shell/page.rs`; each route lives in
  `shell/page/pages/<route>/page.rs`, with its own pieces in `components/`. Pieces more than
  one page draws go in `pages/components/`; GPUI components with no data go in
  `crates/study-ui`.
- `mod.rs` only declares modules and re-exports; types, impls and tests live in named files.
- Check the API of the `gpui-kit` version pinned in `Cargo.toml` before copying a snippet;
  generic GPUI examples are often out of date.
- Keep behaviour that needs no window in `features/` or a lower crate, tested headless. Every
  string comes from `study-localization`.
- When moving code, keep element ids, copy, callbacks and state transitions as they were.
