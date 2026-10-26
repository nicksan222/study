//! Headless local Study gRPC service for native development and independent consumers.
//! Explicit database path and readiness file prevent accidental use of a user's real data.
use std::{
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
};
use study_app::{
    App,
    rpc::{Service, serve_tcp},
};
use study_core::{Context, ErrorKind, Result, err};

struct Args {
    database: PathBuf,
    ready: PathBuf,
    address: SocketAddr,
    unix_socket: Option<PathBuf>,
    test: bool,
}
fn args() -> Result<Args> {
    let mut database = None;
    let mut ready = None;
    let mut address = SocketAddr::from((Ipv4Addr::LOCALHOST, 0));
    let mut unix_socket = None;
    let mut test = false;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--data-path" => {
                database = Some(PathBuf::from(args.next().ok_or_else(|| {
                    err!(ErrorKind::InvalidInput, "--data-path needs a file")
                })?))
            }
            "--ready-file" => {
                ready = Some(PathBuf::from(args.next().ok_or_else(|| {
                    err!(ErrorKind::InvalidInput, "--ready-file needs a path")
                })?))
            }
            "--listen" => {
                address = args
                    .next()
                    .ok_or_else(|| err!(ErrorKind::InvalidInput, "--listen needs an address"))?
                    .parse()
                    .map_err(|_| err!(ErrorKind::InvalidInput, "invalid listen address"))?
            }
            "--unix-socket" => {
                unix_socket = Some(PathBuf::from(args.next().ok_or_else(|| {
                    err!(ErrorKind::InvalidInput, "--unix-socket needs a path")
                })?))
            }
            "--test-mode" => test = true,
            _ => {
                return Err(err!(
                    ErrorKind::InvalidInput,
                    "unknown service option {flag}"
                ));
            }
        }
    }
    if !address.ip().is_loopback() {
        return Err(err!(ErrorKind::Config, "service address must be loopback"));
    }
    Ok(Args {
        database: database
            .ok_or_else(|| err!(ErrorKind::InvalidInput, "--data-path is required"))?,
        ready: ready.ok_or_else(|| err!(ErrorKind::InvalidInput, "--ready-file is required"))?,
        address,
        unix_socket,
        test,
    })
}
async fn stopped() {
    #[cfg(unix)]
    {
        if let Ok(mut term) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
fn readiness(
    path: &std::path::Path,
    transport: &str,
    address: &str,
    test: bool,
    token: &str,
) -> Result<()> {
    if let Some(parent) = path.parent().filter(|v| !v.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&temp)?;
    serde_json::to_writer(file,&serde_json::json!({"transport":transport,"address":address,"protocolVersion":1,"testMode":test,"token":token})).context("cannot write readiness")?;
    std::fs::rename(temp, path)?;
    tracing::info!(transport, address, test_mode = test, "Study RPC ready");
    Ok(())
}
async fn run() -> Result<()> {
    let args = args()?;
    // A stale readiness file must not make a failed launch appear healthy.
    match std::fs::remove_file(&args.ready) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let path = args.database.clone();
    let test = args.test;
    let app = tokio::task::spawn_blocking(move || -> Result<App> {
        if let Some(parent) = path.parent().filter(|v| !v.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let app = App::open(path)?;
        app.projects()?;
        if test {
            app.turn_off_search_model();
        } else {
            app.start_workers()?;
        }
        Ok(app)
    })
    .await??;
    let token = uuid::Uuid::new_v4().to_string();
    let service = if args.test {
        Service::test(app)
    } else {
        Service::new(app)
    }
    .with_token(token.clone());
    if let Some(path) = args.unix_socket {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(parent) = path.parent().filter(|v| !v.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)?;
            }
            // Bind fails on existing paths: never unlink another running service's socket.
            let listener = tokio::net::UnixListener::bind(&path)?;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
            readiness(
                &args.ready,
                "unix",
                &path.to_string_lossy(),
                args.test,
                &token,
            )?;
            let result = study_app::rpc::serve_unix(listener, service, stopped()).await;
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::remove_file(&args.ready);
            return result;
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            return Err(err!(ErrorKind::Unsupported, "Unix sockets are unavailable"));
        }
    }
    let listener = tokio::net::TcpListener::bind(args.address).await?;
    readiness(
        &args.ready,
        "tcp",
        &listener.local_addr()?.to_string(),
        args.test,
        &token,
    )?;
    let result = serve_tcp(listener, service, stopped()).await;
    let _ = std::fs::remove_file(&args.ready);
    result
}
#[tokio::main]
async fn main() -> std::process::ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();
    match run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = format!("{error:#}"), "Study RPC stopped");
            std::process::ExitCode::FAILURE
        }
    }
}
