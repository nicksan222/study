//! Development-only HTTP transport for the production generated Study RPC consumer.
//!
//! Production ships no HTTP listener. The loopback bridge sends every unary call through
//! [`study_rpc::v1::study_client::StudyClient`] to the real tonic service. Browser tests
//! allocate independent fixture databases and servers; deleting a capability releases both.
mod dispatch;
mod fixture;
mod staging;
mod transport;
pub use transport::serve;

use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response, Sse, sse::Event},
    routing::{delete, get, post},
};
use fixture::Session;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use study_rpc::{
    tonic::{Code, Status},
    v1::Empty,
};
use tokio::sync::{Mutex, OwnedRwLockReadGuard, RwLock, Semaphore, watch};

#[derive(Clone)]
struct Bridge {
    sessions: Arc<Mutex<HashMap<String, Lease>>>,
    default: Option<Arc<Session>>,
    root: PathBuf,
    origins: Arc<Vec<String>>,
    capacity: Arc<Semaphore>,
    closing: watch::Sender<bool>,
    operations: Arc<RwLock<()>>,
}
impl Bridge {
    async fn admit(&self) -> Result<OwnedRwLockReadGuard<()>, Failure> {
        if *self.closing.borrow() {
            return Err(Status::unavailable("development bridge is shutting down").into());
        }
        let lease = self.operations.clone().read_owned().await;
        if *self.closing.borrow() {
            return Err(Status::unavailable("development bridge is shutting down").into());
        }
        Ok(lease)
    }
}

struct Lease {
    session: Arc<Session>,
    touched: Instant,
    _permit: tokio::sync::OwnedSemaphorePermit,
}

/// Bridge construction; explicit fixture root keeps cleanup bounded to this run.
pub struct Config {
    pub fixture_root: PathBuf,
    pub data_path: Option<PathBuf>,
    pub origins: Vec<String>,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Options {
    #[serde(default)]
    seed: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Capability {
    pub id: String,
}

struct Failure(Status);
impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let status = match self.0.code() {
            Code::InvalidArgument | Code::OutOfRange => StatusCode::BAD_REQUEST,
            Code::NotFound => StatusCode::NOT_FOUND,
            Code::AlreadyExists | Code::FailedPrecondition | Code::Aborted => StatusCode::CONFLICT,
            Code::PermissionDenied => StatusCode::FORBIDDEN,
            Code::Unauthenticated => StatusCode::UNAUTHORIZED,
            Code::ResourceExhausted => StatusCode::TOO_MANY_REQUESTS,
            Code::Unimplemented => StatusCode::NOT_IMPLEMENTED,
            Code::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            Code::DeadlineExceeded => StatusCode::GATEWAY_TIMEOUT,
            Code::Cancelled => StatusCode::GONE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(serde_json::json!({ "code": self.0.code() as i32, "message": self.0.message(), "details": self.0.details() }))).into_response()
    }
}
impl From<Status> for Failure {
    fn from(status: Status) -> Self {
        Self(status)
    }
}

