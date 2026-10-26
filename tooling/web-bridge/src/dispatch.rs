//! Byte envelopes are decoded only into generated protobuf messages, then sent over real gRPC.
use study_rpc::{prost::Message, tonic::Status, v1 as p};
pub type Client = study_rpc::LocalClient;
include!(concat!(env!("OUT_DIR"), "/dispatch.rs"));
