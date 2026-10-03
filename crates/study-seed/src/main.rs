//! Fills the application database with sample data if it is empty. `just reset-data` uses it
//! after deleting the development database.

#![allow(clippy::print_stderr)] // A command-line tool: printing is its output.

fn main() -> study_core::Result<()> {
    let path = study_core::db::Database::default_path()?;
    let database = study_core::db::Database::open(&path)?;
    if study_seed::demo(&database)? {
        eprintln!("seeded {}", path.display());
    } else {
        eprintln!("{} already has projects; left as it is", path.display());
    }
    Ok(())
}
