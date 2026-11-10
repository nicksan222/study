//! Exercises the actual updater HTTP client, signature verification and isolated installation.
//! Fixtures use a disposable `tauri signer generate` key and `tauri signer sign --app-version 99.0.0`;
//! only the public key is retained. The payloads are inert and are never executed.
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use tauri_plugin_updater::UpdaterExt as _;

#[cfg(not(target_os = "macos"))]
const PAYLOAD: &[u8] = include_bytes!("../tests/fixtures/updater/payload.AppImage");
const PUBLIC_KEY: &str = include_str!("../tests/fixtures/updater/public.key");
#[cfg(not(target_os = "macos"))]
const SIGNATURE: &str = include_str!("../tests/fixtures/updater/payload.AppImage.sig");

#[cfg(target_os = "macos")]
const PAYLOAD: &[u8] = include_bytes!("../tests/fixtures/updater/Study.app.tar.gz");
#[cfg(target_os = "macos")]
const SIGNATURE: &str = include_str!("../tests/fixtures/updater/Study.app.tar.gz.sig");

// Binding a loopback socket and serving bytes is intentional: no HTTP or updater mock is used.
fn serve(responses: Vec<Vec<u8>>) -> (String, std::thread::JoinHandle<()>, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let served = requests.clone();
    let server = std::thread::spawn(move || {
        for response in responses {
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "updater never requested fixture");
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("fixture server: {error}"),
                }
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(&mut socket);
            loop {
                let mut line = String::new();
                assert!(reader.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
            }
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                response.len()
            )
            .unwrap();
            served.fetch_add(1, Ordering::SeqCst);
            socket.write_all(&response).unwrap();
        }
    });
    (format!("http://{address}"), server, requests)
}

#[test]
fn signed_update_downloads_installs_and_rejects_tampering() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({ "pubkey": PUBLIC_KEY.trim() }),
    );
    let app = tauri::test::mock_builder()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(PUBLIC_KEY.trim())
                .build(),
        )
        .build(context)
        .unwrap();
    let directory = tempfile::tempdir().unwrap();
    #[cfg(not(target_os = "macos"))]
    let installed = directory.path().join("Study.AppImage");
    #[cfg(target_os = "macos")]
    let installed = directory.path().join("Study.app/Contents/MacOS/study");
    std::fs::create_dir_all(installed.parent().unwrap()).unwrap();
    std::fs::write(&installed, b"original installed app").unwrap();
    // The manifest needs the server address before it can be served.
    let (download_url, download_server, downloads) =
        serve(vec![PAYLOAD.to_vec(), b"tampered artifact".to_vec()]);
    let manifest = serde_json::json!({
        "version": "99.0.0",
        "platforms": { "test-target": {
            "url": format!("{download_url}/payload.AppImage"), "signature": SIGNATURE.trim()
        }}
    });
    let (endpoint, manifest_server, _) = serve(vec![manifest.to_string().into_bytes()]);
    let updater = app
        .updater_builder()
        .target("test-target")
        .executable_path(&installed)
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .endpoints(vec![endpoint.parse().unwrap()])
        .unwrap()
        .build()
        .unwrap();
    tauri::async_runtime::block_on(async {
        let update = updater
            .check()
            .await
            .unwrap()
            .expect("newer signed release");
        assert_eq!(update.version, "99.0.0");
        assert_eq!(
            downloads.load(Ordering::SeqCst),
            0,
            "checking must not download"
        );
        assert!(super::verify_announced_version(&update.version, "98.0.0").is_err());
        assert_eq!(
            std::fs::read(&installed).unwrap(),
            b"original installed app"
        );
        let downloaded = update.download(|_, _| {}, || {}).await.unwrap();
        assert_eq!(downloaded, PAYLOAD);
        assert_eq!(downloads.load(Ordering::SeqCst), 1);
        assert!(
            update.download(|_, _| {}, || {}).await.is_err(),
            "tampering must fail verification"
        );
        assert!(update.install(b"tampered artifact").is_err());
        assert_eq!(
            std::fs::read(&installed).unwrap(),
            b"original installed app"
        );
        // Only the temporary fixture is replaced; the running app is never touched.
        #[cfg(target_os = "macos")]
        {
            update.install(downloaded).unwrap();
            assert_eq!(std::fs::read(&installed).unwrap(), b"updated installed app");
        }
        #[cfg(target_os = "linux")]
        {
            update.install(downloaded).unwrap();
            assert_eq!(std::fs::read(&installed).unwrap(), PAYLOAD);
        }
    });
    manifest_server.join().unwrap();
    download_server.join().unwrap();
}
