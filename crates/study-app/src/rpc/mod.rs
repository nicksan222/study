//! Generated gRPC service over the existing [`crate::App`]. The standalone `study-rpc`
//! protobuf schema owns the consumer contract. Database work stays on the blocking pool;
//! clients receive persisted facts and refresh hints, never an application handle.
//! [`Embedded`] gives native consumers the same real transport as headless consumers.

mod convert;
mod lifecycle;
mod operations;
mod signin;
pub use lifecycle::{Lifecycle, Pause};
mod service;
mod settings;
mod transport;

use prost::Message;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use study_core::{ErrorKind, Result as AppResult};
use study_rpc::v1 as p;
use tonic::{Code, Status};
#[cfg(unix)]
pub use transport::serve_unix;
pub use transport::{Embedded, serve_tcp};

/// Backend implementation of the generated service. Clones share subscriptions and login attempts.
#[derive(Clone)]
pub struct Service {
    app: crate::App,
    test_mode: bool,
    token: Option<String>,
    refresh: tokio::sync::broadcast::Sender<()>,
    lifecycle: Lifecycle,
    sign_ins: Arc<Mutex<HashMap<String, signin::Attempt>>>,
    sign_in_start: Arc<tokio::sync::Mutex<()>>,
}
impl Service {
    /// Production adapter. Worker startup is explicit, via App or StartWorkers.
    pub fn new(app: crate::App) -> Self {
        Self {
            app,
            test_mode: false,
            token: None,
            refresh: tokio::sync::broadcast::channel(256).0,
            lifecycle: Lifecycle::default(),
            sign_ins: Arc::new(Mutex::new(HashMap::new())),
            sign_in_start: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
    /// Require a process-private bearer credential when using an exposed local listener.
    /// A native shell may instead authenticate its Unix listener with its own interceptor.
    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token);
        self
    }
    pub fn lifecycle(&self) -> Lifecycle {
        self.lifecycle.clone()
    }
    fn authorize<T>(&self, request: &tonic::Request<T>) -> Result<(), Status> {
        self.lifecycle.check_admission()?;
        if let Some(expected) = &self.token {
            let actual = request
                .metadata()
                .get("x-study-token")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            // Compare all bytes without a prefix-dependent early exit.
            let different = actual
                .as_bytes()
                .iter()
                .zip(expected.as_bytes())
                .fold(actual.len() ^ expected.len(), |v, (a, b)| {
                    v | usize::from(a ^ b)
                });
            if different != 0 {
                return Err(classified(ErrorKind::Auth, "local RPC credential required"));
            }
        }
        Ok(())
    }
    /// Deterministic consumer adapter, without workers or network/model side effects.
    pub fn test(app: crate::App) -> Self {
        app.turn_off_search_model();
        Self {
            test_mode: true,
            ..Self::new(app)
        }
    }
    /// The generated tonic service, suitable for Unix sockets or loopback TCP.
    pub fn server(self) -> p::study_server::StudyServer<Self> {
        p::study_server::StudyServer::new(self)
            .max_decoding_message_size(study_rpc::MAX_MESSAGE_BYTES)
            .max_encoding_message_size(study_rpc::MAX_MESSAGE_BYTES)
    }
    async fn run<T: Send + 'static>(
        &self,
        mutation: bool,
        f: impl FnOnce(Self) -> Result<T, Status> + Send + 'static,
    ) -> Result<tonic::Response<T>, Status> {
        let guard = self.lifecycle.admit()?;
        let service = self.clone();
        let value = tokio::task::spawn_blocking(move || {
            let _guard = guard;
            service.lifecycle.check()?;
            f(service)
        })
        .await
        .map_err(|_| classified(ErrorKind::Internal, "RPC task failed"))??;
        if mutation {
            let _ = self.refresh.send(());
        }
        Ok(tonic::Response::new(value))
    }
    /// Own async App work even if the HTTP request disappears while an internal blocking
    /// write has started. Lifecycle::drain joins it rather than abandoning that write.
    async fn async_work<T: Send + 'static>(
        &self,
        f: impl Future<Output = Result<T, Status>> + Send + 'static,
    ) -> Result<T, Status> {
        let guard = self.lifecycle.admit()?;
        let lifecycle = self.lifecycle.clone();
        tokio::spawn(async move {
            let _guard = guard;
            lifecycle.check()?;
            f.await
        })
        .await
        .map_err(|_| classified(ErrorKind::Internal, "RPC task failed"))?
    }
    fn workers(&self) -> Result<(), Status> {
        if self.app.workers_running() {
            Ok(())
        } else {
            Err(classified(
                ErrorKind::Config,
                "background work has not started",
            ))
        }
    }
    fn production(&self) -> Result<(), Status> {
        if self.test_mode {
            Err(classified(
                ErrorKind::Config,
                "operation disabled in test mode",
            ))
        } else {
            Ok(())
        }
    }
    fn refreshed<T>(&self, value: T) -> tonic::Response<T> {
        let _ = self.refresh.send(());
        tonic::Response::new(value)
    }
}
fn classified(kind: ErrorKind, message: impl Into<String>) -> Status {
    let message = message.into();
    let code = match kind {
        ErrorKind::Transient => Code::Unavailable,
        ErrorKind::RateLimited => Code::ResourceExhausted,
        ErrorKind::Auth => Code::Unauthenticated,
        ErrorKind::Config | ErrorKind::ModelUnavailable | ErrorKind::NotEnough => {
            Code::FailedPrecondition
        }
        ErrorKind::Unsupported => Code::Unimplemented,
        ErrorKind::InvalidInput => Code::InvalidArgument,
        ErrorKind::NotFound => Code::NotFound,
        ErrorKind::Cancelled => Code::Cancelled,
        ErrorKind::Internal => Code::Internal,
    };
    let details = p::ErrorDetails {
        kind: p::ErrorKind::from_domain(kind) as i32,
        message: message.clone(),
        retry_after_ms: None,
    };
    Status::with_details(code, message, details.encode_to_vec().into())
}
fn status(error: study_core::Error) -> Status {
    use study_core::Classify;
    let retry_after = error.retry_after();
    let mut status = classified(error.kind(), format!("{error:#}"));
    if let Some(retry) = retry_after {
        let details = p::ErrorDetails {
            kind: p::ErrorKind::from_domain(error.kind()) as i32,
            message: format!("{error:#}"),
            retry_after_ms: Some(retry.as_millis().min(u128::from(u64::MAX)) as u64),
        };
        status = Status::with_details(
            status.code(),
            status.message(),
            details.encode_to_vec().into(),
        );
    }
    status
}
fn invalid(message: &str) -> Status {
    classified(ErrorKind::InvalidInput, message)
}
fn required<T>(value: Option<T>, name: &str) -> Result<T, Status> {
    value.ok_or_else(|| invalid(&format!("{name} is required")))
}
fn enumeration<P, D>(value: i32) -> Result<D, Status>
where
    P: TryFrom<i32>,
    D: FromWire<P, Error = Status>,
{
    D::from_wire(P::try_from(value).map_err(|_| invalid("unknown enum value"))?)
}
fn copies(value: u32) -> Result<study_ai::stt::ModelCopies, Status> {
    u8::try_from(value)
        .ok()
        .and_then(study_ai::stt::ModelCopies::new)
        .ok_or_else(|| invalid("model instances out of range"))
}
fn local_model(value: i32) -> Result<crate::LocalModel, Status> {
    match p::LocalModel::try_from(value) {
        Ok(p::LocalModel::Transcription) => Ok(crate::LocalModel::Transcription),
        Ok(p::LocalModel::Search) => Ok(crate::LocalModel::Search),
        _ => Err(invalid("model is required")),
    }
}
fn limit(value: u64) -> Result<usize, Status> {
    if value > 100_000 {
        return Err(invalid("limit exceeds 100000"));
    }
    usize::try_from(value).map_err(|_| invalid("limit out of range"))
}
fn ordinal(value: u64) -> Result<usize, Status> {
    usize::try_from(value).map_err(|_| invalid("index out of range"))
}
fn outcome<T>(value: AppResult<T>) -> Result<T, Status> {
    value.map_err(status)
}
macro_rules! ids {
    ($($name:ident => $read:ident),* $(,)?)=>{$(
        fn $read(value:p::$name)->Result<study_core::$name,Status> {
            if value.value<=0 {return Err(invalid(concat!(stringify!($name)," must be positive")));}
            Ok(study_core::$name::new(value.value))
        }
    )*};
}
ids! {ProjectId=>project,SourceId=>source,SessionId=>session,MessageId=>message,PartId=>part,VersionId=>version,JobId=>job,RecordingId=>recording,ArtifactId=>artifact,CardId=>card,PracticeId=>practice,QuestionId=>question}