async fn guard(
    State(bridge): State<Bridge>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if *bridge.closing.borrow() {
        return Failure(Status::unavailable("development bridge is shutting down")).into_response();
    }
    // Never allow an arbitrary website to mutate local state through this dev-only listener.
    if let Some(origin) = request.headers().get(header::ORIGIN)
        && !origin
            .to_str()
            .ok()
            .is_some_and(|origin| bridge.origins.iter().any(|allowed| allowed == origin))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    // Resolve an explicit capability before any Bytes/Json/Multipart extractor can wait
    // on network input. Global-only routes (such as fixture creation) use bridge lifetime.
    let session = if request.headers().contains_key("x-study-session") {
        match selected(&bridge, request.headers()).await {
            Ok(session) => Some(session),
            Err(error) => return error.into_response(),
        }
    } else {
        bridge.default.clone()
    };
    let mut stopped = bridge.closing.subscribe();
    let cancelled_body = Arc::new(AtomicBool::new(false));
    let body_flag = cancelled_body.clone();
    let (parts, body) = request.into_parts();
    let mut incoming = body.into_data_stream();
    let cancel = async move {
        let session_closed = async {
            match session {
                Some(session) => session.cancelled().await,
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! { biased;
            _ = stopped.wait_for(|value| *value) => {},
            _ = session_closed => {},
        }
    };
    let body = Body::from_stream(async_stream::stream! {
        tokio::pin!(cancel);
        loop {
            tokio::select! { biased;
                _ = &mut cancel => {
                    body_flag.store(true, Ordering::Release);
                    yield Err::<Bytes, std::io::Error>(std::io::Error::new(std::io::ErrorKind::Interrupted, "request body revoked"));
                    break;
                }
                part = incoming.next() => match part {
                    Some(Ok(bytes)) => yield Ok(bytes),
                    Some(Err(error)) => { yield Err(std::io::Error::other(error)); break; },
                    None => break,
                }
            }
        }
    });
    let mut response = next
        .run(axum::extract::Request::from_parts(parts, body))
        .await;
    if cancelled_body.load(Ordering::Acquire) {
        response = Failure(Status::cancelled("request body revoked")).into_response();
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "no-store".parse().expect("static header"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        "nosniff".parse().expect("static header"),
    );
    response
}

async fn selected(bridge: &Bridge, headers: &HeaderMap) -> Result<Arc<Session>, Failure> {
    if *bridge.closing.borrow() {
        return Err(Status::unavailable("development bridge is shutting down").into());
    }
    match headers.get("x-study-session") {
        Some(value) => {
            let id = value
                .to_str()
                .map_err(|_| Status::invalid_argument("invalid session header"))?;
            let mut sessions = bridge.sessions.lock().await;
            let lease = sessions
                .get_mut(id)
                .ok_or_else(|| Status::not_found("fixture session expired"))?;
            lease.touched = Instant::now();
            Ok(lease.session.clone())
        }
        None => bridge
            .default
            .clone()
            .ok_or_else(|| Status::failed_precondition("allocate a fixture session first").into()),
    }
}

async fn create(
    State(bridge): State<Bridge>,
    Json(options): Json<Options>,
) -> Result<Json<Capability>, Failure> {
    let _operation = bridge.admit().await?;
    let permit = bridge
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| Status::resource_exhausted("too many fixture sessions"))?;
    if *bridge.closing.borrow() {
        return Err(Status::unavailable("development bridge is shutting down").into());
    }
    let session = Session::fixture(&bridge.root, options.seed).await?;
    let mut sessions = bridge.sessions.lock().await;
    if *bridge.closing.borrow() {
        drop(sessions);
        session.close().await?;
        return Err(Status::unavailable("development bridge is shutting down").into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    sessions.insert(
        id.clone(),
        Lease {
            session,
            touched: Instant::now(),
            _permit: permit,
        },
    );
    Ok(Json(Capability { id }))
}
async fn remove(
    State(bridge): State<Bridge>,
    Path(id): Path<String>,
) -> Result<StatusCode, Failure> {
    let _operation = bridge.admit().await?;
    let lease = bridge.sessions.lock().await.remove(&id);
    match lease {
        Some(lease) => {
            lease.session.close().await?;
            Ok(StatusCode::NO_CONTENT)
        }
        None => Ok(StatusCode::NOT_FOUND),
    }
}
async fn call(
    State(bridge): State<Bridge>,
    Path(method): Path<String>,
    headers: HeaderMap,
    payload: Bytes,
) -> Result<Response, Failure> {
    let _operation = bridge.admit().await?;
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/protobuf")
    {
        return Err(Status::invalid_argument("expected application/protobuf").into());
    }
    let session = selected(&bridge, &headers).await?;
    let output = dispatch::unary(session.client.clone(), &method, &payload, &session).await?;
    Ok(([(header::CONTENT_TYPE, "application/protobuf")], output).into_response())
}
async fn upload(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, Failure> {
    let _operation = bridge.admit().await?;
    let session = selected(&bridge, &headers).await?;
    // Cancelling this complete ingestion future drops its RAII batch before releasing
    // the staging guard, even when next_field/bytes is waiting indefinitely on the client.
    let receive = async {
        let mut files = session.files.lock().await;
        let arena = files
            .as_mut()
            .ok_or_else(|| Status::not_found("fixture session closed"))?;
        let mut batch = Vec::new();
        while let Some(field) = multipart
            .next_field()
            .await
            .map_err(|_| Status::invalid_argument("malformed upload"))?
        {
            if field.name() != Some("files") {
                return Err(Status::invalid_argument("expected files multipart field"));
            }
            let filename = field
                .file_name()
                .ok_or_else(|| Status::invalid_argument("upload needs a filename"))?
                .to_owned();
            let bytes = field
                .bytes()
                .await
                .map_err(|_| Status::invalid_argument("cannot read upload"))?;
            arena.stage(&mut batch, &filename, &bytes).await?;
        }
        if batch.is_empty() {
            return Err(Status::invalid_argument("no files uploaded"));
        }
        let paths = session.commit_upload(arena, batch)?;
        Ok(Json(serde_json::json!({"paths": paths})))
    };
    tokio::select! { biased;
        _ = session.cancelled() => Err(Status::cancelled("fixture session is closing").into()),
        result = receive => result.map_err(Into::into),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReleaseFiles {
    paths: Vec<String>,
}
async fn release_files(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
    Json(input): Json<ReleaseFiles>,
) -> Result<StatusCode, Failure> {
    let _operation = bridge.admit().await?;
    let session = selected(&bridge, &headers).await?;
    if let Some(arena) = session.files.lock().await.as_mut() {
        arena.release(&input.paths);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn events(
    State(bridge): State<Bridge>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Failure> {
    let _operation = bridge.admit().await?;
    let session = selected(&bridge, &headers).await?;
    let mut client = session.client.clone();
    let mut stream = client.subscribe(Empty {}).await?.into_inner();
    Ok(Sse::new(async_stream::stream! {
        // Keep the capability alive until the HTTP stream is dropped.
        let _session = session;
        loop {
            match stream.message().await {
                Ok(Some(event)) => yield Ok::<_, std::convert::Infallible>(Event::default().event("study").json_data(event).expect("protobuf serializes")),
                Ok(None) => break,
                Err(error) => { tracing::debug!(%error, "RPC event stream closed"); break; }
            }
        }
    }).keep_alive(axum::response::sse::KeepAlive::default()))
}

/// Construct the development transport with isolated test capabilities and optional persistent app.
pub struct Application {
    pub router: Router,
    bridge: Bridge,
}
impl Application {
    /// Stop admission and cancel HTTP uploads before waiting for RPC/file leases or Axum.
    pub async fn shutdown(&self) -> Result<(), Status> {
        self.bridge.closing.send_replace(true);
        let leases: Vec<_> = self
            .bridge
            .sessions
            .lock()
            .await
            .drain()
            .map(|(_, lease)| lease)
            .collect();
        // Revoke every capability before draining one, so another stalled body cannot
        // retain its arena while an earlier session finishes admitted backend effects.
        for lease in &leases {
            lease.session.begin_close();
        }
        if let Some(session) = &self.bridge.default {
            session.begin_close();
        }
        for lease in leases {
            lease.session.close().await?;
        }
        if let Some(session) = &self.bridge.default {
            session.close().await?;
        }
        // In-flight fixture creation/removal and accepted RPC handlers finish before
        // transport closure can drop their owned effects or temporary directories.
        let _joined = self.bridge.operations.write().await;
        Ok(())
    }
}

/// Router-only construction for independent HTTP transport tests.
pub async fn router(config: Config) -> Result<Router, Status> {
    Ok(application(config).await?.router)
}

/// Construct a transport plus a shutdown handle for owned development processes.
pub async fn application(config: Config) -> Result<Application, Status> {
    std::fs::create_dir_all(&config.fixture_root)
        .map_err(|_| Status::internal("cannot create fixture root"))?;
    let default = match config.data_path {
        Some(path) => Some(Session::persistent(&path).await?),
        None => None,
    };
    let bridge = Bridge {
        sessions: Arc::default(),
        default,
        root: config.fixture_root,
        origins: Arc::new(config.origins),
        capacity: Arc::new(Semaphore::new(16)),
        closing: watch::channel(false).0,
        operations: Arc::new(RwLock::new(())),
    };
    // Weak ownership lets unused router-only test bridges disappear without a timer lease.
    let sessions = Arc::downgrade(&bridge.sessions);
    let operations = Arc::downgrade(&bridge.operations);
    let closing = bridge.closing.subscribe();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if !expire(&sessions, &operations, &closing, Duration::from_secs(300)).await {
                break;
            }
        }
    });
    let router = Router::new()
        .route("/__study/health", get(|| async { StatusCode::NO_CONTENT }))
        .route("/__study/session", post(create))
        .route("/__study/session/{id}", delete(remove))
        .route("/rpc/__study/session", post(create))
        .route("/rpc/__study/session/{id}", delete(remove))
        .route("/rpc/__study/files", post(upload).delete(release_files))
        .route("/rpc/events", get(events))
        .route("/rpc/{*method}", post(call))
        .layer(DefaultBodyLimit::max(
            study_core::db::MAX_SOURCE_BYTES as usize + 64 * 1024,
        ))
        .layer(middleware::from_fn_with_state(bridge.clone(), guard))
        .with_state(bridge.clone());
    Ok(Application { router, bridge })
}

// The read lease starts BEFORE map removal: shutdown must join cleanup even when the
// session is no longer map-resident. The timer retains only weak bridge ownership.
async fn expire(
    sessions: &std::sync::Weak<Mutex<HashMap<String, Lease>>>,
    operations: &std::sync::Weak<RwLock<()>>,
    closing: &watch::Receiver<bool>,
    minimum_idle: Duration,
) -> bool {
    let (Some(sessions), Some(operations)) = (sessions.upgrade(), operations.upgrade()) else {
        return false;
    };
    if *closing.borrow() {
        return false;
    }
    let _operation = operations.read_owned().await;
    if *closing.borrow() {
        return false;
    }
    let expired = {
        let mut sessions = sessions.lock().await;
        let keys: Vec<_> = sessions
            .iter()
            .filter(|(_, lease)| lease.touched.elapsed() >= minimum_idle)
            .map(|(id, _)| id.clone())
            .collect();
        keys.into_iter()
            .filter_map(|id| sessions.remove(&id))
            .collect::<Vec<_>>()
    };
    for lease in expired {
        if let Err(error) = lease.session.close().await {
            tracing::warn!(%error, "expired fixture cleanup failed");
        }
    }
    true
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[tokio::test]
    async fn shutdown_joins_expiry_after_session_has_left_the_map() {
        let root = tempfile::tempdir().unwrap();
        let application = application(Config {
            fixture_root: root.path().to_owned(),
            data_path: None,
            origins: vec![],
        })
        .await
        .unwrap();
        let session = Session::fixture(root.path(), false).await.unwrap();
        let files = session.files.lock().await;
        application.bridge.sessions.lock().await.insert(
            "expiry-barrier".into(),
            Lease {
                session: session.clone(),
                touched: Instant::now(),
                _permit: application
                    .bridge
                    .capacity
                    .clone()
                    .acquire_owned()
                    .await
                    .unwrap(),
            },
        );
        let sessions = Arc::downgrade(&application.bridge.sessions);
        let operations = Arc::downgrade(&application.bridge.operations);
        let closing = application.bridge.closing.subscribe();
        let expiry =
            tokio::spawn(
                async move { expire(&sessions, &operations, &closing, Duration::ZERO).await },
            );
        tokio::time::timeout(Duration::from_secs(2), async {
            while !application.bridge.sessions.lock().await.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("expiry must remove its capability before draining its held file lease");
        let shutdown = application.shutdown();
        tokio::pin!(shutdown);
        assert!(
            tokio::time::timeout(Duration::from_millis(20), &mut shutdown)
                .await
                .is_err(),
            "shutdown must join expiry-owned cleanup after map removal"
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
        drop(files);
        tokio::time::timeout(Duration::from_secs(2), &mut shutdown)
            .await
            .unwrap()
            .unwrap();
        assert!(expiry.await.unwrap());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        assert!(
            !expire(
                &Arc::downgrade(&application.bridge.sessions),
                &Arc::downgrade(&application.bridge.operations),
                &application.bridge.closing.subscribe(),
                Duration::ZERO
            )
            .await,
            "closed bridge must fence subsequent expiry passes"
        );
    }
}
