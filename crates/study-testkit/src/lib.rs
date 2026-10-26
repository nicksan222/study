//! Real services for tests, each run in Docker at a version its module pins, so a test
//! checks the contract Study relies on instead of a mock of it.
//!
//! One module per service, each a struct that owns its container (stopped when dropped)
//! and says where to reach it. Tests that need Docker live in a `docker` module, so a
//! machine without Docker skips them all with `--skip docker::`.
//!
//! | Module  | Service                            |
//! |---------|------------------------------------|
//! | [`web`] | nginx serving a directory of pages |

pub mod web;

use testcontainers::core::ContainerPort;
use testcontainers::{ContainerAsync, Image};

/// `http://host:port` for `port` inside `container`.
async fn http_url<I: Image>(container: &ContainerAsync<I>, port: ContainerPort) -> String {
    let host = container.get_host().await.expect("Docker reports the host");
    let port = container
        .get_host_port_ipv4(port)
        .await
        .expect("Docker maps the port");
    format!("http://{host}:{port}")
}
