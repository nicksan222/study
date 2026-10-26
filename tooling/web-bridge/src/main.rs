//! Local development entry point. Never included in the packaged desktop application.
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
};
use study_core::{Context as _, Result};
use study_web_bridge::{Config, application, serve};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let mut port = 5201_u16;
    let mut origins = vec![
        "http://127.0.0.1:1420".into(),
        "http://localhost:1420".into(),
        "http://localhost:5173".into(),
        "http://127.0.0.1:5173".into(),
        "http://127.0.0.1:1423".into(),
    ];
    let mut fixture_only = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" => {
                port = args
                    .next()
                    .context("--port needs a value")?
                    .parse()
                    .context("invalid --port")?;
            }
            "--origin" => origins.push(args.next().context("--origin needs a value")?),
            "--fixture-only" => fixture_only = true,
            _ => return Err(study_core::err!("unknown argument {arg}")),
        }
    }
    // TempDir drops even on startup errors; killing a bridge leaves only its private run.
    let root = tempfile::tempdir().context("create fixture arena")?;
    let data_path = if fixture_only {
        None
    } else {
        Some(match std::env::var_os("STUDY_DATA_PATH") {
            Some(path) => PathBuf::from(path),
            None => study_core::db::Database::default_path()?,
        })
    };
    let app = application(Config {
        fixture_root: root.path().to_owned(),
        data_path,
        origins,
    })
    .await
    .context("start HTTP RPC transport")?;
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .context("bind development bridge")?;
    tracing::info!(address = %listener.local_addr().context("read listener address")?, "Study development bridge ready");
    serve(listener, app, shutdown()).await?;
    Ok(())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
