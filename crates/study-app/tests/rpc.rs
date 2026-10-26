//! Consumer integration tests over real local gRPC, with deterministic fixture preparation.
#[path = "rpc/consumer.rs"]
mod consumer;

#[path = "rpc/lifecycle.rs"]
mod lifecycle;
