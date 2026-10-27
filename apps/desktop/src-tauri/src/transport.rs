//! Private backend discovery for the shared web client.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct NativeError {
    pub code: String,
    pub message: String,
}
impl NativeError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "internal".into(),
            message: message.into(),
        }
    }
}

/// The browser client connects directly to the private loopback service.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    base_url: String,
}

#[derive(Clone)]
pub struct Client {
    pub url: String,
}
impl Client {
    pub fn new(url: String) -> Self {
        Self { url }
    }
    pub fn connection(&self) -> Connection {
        Connection {
            base_url: self.url.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_returns_only_the_loopback_url() {
        let client = Client::new("http://127.0.0.1:4321".into());
        assert_eq!(
            serde_json::to_value(client.connection()).unwrap(),
            serde_json::json!({ "baseUrl": "http://127.0.0.1:4321" })
        );
    }
}
