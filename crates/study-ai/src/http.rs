//! The one place Study builds HTTP clients. Clients with the same timeouts and redirect
//! policy are shared, so every provider, download, and page fetch reuses one connection
//! pool per setup.
//!
//! Every client follows up to 10 redirects. A [`public_client`] also refuses a redirect
//! down from `https` to `http`, or onto this computer or its network: a loopback, private,
//! shared (100.64.0.0/10), link-local or unspecified IP address, `localhost` or a name
//! under it. Only the address as written is checked; a public name that resolves to a
//! private address is followed. A redirect that stays at the host and port the request
//! started at may be local, so a local site may redirect within itself; a redirect down to
//! `http` is refused even there.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::net::Ipv4Addr;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use reqwest::redirect::Policy;
use url::{Host, Url};

/// Most redirects one request follows, as reqwest's default policy does.
const MAX_REDIRECTS: usize = 10;

/// How long a client may wait. `None` leaves that wait unbounded.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct Timeouts {
    pub connect: Duration,
    /// For the whole request, response included.
    pub total: Option<Duration>,
    /// Between two reads of the response, for long downloads.
    pub read: Option<Duration>,
}

impl Timeouts {
    /// An API call that must finish within `total`.
    pub(crate) fn api(total: Duration) -> Self {
        Self {
            connect: Duration::from_secs(10),
            total: Some(total),
            read: None,
        }
    }
}

/// Which redirects a client follows.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum Redirects {
    Any,
    PublicOnly,
}

/// The shared client for `timeouts`, following redirects anywhere.
pub(crate) fn client(timeouts: Timeouts) -> Result<reqwest::Client, reqwest::Error> {
    shared(timeouts, Redirects::Any)
}

/// The shared client for `timeouts` that follows redirects only to public addresses, for
/// addresses the user gives.
pub(crate) fn public_client(timeouts: Timeouts) -> Result<reqwest::Client, reqwest::Error> {
    shared(timeouts, Redirects::PublicOnly)
}

#[allow(clippy::disallowed_methods)] // The one place clients are built.
fn shared(timeouts: Timeouts, redirects: Redirects) -> Result<reqwest::Client, reqwest::Error> {
    static CLIENTS: OnceLock<Mutex<HashMap<(Timeouts, Redirects), reqwest::Client>>> =
        OnceLock::new();
    let mut clients = CLIENTS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match clients.entry((timeouts, redirects)) {
        Entry::Occupied(entry) => Ok(entry.get().clone()),
        Entry::Vacant(entry) => {
            let policy = match redirects {
                Redirects::Any => Policy::limited(MAX_REDIRECTS),
                Redirects::PublicOnly => public_only(),
            };
            let mut builder = reqwest::Client::builder()
                .connect_timeout(timeouts.connect)
                .redirect(policy);
            if let Some(total) = timeouts.total {
                builder = builder.timeout(total);
            }
            if let Some(read) = timeouts.read {
                builder = builder.read_timeout(read);
            }
            Ok(entry.insert(builder.build()?).clone())
        }
    }
}

/// Follows up to [`MAX_REDIRECTS`] redirects that [`may_follow`] allows.
fn public_only() -> Policy {
    Policy::custom(|attempt| {
        let previous = attempt.previous();
        if previous.len() > MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        let (Some(typed), Some(last)) = (previous.first(), previous.last()) else {
            return attempt.error("a redirect from nowhere");
        };
        if may_follow(last, typed, attempt.url()) {
            attempt.follow()
        } else {
            attempt.error("a redirect to a local or insecure address")
        }
    })
}

/// Whether a redirect from `previous` to `next` may be followed, for a request that
/// started at `typed`: never down from `https` to `http`, and onto this computer or its
/// network only within `typed`'s own host and port.
fn may_follow(previous: &Url, typed: &Url, next: &Url) -> bool {
    if previous.scheme() == "https" && next.scheme() == "http" {
        return false;
    }
    if next.host() == typed.host() && next.port_or_known_default() == typed.port_or_known_default()
    {
        return true;
    }
    match next.host() {
        Some(Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            name != "localhost" && !name.ends_with(".localhost")
        }
        Some(Host::Ipv4(address)) => is_public_v4(address),
        Some(Host::Ipv6(address)) => match address.to_ipv4_mapped() {
            Some(address) => is_public_v4(address),
            None => {
                !(address.is_loopback()
                    || address.is_unspecified()
                    || address.is_unique_local()
                    || address.is_unicast_link_local())
            }
        },
        None => false,
    }
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    let [first, second, ..] = address.octets();
    // The shared address space, 100.64.0.0/10, which std has no stable check for.
    let shared = first == 100 && second & 0b1100_0000 == 64;
    !(address.is_loopback()
        || address.is_private()
        || shared
        || address.is_link_local()
        || address.is_unspecified())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(address: &str) -> Url {
        Url::parse(address).unwrap()
    }

    /// Whether a page typed as `typed` may go on from itself to `next`.
    fn follows(typed: &str, next: &str) -> bool {
        may_follow(&url(typed), &url(typed), &url(next))
    }

    #[test]
    fn a_redirect_to_a_public_host_is_followed() {
        assert!(follows(
            "https://example.org/a",
            "https://www.example.org/b"
        ));
        assert!(follows("http://example.org/a", "https://example.org/b"));
        assert!(follows("https://example.org/a", "https://93.184.215.14/b"));
        assert!(follows("https://example.org/a", "https://[2606:2800::1]/b"));
    }

    #[test]
    fn a_redirect_from_https_down_to_http_is_refused() {
        assert!(!follows("https://example.org/a", "http://example.org/b"));
        let (typed, secure) = (url("http://example.org/a"), url("https://example.org/b"));
        assert!(!may_follow(&secure, &typed, &url("http://example.org/c")));
    }

    #[test]
    fn a_redirect_onto_this_computer_or_its_network_is_refused() {
        for next in [
            "http://127.0.0.1/",
            "http://127.8.0.1/",
            "http://10.1.2.3/",
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://192.168.1.1/",
            "http://100.64.0.1/",
            "http://100.127.255.255/",
            "http://100.100.100.200/",
            "http://169.254.169.254/",
            "http://0.0.0.0/",
            "http://[::1]/",
            "http://[::]/",
            "http://[fd00::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[::ffff:10.0.0.1]/",
            "http://localhost/",
            "http://LocalHost:8080/",
            "http://a.localhost/",
            "http://localhost./",
        ] {
            assert!(!follows("http://example.org/", next), "{next}");
        }
        assert!(follows("http://example.org/", "http://172.32.0.1/"));
        assert!(follows("http://example.org/", "http://100.128.0.1/"));
        assert!(follows("http://example.org/", "http://100.63.255.255/"));
    }

    #[test]
    fn a_redirect_within_the_typed_host_is_followed_even_when_local() {
        let typed = url("http://127.0.0.1:8080/start");
        let hop = url("http://127.0.0.1:8080/moved");
        assert!(may_follow(
            &typed,
            &typed,
            &url("http://127.0.0.1:8080/other")
        ));
        assert!(may_follow(
            &hop,
            &typed,
            &url("http://127.0.0.1:8080/other")
        ));
        assert!(!may_follow(
            &typed,
            &typed,
            &url("http://127.0.0.1:9090/other")
        ));
        assert!(!may_follow(
            &typed,
            &typed,
            &url("http://localhost:8080/other")
        ));
    }
}
