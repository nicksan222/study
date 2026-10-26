//! Owned HTTP/2 transport: both connections and Hyper stream tasks belong to Lifecycle.
use super::{Lifecycle, Service, lifecycle::Executor};
use crate::App;
use hyper_util::{rt::TokioIo, service::TowerToHyperService};
use std::{future::Future, net::SocketAddr};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpListener,
};

/// Abort/drop of the accepting future still closes admission and all accepted sockets.
struct Serving(Lifecycle);
impl Drop for Serving {
    fn drop(&mut self) {
        self.0.force_close();
    }
}
fn connection<IO: AsyncRead + AsyncWrite + Unpin + Send + 'static>(io: IO, service: Service) {
    let lifecycle = service.lifecycle();
    let builder = hyper::server::conn::http2::Builder::new(Executor(lifecycle.clone()));
    let task_lifecycle = lifecycle.clone();
    lifecycle.spawn_io(async move {
        let connection=builder.serve_connection(TokioIo::new(io),TowerToHyperService::new(service.server()));
        tokio::pin!(connection);
        tokio::select! {
            result=&mut connection=>{if let Err(error)=result {tracing::debug!(%error,"RPC connection ended");}},
            _=task_lifecycle.cancelled()=>{
                connection.as_mut().graceful_shutdown();
                let _=connection.await;
            }
        }
    });
}
/// Serve only authenticated loopback TCP. Shutdown owns all connections and stream tasks,
/// including clients that never complete a unary request body.
pub async fn serve_tcp(
    listener: TcpListener,
    service: Service,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> study_core::Result<()> {
    if !listener.local_addr()?.ip().is_loopback() {
        return Err(study_core::err!(
            study_core::ErrorKind::Config,
            "RPC TCP listener must be loopback"
        ));
    }
    if service.token.as_ref().is_none_or(|token| token.len() < 32) {
        return Err(study_core::err!(
            study_core::ErrorKind::Config,
            "RPC TCP listener requires a private credential"
        ));
    }
    let lifecycle = service.lifecycle();
    let _serving = Serving(lifecycle.clone());
    tokio::pin!(shutdown);
    let result = loop {
        tokio::select! {biased;
            _=lifecycle.cancelled()=>break Ok(()),
            _=&mut shutdown=>break Ok(()),
            accepted=listener.accept()=>match accepted {Ok((io,_))=>connection(io,service.clone()),Err(error)=>break Err(error.into())},
        }
    };
    drop(listener);
    lifecycle.drain().await;
    result
}
/// Unix socket equivalent; caller owns socket permissions and path cleanup. with_token
/// can be used with the same x-study-token metadata as TCP, without a separate interceptor.
#[cfg(unix)]
pub async fn serve_unix(
    listener: tokio::net::UnixListener,
    service: Service,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> study_core::Result<()> {
    let lifecycle = service.lifecycle();
    let _serving = Serving(lifecycle.clone());
    tokio::pin!(shutdown);
    let result = loop {
        tokio::select! {biased;
            _=lifecycle.cancelled()=>break Ok(()),
            _=&mut shutdown=>break Ok(()),
            accepted=listener.accept()=>match accepted {Ok((io,_))=>connection(io,service.clone()),Err(error)=>break Err(error.into())},
        }
    };
    drop(listener);
    lifecycle.drain().await;
    result
}
/// A native consumer's embedded service. The consumer still uses a generated client over
/// real loopback gRPC. Dropping it signals graceful shutdown; no hidden global runtime.
pub struct Embedded {
    address: SocketAddr,
    token: String,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    lifecycle: super::Lifecycle,
    task: Option<tokio::task::JoinHandle<study_core::Result<()>>>,
}
impl Embedded {
    pub async fn start(app: App, test_mode: bool) -> study_core::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let (shutdown, stopped) = tokio::sync::oneshot::channel();
        let service = if test_mode {
            Service::test(app)
        } else {
            Service::new(app)
        };
        let token = uuid::Uuid::new_v4().to_string();
        let service = service.with_token(token.clone());
        let lifecycle = service.lifecycle();
        let task = tokio::spawn(serve_tcp(listener, service, async move {
            let _ = stopped.await;
        }));
        Ok(Self {
            address,
            token,
            lifecycle,
            shutdown: Some(shutdown),
            task: Some(task),
        })
    }
    pub fn address(&self) -> SocketAddr {
        self.address
    }
    pub fn token(&self) -> &str {
        &self.token
    }
    pub async fn client(&self) -> Result<study_rpc::LocalClient, tonic::transport::Error> {
        let channel = tonic::transport::Endpoint::from_shared(format!("http://{}", self.address))?
            .connect()
            .await?;
        Ok(study_rpc::v1::study_client::StudyClient::with_interceptor(
            channel,
            study_rpc::LocalToken::new(&self.token).expect("UUID is valid metadata"),
        )
        .max_decoding_message_size(study_rpc::MAX_MESSAGE_BYTES)
        .max_encoding_message_size(study_rpc::MAX_MESSAGE_BYTES))
    }
    /// Stop admission, close all accepted streams, and join admitted commits.
    pub async fn shutdown(mut self) -> study_core::Result<()> {
        self.lifecycle.stop();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(task) = self.task.take() {
            task.await
                .map_err(|_| study_core::err!("RPC server task failed"))??;
        }
        self.lifecycle.drain().await;
        Ok(())
    }
}
impl Drop for Embedded {
    fn drop(&mut self) {
        self.lifecycle.stop();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}
