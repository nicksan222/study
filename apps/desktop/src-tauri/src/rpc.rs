//! Descriptor-driven binary protobuf adapter for the webview. Every request crosses the
//! canonical gRPC service; this module has no domain dispatch table or database access.

use prost::Message as _;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor, MethodDescriptor};
use serde::Serialize;
#[cfg(test)]
use serde_json::Value;
use tonic::{
    Status,
    codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder},
    transport::Channel,
};

#[derive(Clone, Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub details: Vec<u8>,
    pub message: String,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for RpcError {}

impl From<Status> for RpcError {
    fn from(status: Status) -> Self {
        Self {
            code: status.code() as i32,
            details: status.details().to_vec(),
            message: status.message().to_owned(),
        }
    }
}

impl RpcError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Status::invalid_argument(message.into()).into()
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Status::internal(message.into()).into()
    }
}

#[derive(Clone)]
pub struct RpcClient {
    channel: Channel,
    pool: DescriptorPool,
    token: tonic::metadata::MetadataValue<tonic::metadata::Ascii>,
}

impl RpcClient {
    pub fn new(channel: Channel, token: &str) -> Result<Self, RpcError> {
        let pool = DescriptorPool::decode(study_rpc::DESCRIPTOR_SET)
            .map_err(|_| RpcError::internal("invalid compiled protocol descriptor"))?;
        Ok(Self {
            channel,
            pool,
            token: token
                .parse()
                .map_err(|_| RpcError::internal("invalid private channel token"))?,
        })
    }

    pub(crate) fn method(&self, name: &str) -> Result<MethodDescriptor, RpcError> {
        self.pool
            .services()
            .flat_map(|service| service.methods().collect::<Vec<_>>())
            .find(|method| {
                name == method.name()
                    || name == format!("{}/{}", method.parent_service().full_name(), method.name())
            })
            .ok_or_else(|| RpcError::invalid("unknown RPC method"))
    }

    #[cfg(test)]
    pub async fn call(&self, name: &str, params: Value) -> Result<Value, RpcError> {
        let method = self.method(name)?;
        if method.is_client_streaming() || method.is_server_streaming() {
            return Err(RpcError::invalid(
                "streaming method requires an event subscription",
            ));
        }
        let request = DynamicMessage::deserialize(method.input(), params)
            .map_err(|error| RpcError::invalid(error.to_string()))?;
        let response = self.unary(&method, request).await?;
        serde_json::to_value(response).map_err(|_| RpcError::internal("cannot encode RPC response"))
    }

    pub async fn call_bytes(&self, name: &str, payload: &[u8]) -> Result<Vec<u8>, RpcError> {
        let method = self.method(name)?;
        if method.is_client_streaming() || method.is_server_streaming() {
            return Err(RpcError::invalid(
                "streaming method requires an event subscription",
            ));
        }
        let request = DynamicMessage::decode(method.input(), payload)
            .map_err(|_| RpcError::invalid("malformed protobuf request"))?;
        Ok(self.unary(&method, request).await?.encode_to_vec())
    }

    async fn unary(
        &self,
        method: &MethodDescriptor,
        request: DynamicMessage,
    ) -> Result<DynamicMessage, RpcError> {
        let path = format!("/{}/{}", method.parent_service().full_name(), method.name())
            .parse()
            .map_err(|_| RpcError::internal("invalid compiled RPC path"))?;
        let mut grpc = tonic::client::Grpc::new(self.channel.clone())
            .max_decoding_message_size(study_rpc::MAX_MESSAGE_BYTES)
            .max_encoding_message_size(study_rpc::MAX_MESSAGE_BYTES);
        grpc.ready()
            .await
            .map_err(|_| RpcError::internal("RPC service unavailable"))?;
        let mut request = tonic::Request::new(request);
        request
            .metadata_mut()
            .insert("x-study-token", self.token.clone());
        Ok(grpc
            .unary(request, path, ReflectionCodec(method.output()))
            .await
            .map_err(RpcError::from)?
            .into_inner())
    }

    pub async fn events(&self) -> Result<tonic::Streaming<DynamicMessage>, RpcError> {
        let method = self.method("Subscribe")?;
        let mut request = tonic::Request::new(DynamicMessage::new(method.input()));
        request
            .metadata_mut()
            .insert("x-study-token", self.token.clone());
        let path = format!("/{}/{}", method.parent_service().full_name(), method.name())
            .parse()
            .map_err(|_| RpcError::internal("invalid compiled event path"))?;
        let mut grpc = tonic::client::Grpc::new(self.channel.clone());
        grpc.ready()
            .await
            .map_err(|_| RpcError::internal("RPC service unavailable"))?;
        Ok(grpc
            .server_streaming(request, path, ReflectionCodec(method.output()))
            .await
            .map_err(RpcError::from)?
            .into_inner())
    }
}

struct ReflectionCodec(MessageDescriptor);
struct ReflectionEncoder;
struct ReflectionDecoder(MessageDescriptor);

impl Codec for ReflectionCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = ReflectionEncoder;
    type Decoder = ReflectionDecoder;
    fn encoder(&mut self) -> Self::Encoder {
        ReflectionEncoder
    }
    fn decoder(&mut self) -> Self::Decoder {
        ReflectionDecoder(self.0.clone())
    }
}
impl Encoder for ReflectionEncoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        item.encode(dst)
            .map_err(|_| Status::internal("cannot encode protobuf request"))
    }
}
impl Decoder for ReflectionDecoder {
    type Item = DynamicMessage;
    type Error = Status;
    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        DynamicMessage::decode(self.0.clone(), src)
            .map(Some)
            .map_err(|_| Status::internal("cannot decode protobuf response"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_channel_rejects_wrong_process_identity() {
        let directory = tempfile::tempdir().unwrap();
        let app = study_app::App::open(directory.path().join("study.sqlite3")).unwrap();
        let (_server, mut client) = crate::server::NativeServer::start(app).await.unwrap();
        client.token = "incorrect-process-identity".parse().unwrap();
        let error = client.call_bytes("Projects", &[]).await.unwrap_err();
        assert_eq!(error.code, tonic::Code::Unauthenticated as i32);
    }

    #[tokio::test]
    async fn native_dispatch_accepts_only_current_contract_names() {
        let directory = tempfile::tempdir().unwrap();
        let app = study_app::App::open(directory.path().join("study.sqlite3")).unwrap();
        let (server, client) = crate::server::NativeServer::start(app).await.unwrap();
        let microphone = crate::audio::Microphone::default();
        for name in ["Projects", "study.v1.Study/Projects"] {
            assert!(client.call_bytes(name, &[]).await.is_ok());
            assert!(microphone.rpc(&client, name, &[]).await.is_ok());
        }
        for name in [
            "projects",
            "foreign.Service/Projects",
            "/study.v1.Study/Projects",
        ] {
            assert_eq!(
                client.call_bytes(name, &[]).await.unwrap_err().code,
                tonic::Code::InvalidArgument as i32
            );
            assert_eq!(
                microphone.rpc(&client, name, &[]).await.unwrap_err().code,
                tonic::Code::InvalidArgument as i32
            );
        }
        server.shutdown().await.unwrap();
    }

    #[test]
    fn grpc_error_keeps_classification_and_message() {
        let error = RpcError::from(Status::not_found("source is gone"));
        let payload = serde_json::to_value(error).unwrap();
        assert_eq!(payload["code"], tonic::Code::NotFound as i32);
        assert_eq!(payload["message"], "source is gone");
    }
}
