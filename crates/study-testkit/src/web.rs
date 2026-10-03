//! [`Site`]: a directory of files served over HTTP by nginx in Docker.

use std::path::Path;

use testcontainers::core::{IntoContainerPort as _, WaitFor};
use testcontainers::runners::AsyncRunner as _;
use testcontainers::{ContainerAsync, GenericImage, ImageExt as _};

const IMAGE: &str = "nginx";
const VERSION: &str = "1.29.1-alpine";
const PORT: u16 = 80;
const ROOT: &str = "/srv/site";

/// nginx serving a directory until dropped.
pub struct Site {
    base_url: String,
    _container: ContainerAsync<GenericImage>,
}

impl Site {
    /// Serves the files under `root`, typed by extension and declared UTF-8, where each
    /// `(from, to)` in `redirects` answers `301 Moved Permanently` from path `from` to `to`.
    pub async fn serve(root: &Path, redirects: &[(&str, &str)]) -> Self {
        let redirects: String = redirects
            .iter()
            .map(|(from, to)| format!("    location = {from} {{ return 301 {to}; }}\n"))
            .collect();
        // `absolute_redirect off` keeps `Location` relative: nginx would otherwise name its
        // port inside the container, not the one Docker maps on the host.
        let config = format!(
            "server {{\n    listen {PORT};\n    root {ROOT};\n    charset utf-8;\n    \
             absolute_redirect off;\n{redirects}}}\n"
        );
        let container = GenericImage::new(IMAGE, VERSION)
            .with_exposed_port(PORT.tcp())
            .with_wait_for(WaitFor::message_on_stderr("start worker process"))
            .with_copy_to("/etc/nginx/conf.d/default.conf", config.into_bytes())
            .with_copy_to(ROOT, root)
            .start()
            .await
            .expect("Docker runs nginx");
        Self {
            base_url: crate::http_url(&container, PORT.tcp()).await,
            _container: container,
        }
    }

    /// The address of `path`, such as `/lectures/cells.html`.
    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
    }
}
