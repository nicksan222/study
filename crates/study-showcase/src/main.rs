#![allow(clippy::print_stdout, clippy::print_stderr)] // A command-line tool: printing is its output.

#[tokio::main(flavor = "current_thread")]
async fn main() -> study_core::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.as_slice() {
        [command, source, destination] if command == "convert" => {
            let output = study_showcase::convert(source.as_ref(), destination.as_ref()).await?;
            println!(
                "Prepared {} ({} bytes). Inspect it before attaching.",
                output.display(),
                std::fs::metadata(&output)?.len()
            );
            Ok(())
        }
        [command, ..] if command == "convert" => Err(study_core::err!(
            "usage: study-showcase convert INPUT OUTPUT"
        )),
        _ => study_showcase::run(),
    }
}
