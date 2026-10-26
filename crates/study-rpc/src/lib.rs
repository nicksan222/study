//! Standalone Study consumer interface. `proto/study/v1/study.proto` is the wire authority.
//! Consumers use the generated [`v1::study_client::StudyClient`] over a channel, never an
//! application implementation. Optional entities use presence, sums use protobuf oneofs,
//! and classified failures carry [`v1::ErrorDetails`] in gRPC status details.

pub mod v1 {
    tonic::include_proto!("study.v1");
}

/// Compiled schema for independent generators and schema-aware bridges.
pub const DESCRIPTOR_SET: &[u8] = tonic::include_file_descriptor_set!("study_descriptor");
/// Full 512 MiB domain source limit plus protobuf envelope headroom. Native consumers
/// should prefer ExportSourceToFile to avoid holding a full export in memory.
pub const MAX_MESSAGE_BYTES: usize = 513 * 1024 * 1024;
pub use prost;
pub use tonic;

/// Decode the stable application classification from a gRPC failure.
pub fn error_details(status: &tonic::Status) -> Option<v1::ErrorDetails> {
    use prost::Message;
    v1::ErrorDetails::decode(status.details())
        .ok()
        .filter(|v| v.kind != 0)
}

/// Connect to a loopback TCP service. Remote binds are deliberately unsupported.
pub async fn connect_tcp(
    address: std::net::SocketAddr,
) -> Result<v1::study_client::StudyClient<tonic::transport::Channel>, tonic::transport::Error> {
    v1::study_client::StudyClient::connect(format!("http://{address}"))
        .await
        .map(|v| {
            v.max_decoding_message_size(MAX_MESSAGE_BYTES)
                .max_encoding_message_size(MAX_MESSAGE_BYTES)
        })
}

/// Connect over a Unix socket. The endpoint authority is a placeholder, never a network target.
#[cfg(unix)]
pub async fn connect_unix(
    path: impl AsRef<std::path::Path>,
) -> Result<v1::study_client::StudyClient<tonic::transport::Channel>, tonic::transport::Error> {
    let path = path.as_ref().to_path_buf();
    let channel = tonic::transport::Endpoint::from_static("http://[::]:50051")
        .connect_with_connector(tower::service_fn(move |_| {
            let path = path.clone();
            async move {
                tokio::net::UnixStream::connect(path)
                    .await
                    .map(hyper_util::rt::TokioIo::new)
            }
        }))
        .await?;
    Ok(v1::study_client::StudyClient::new(channel)
        .max_decoding_message_size(MAX_MESSAGE_BYTES)
        .max_encoding_message_size(MAX_MESSAGE_BYTES))
}

/// Metadata credential for a private local transport. Redacted in debug output.
#[derive(Clone)]
pub struct LocalToken(tonic::metadata::MetadataValue<tonic::metadata::Ascii>);
impl std::fmt::Debug for LocalToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LocalToken([REDACTED])")
    }
}
impl LocalToken {
    pub fn new(value: &str) -> Result<Self, tonic::metadata::errors::InvalidMetadataValue> {
        value.parse().map(Self)
    }
}
impl tonic::service::Interceptor for LocalToken {
    fn call(
        &mut self,
        mut request: tonic::Request<()>,
    ) -> Result<tonic::Request<()>, tonic::Status> {
        request
            .metadata_mut()
            .insert("x-study-token", self.0.clone());
        Ok(request)
    }
}
/// Generated client with transport-only authentication; every domain method remains typed.
pub type LocalClient = v1::study_client::StudyClient<
    tonic::service::interceptor::InterceptedService<tonic::transport::Channel, LocalToken>,
>;
