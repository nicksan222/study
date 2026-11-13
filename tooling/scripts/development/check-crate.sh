#!/usr/bin/env bash
set -euo pipefail
export CARGO_TARGET_DIR=target/devcontainer
cargo fmt -p "$1" -- --check
cargo clippy --locked -p "$1" --all-targets -- -D warnings
cargo test --locked -p "$1" --all-targets
cargo test --locked -p "$1" --doc
RUSTDOCFLAGS="-D warnings" cargo doc --locked -p "$1" --no-deps --document-private-items
