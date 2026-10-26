//! Private authenticated local gRPC lifecycle, shared by the native UI and its audio sink.
use crate::rpc::RpcClient;
use study_app::{
    App,
    rpc::{Lifecycle, Service},
};
use tonic::transport::Endpoint;

pub struct NativeServer {
    task: std::sync::Mutex<Option<tokio::task::JoinHandle<study_core::Result<()>>>>,
    lifecycle: Lifecycle,
    _directory: Option<tempfile::TempDir>,
}
impl Drop for NativeServer {
    fn drop(&mut self) {
        // The shared transport observes this synchronously, closes admission, and owns
        // draining accepted connections and already-admitted commits after the UI drops.
        self.lifecycle.stop();
    }
}
impl NativeServer {
    pub async fn start(app: App) -> Result<(Self, RpcClient), Box<dyn std::error::Error>> {
        let token = uuid::Uuid::new_v4().to_string();
        let service = Service::new(app).with_token(token.clone());
        let lifecycle = service.lifecycle();
        #[cfg(unix)]
        {
            let directory = tempfile::Builder::new().prefix("study-native-").tempdir()?;
            let path = directory.path().join("rpc.sock");
            let listener = tokio::net::UnixListener::bind(&path)?;
            let task = tokio::spawn(study_app::rpc::serve_unix(
                listener,
                service,
                std::future::pending(),
            ));
            let channel = Endpoint::from_static("http://[::]:50051")
                .connect_with_connector(tower::service_fn(move |_| {
                    let path = path.clone();
                    async move {
                        tokio::net::UnixStream::connect(path)
                            .await
                            .map(hyper_util::rt::TokioIo::new)
                    }
                }))
                .await?;
            let client = RpcClient::new(channel, &token)?;
            Ok((
                Self {
                    task: std::sync::Mutex::new(Some(task)),
                    lifecycle,
                    _directory: Some(directory),
                },
                client,
            ))
        }
        #[cfg(not(unix))]
        {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
            let address = listener.local_addr()?;
            let task = tokio::spawn(study_app::rpc::serve_tcp(
                listener,
                service,
                std::future::pending(),
            ));
            let channel = Endpoint::from_shared(format!("http://{address}"))?
                .connect()
                .await?;
            let client = RpcClient::new(channel, &token)?;
            Ok((
                Self {
                    task: std::sync::Mutex::new(Some(task)),
                    lifecycle,
                    _directory: None,
                },
                client,
            ))
        }
    }

    pub fn lifecycle(&self) -> Lifecycle {
        self.lifecycle.clone()
    }

    pub async fn shutdown(&self) -> study_core::Result<()> {
        self.lifecycle.stop();
        let task = self.task.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(task) = task {
            task.await
                .map_err(|_| study_core::err!("native RPC server stopped unexpectedly"))??;
        }
        self.lifecycle.drain().await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use study_rpc::{prost::Message, v1 as p};

    #[tokio::test]
    async fn native_consumer_round_trip_and_recording_persist_through_grpc() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("study.sqlite3");
        let app = App::open(&path).unwrap();
        let (server, client) = NativeServer::start(app.clone()).await.unwrap();
        let payload = p::CreateProjectRequest {
            name: "Biology".into(),
        }
        .encode_to_vec();
        let bytes = client
            .call_bytes("study.v1.Study/CreateProject", &payload)
            .await
            .unwrap();
        let project = p::Project::decode(bytes.as_slice()).unwrap();
        assert_eq!(project.name, "Biology");
        assert_eq!(app.projects().unwrap().len(), 1);
        let session = app
            .create_session(
                study_core::ProjectId::new(project.id.unwrap().value),
                "Lecture",
            )
            .unwrap();
        let recording = app.create_recording(session.id).unwrap();
        client
            .call(
                "AppendRecording",
                json!({"id":{"value":recording.id.get().to_string()},"samples":[-32768,0,32767]}),
            )
            .await
            .unwrap();
        assert_eq!(app.recording(recording.id).unwrap().unwrap().samples, 3);
        assert!(client.call_bytes("MissingMethod", &[]).await.is_err());
        assert!(client.call_bytes("CreateProject", &[255]).await.is_err());
        let error = client
            .call("Source", json!({"value":"-1"}))
            .await
            .unwrap_err();
        assert_eq!(error.code, tonic::Code::InvalidArgument as i32);
        let mut events = client.events().await.unwrap();
        assert!(events.message().await.unwrap().is_some());
        server.shutdown().await.unwrap();
        assert!(events.message().await.unwrap().is_none());
        assert!(client.call_bytes("CreateProject", &payload).await.is_err());
        assert_eq!(app.projects().unwrap().len(), 1);
    }
}
