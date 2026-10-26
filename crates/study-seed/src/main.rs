//! Fills the application database with sample data if it is empty. `just reset-data` uses it
//! after deleting the development database; `study-seed showcase` writes the showcase sample
//! instead (every file read, no failures), the one the website's screenshots are taken on.

#![allow(clippy::print_stderr)] // A command-line tool: printing is its output.

fn main() -> study_core::Result<()> {
    let path = study_core::db::Database::default_path()?;
    let database = study_core::db::Database::open(&path)?;
    let seeded = if std::env::args().nth(1).as_deref() == Some("showcase") {
        study_seed::showcase(&database)?
    } else {
        study_seed::demo(&database)?
    };
    if seeded {
        eprintln!("seeded {}", path.display());
    } else {
        eprintln!("{} already has projects; left as it is", path.display());
    }
    Ok(())
}
