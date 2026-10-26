//! Own accepted socket I/O through shutdown, including idle clients and incomplete headers.
//! HTTP body cancellation and admitted effects drain first; only then are socket polls revoked.
use crate::Application;
use std::{
    future::Future,
    io,
    net::SocketAddr,
    pin::Pin,
    task::{Context, Poll},
};
use study_core::{Context as _, Result};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::watch,
};

struct Listener {
    socket: TcpListener,
    stopped: watch::Receiver<bool>,
}
struct Connection {
    socket: TcpStream,
    stopped: Pin<Box<dyn Future<Output = ()> + Send>>,
    closing: bool,
}
impl Connection {
    fn stopping(&mut self, cx: &mut Context<'_>) -> bool {
        if !self.closing {
            self.closing = self.stopped.as_mut().poll(cx).is_ready();
        }
        self.closing
    }
}
impl axum::serve::Listener for Listener {
    type Io = Connection;
    type Addr = SocketAddr;
    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        // Reuse Axum's error/backoff handling for TCP accept; retain our own cancellation
        // receiver in every resulting I/O object, before any HTTP header can be parsed.
        let (socket, address) = axum::serve::Listener::accept(&mut self.socket).await;
        let mut stopped = self.stopped.clone();
        (
            Connection {
                socket,
                closing: false,
                stopped: Box::pin(async move {
                    let _ = stopped.wait_for(|value| *value).await;
                }),
            },
            address,
        )
    }
    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.socket.local_addr()
    }
}
impl AsyncRead for Connection {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.stopping(cx) {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "bridge stopped",
            )));
        }
        Pin::new(&mut this.socket).poll_read(cx, buffer)
    }
}
impl AsyncWrite for Connection {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        if this.stopping(cx) {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "bridge stopped",
            )));
        }
        Pin::new(&mut this.socket).poll_write(cx, buffer)
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        if this.stopping(cx) {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "bridge stopped",
            )));
        }
        Pin::new(&mut this.socket).poll_flush(cx)
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().socket).poll_shutdown(cx)
    }
}

/// Serve until shutdown without allowing incomplete request framing to retain connections.
pub async fn serve(
    listener: TcpListener,
    application: Application,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let (stopped, receiver) = watch::channel(false);
    let listener = Listener {
        socket: listener,
        stopped: receiver,
    };
    axum::serve(listener, application.router.clone())
        .with_graceful_shutdown(async move {
            shutdown.await;
            // Request body waits are cancelled at middleware. Accepted handlers and real RPC
            // commits still own their leases and finish before connection I/O is revoked.
            if let Err(error) = application.shutdown().await {
                tracing::error!(%error, "development fixture shutdown failed");
            }
            stopped.send_replace(true);
        })
        .await
        .context("serve development bridge")?;
    Ok(())
}
