//! Development-only workspace commands. Never a dependency of the application.
#![allow(clippy::print_stderr)]

mod generate;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

fn main() -> std::process::ExitCode {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let check = match args.as_slice() {
        [command] if command == "generate" => false,
        [command, flag] if command == "generate" && flag == "--check" => true,
        _ => {
            eprintln!("usage: study-dev generate [--check]");
            return std::process::ExitCode::from(2);
        }
    };
    match generate::run(check) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}