/// Adapter-local conversions keep the standalone wire crate independent of domain crates.
trait FromDomain<T> {
    fn from_domain(value: T) -> Self;
}
trait IntoWire<T> {
    fn wire(self) -> T;
}
impl<T, U: FromDomain<T>> IntoWire<U> for T {
    fn wire(self) -> U {
        U::from_domain(self)
    }
}
trait FromWire<T>: Sized {
    type Error;
    fn from_wire(value: T) -> Result<Self, Self::Error>;
}
trait IntoDomain<T: FromWire<Self>>: Sized {
    fn domain(self) -> Result<T, T::Error>;
}
impl<T, U: FromWire<T>> IntoDomain<U> for T {
    fn domain(self) -> Result<U, U::Error> {
        U::from_wire(self)
    }
}

impl Service {
    /// Persist user input in a dormant test service through the same database transaction
    /// and readable-source policy as App::post. Queued work stays durable until production
    /// workers resume it; tests never need a model or a synthetic running job engine.
    fn post_dormant(
        &self,
        place: study_core::db::Place,
        parts: &[study_core::db::NewPart],
    ) -> AppResult<study_core::db::ChatMessage> {
        let message = self.app.queue_reads(|database, readable| {
            database.post_message(place, study_core::db::MessageRole::User, parts, readable)
        })?;
        self.app
            .bus()
            .publish(study_core::db::MessageEvent::Posted {
                session_id: message.session_id,
                thread_root: message.thread_root,
                message_id: message.id,
            });
        Ok(message)
    }
}
