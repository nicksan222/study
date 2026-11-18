//! Restricts native microphone permission to Study's own main webview.

use tauri::webview::{PermissionKind, PermissionResponse};

fn trusted_origin(url: &url::Url, development: bool) -> bool {
    let bundled =
        url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none();
    let windows = matches!(url.scheme(), "http" | "https")
        && url.host_str() == Some("tauri.localhost")
        && url.port().is_none();
    let local_dev = development
        && url.scheme() == "http"
        && url.host_str() == Some("localhost")
        && url.port() == Some(5173);
    bundled || windows || local_dev
}

pub fn permission<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    kind: PermissionKind,
) -> PermissionResponse {
    if !matches!(kind, PermissionKind::Microphone) {
        return PermissionResponse::Default;
    }
    if webview.label() == "main"
        && webview
            .url()
            .is_ok_and(|url| trusted_origin(&url, cfg!(debug_assertions)))
    {
        // WebKitGTK otherwise denies getUserMedia without prompting. Capture starts
        // only from the explicit dictation action; OS privacy permissions still apply.
        PermissionResponse::Allow
    } else {
        PermissionResponse::Deny
    }
}

#[cfg(test)]
mod tests {
    use super::trusted_origin;

    #[test]
    fn microphone_is_scoped_to_bundled_study_and_the_exact_development_origin() {
        for origin in [
            "tauri://localhost/notes",
            "http://tauri.localhost/",
            "https://tauri.localhost/",
            "http://tauri.localhost:80/",
            "https://tauri.localhost:443/",
        ] {
            let url = url::Url::parse(origin).unwrap();
            assert!(trusted_origin(&url, false));
        }
        let development = url::Url::parse("http://localhost:5173/").unwrap();
        assert!(trusted_origin(&development, true));
        assert!(!trusted_origin(&development, false));
        for origin in [
            "https://example.com/",
            "http://localhost:9999/",
            "http://localhost.evil.example:5173/",
            "tauri://remote/",
            "tauri://localhost:5173/",
            "http://tauri.localhost:5173/",
            "https://tauri.localhost:8443/",
        ] {
            let url = url::Url::parse(origin).unwrap();
            assert!(!trusted_origin(&url, true), "{origin}");
        }
    }
}
