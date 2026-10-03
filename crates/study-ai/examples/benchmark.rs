//! Prints a benchmark report of this machine as JSON.

#![allow(clippy::print_stdout)] // A command-line tool: printing is its output.

use study_ai::hardware::{ComputeConfig, run};

fn main() -> study_core::Result<()> {
    let report = run(&ComputeConfig::default())?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
