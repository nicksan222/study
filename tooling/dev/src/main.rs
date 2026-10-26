//! Development-only workspace commands. Never a dependency of the application.
#![allow(clippy::print_stderr)]

mod desktop;
mod generate;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let result = match args.as_slice() {
        [command] if command == "generate" => generate::run(false).map(|()| true),
        [command, flag] if command == "generate" && flag == "--check" => {
            generate::run(true).map(|()| true)
        }
        [command, rest @ ..] if command == "desktop" => desktop::run(rest).await,
        _ => {
            eprintln!("usage: study-dev {{generate [--check]|desktop ...}}");
            return std::process::ExitCode::from(2);
        }
    };
    match result {
        Ok(true) => std::process::ExitCode::SUCCESS,
        Ok(false) => std::process::ExitCode::FAILURE,
        Err(error) => {
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}
