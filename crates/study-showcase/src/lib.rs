//! Capture entry point for the production React frontend on isolated real RPC fixtures.
//!
//! [`run`] delegates to the `just demo` and `just docs-media` recipes, which uses the same browser transport,
//! generated gRPC client and components as consumer E2E. Capture scenes and translations
//! live beside those tests, never in a second desktop implementation. The shared native
//! desktop and the user's development database are untouched.

use std::{path::Path, process::Command};
use study_core::{Context as _, Result};

/// Record the README demo, or `docs [scene|language-theme|missing ...]` for website media.
pub fn run() -> Result<()> {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut args = std::env::args_os().skip(1).peekable();
    let recipe = if args.peek().is_some_and(|arg| arg == "docs") {
        args.next();
        "docs-media"
    } else {
        "demo"
    };
    let status = Command::new("just")
        .arg(recipe)
        .args(args)
        .current_dir(repo)
        .status()
        .context("start browser capture consumer")?;
    if !status.success() {
        return Err(study_core::err!(
            "browser capture consumer exited with {status}"
        ));
    }
    Ok(())
}
