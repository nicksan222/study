//! Native-owned microphone lifecycle. UI routes only observe it; the actor joins and
//! posts once, retains failures and keeps terminal events until explicit acknowledgement.
use crate::{
    recorder::{Ended, Recorder},
    rpc::{RpcClient, RpcError},
};
use chrono::{Datelike, Timelike};
use prost::Message as _;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use study_core::{ProjectId, RecordingId, Result, SessionId};
use study_rpc::v1 as p;

#[derive(Clone)]
pub struct Recording {
    pub(crate) id: RecordingId,
    pub(crate) session_id: SessionId,
    pub(crate) samples: u64,
    started_at: i64,
}
#[derive(Clone)]
pub struct AudioSink {
    client: RpcClient,
    runtime: tokio::runtime::Handle,
}
impl AudioSink {
    fn new(client: RpcClient) -> Self {
        Self {
            client,
            runtime: tokio::runtime::Handle::current(),
        }
    }
    async fn call<Q: prost::Message, R: prost::Message + Default>(
        &self,
        method: &str,
        request: Q,
    ) -> std::result::Result<R, RpcError> {
        let bytes = self
            .client
            .call_bytes(method, &request.encode_to_vec())
            .await?;
        R::decode(bytes.as_slice()).map_err(|_| RpcError::internal("invalid recording response"))
    }
    async fn get(&self, id: RecordingId) -> std::result::Result<Option<Recording>, RpcError> {
        let r: p::OptionalRecording = self
            .call("Recording", p::RecordingId { value: id.get() })
            .await?;
        r.value
            .map(|r| {
                Ok(Recording {
                    id,
                    session_id: SessionId::new(
                        r.session_id
                            .ok_or_else(|| RpcError::internal("recording has no session"))?
                            .value,
                    ),
                    samples: r.samples,
                    started_at: r.started_at,
                })
            })
            .transpose()
    }
    pub fn append_recording(&self, id: RecordingId, samples: &[i16]) -> Result<()> {
        self.runtime
            .block_on(self.call::<_, p::Empty>(
                "AppendRecording",
                p::AppendRecordingRequest {
                    id: Some(p::RecordingId { value: id.get() }),
                    samples: samples.iter().map(|&v| i32::from(v)).collect(),
                },
            ))
            .map_err(|e| study_core::Error::msg(e.message))?;
        Ok(())
    }
    async fn project(&self, session: SessionId) -> std::result::Result<ProjectId, RpcError> {
        let r: p::OptionalChatSession = self
            .call(
                "Session",
                p::SessionId {
                    value: session.get(),
                },
            )
            .await?;
        r.value
            .and_then(|v| v.project_id)
            .map(|p| ProjectId::new(p.value))
            .ok_or_else(|| RpcError::invalid("recording session is gone"))
    }
    async fn delete(&self, id: RecordingId) -> std::result::Result<(), RpcError> {
        self.call::<_, p::BoolResult>("DeleteRecording", p::RecordingId { value: id.get() })
            .await?;
        Ok(())
    }
    async fn post(&self, recording: &Recording) -> std::result::Result<bool, RpcError> {
        let Some(saved) = self.get(recording.id).await? else {
            return Ok(false);
        };
        if saved.samples == 0 {
            self.delete(saved.id).await?;
            return Ok(false);
        }
        let settings: p::AppSettings = self.call("GetAppSettings", p::Empty {}).await?;
        let locale = if settings.language == p::Language::Italian as i32 {
            study_localization::Locale::Italian
        } else {
            study_localization::Locale::English
        };
        let at = chrono::DateTime::from_timestamp(saved.started_at, 0)
            .unwrap_or_default()
            .with_timezone(&chrono::Local);
        let day = study_core::Day::new(at.year(), at.month(), at.day())
            .ok_or_else(|| RpcError::internal("invalid recording date"))?;
        let name = study_localization::recording_file_name(locale, day, (at.hour(), at.minute()));
        self.call::<_, p::ChatMessage>(
            "PostRecording",
            p::PostRecordingRequest {
                session: Some(p::SessionId {
                    value: saved.session_id.get(),
                }),
                recording: Some(p::RecordingId {
                    value: saved.id.get(),
                }),
                name,
            },
        )
        .await?;
        Ok(true)
    }
}
#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Idle,
    Starting,
    Live,
    Stopping,
    Posting,
    Sending,
    Discarding,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Posted,
    Empty,
    Full,
    Failed,
    SaveFailed,
    MicrophoneFailed,
    Discarded,
}
#[derive(Clone, Default)]
struct Owner {
    recording: Option<RecordingId>,
    session: Option<SessionId>,
    project: Option<ProjectId>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEvent {
    id: String,
    kind: Outcome,
    recording_id: Option<String>,
    session_id: Option<String>,
    project_id: Option<String>,
    diagnostic: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    revision: String,
    phase: Phase,
    recording_id: Option<String>,
    session_id: Option<String>,
    project_id: Option<String>,
    seconds: u64,
    level: f32,
    ended: bool,
    events: Vec<RecordingEvent>,
}
#[derive(Default)]
struct State {
    revision: u64,
    phase: Phase,
    owner: Owner,
    seconds: u64,
    level: f32,
    stop: bool,
    closing: bool,
    installing: bool,
    events: Vec<RecordingEvent>,
    next_event: u64,
}
type Factory = Arc<dyn Fn(AudioSink, &Recording) -> Result<Recorder> + Send + Sync>;
struct Inner {
    state: Mutex<State>,
    gate: Arc<tokio::sync::Mutex<()>>,
    changed: tokio::sync::watch::Sender<u64>,
    factory: Factory,
}
#[derive(Clone)]
pub struct Microphone(Arc<Inner>);
impl Default for Microphone {
    fn default() -> Self {
        Self::with_factory(Arc::new(Recorder::start))
    }
}
impl Microphone {
    fn with_factory(factory: Factory) -> Self {
        Self(Arc::new(Inner {
            state: Mutex::new(State::default()),
            gate: Arc::new(tokio::sync::Mutex::new(())),
            changed: tokio::sync::watch::channel(0).0,
            factory,
        }))
    }
    /// Atomic with capture/send/discard reservation; an installer never stops live audio.
    pub fn reserve_install(&self) -> std::result::Result<InstallReservation, RpcError> {
        let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
        if state.closing || state.installing || state.phase != Phase::Idle {
            return Err(RpcError::invalid("recording operation in progress"));
        }
        state.installing = true;
        Ok(InstallReservation(self.clone()))
    }
    fn change(&self, f: impl FnOnce(&mut State)) {
        {
            let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
            f(&mut state);
            state.revision += 1;
        }
        self.0.changed.send_modify(|v| *v = v.wrapping_add(1));
    }
    pub fn status(&self) -> RecordingStatus {
        let s = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
        RecordingStatus {
            revision: s.revision.to_string(),
            phase: s.phase,
            recording_id: s.owner.recording.map(|id| id.to_string()),
            session_id: s.owner.session.map(|id| id.to_string()),
            project_id: s.owner.project.map(|id| id.to_string()),
            seconds: s.seconds,
            level: s.level,
            ended: s.phase == Phase::Idle,
            events: s.events.clone(),
        }
    }
    fn reserve(&self, phase: Phase, owner: Owner) -> std::result::Result<(), RpcError> {
        let mut state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
        if state.closing || state.installing || state.phase != Phase::Idle {
            return Err(RpcError::invalid("microphone operation in progress"));
        }
        state.revision += 1;
        state.phase = phase;
        state.owner = owner;
        state.stop = false;
        state.seconds = 0;
        state.level = 0.;
        drop(state);
        self.0.changed.send_modify(|v| *v = v.wrapping_add(1));
        Ok(())
    }
    fn finish(&self, kind: Outcome, error: Option<RpcError>) {
        if let Some(error) = &error {
            tracing::error!(message=%error.message,"recording operation failed");
        }
        self.change(|s| {
            s.next_event += 1;
            s.events.push(RecordingEvent {
                id: s.next_event.to_string(),
                kind,
                recording_id: s.owner.recording.map(|v| v.to_string()),
                session_id: s.owner.session.map(|v| v.to_string()),
                project_id: s.owner.project.map(|v| v.to_string()),
                diagnostic: error.map(|e| e.message),
            });
            s.phase = Phase::Idle;
            s.owner = Owner::default();
            s.seconds = 0;
            s.level = 0.;
            s.stop = false;
        });
    }
    fn acknowledge(&self, through: u64) -> RecordingStatus {
        self.change(|s| {
            s.events
                .retain(|e| e.id.parse::<u64>().unwrap_or(u64::MAX) > through)
        });
        self.status()
    }
    async fn start(
        &self,
        sink: AudioSink,
        session: SessionId,
        id: Option<RecordingId>,
    ) -> std::result::Result<RecordingStatus, RpcError> {
        if self.status().phase != Phase::Idle {
            return Err(RpcError::invalid("microphone operation in progress"));
        }
        let gate = self.0.gate.clone().lock_owned().await;
        self.reserve(
            Phase::Starting,
            Owner {
                recording: id,
                session: Some(session),
                project: None,
            },
        )?;
        let this = self.clone();
        let (started, ready) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let prepared = async {
                let project = sink.project(session).await?;
                this.change(|s| s.owner.project = Some(project));
                let recording = if let Some(id) = id {
                    sink.get(id)
                        .await?
                        .ok_or_else(|| RpcError::invalid("recording is gone"))?
                } else {
                    let r: p::Recording = sink
                        .call(
                            "CreateRecording",
                            p::SessionId {
                                value: session.get(),
                            },
                        )
                        .await?;
                    sink.get(RecordingId::new(
                        r.id.ok_or_else(|| RpcError::internal("recording has no ID"))?
                            .value,
                    ))
                    .await?
                    .ok_or_else(|| RpcError::invalid("recording is gone"))?
                };
                if recording.session_id != session {
                    return Err(RpcError::invalid("recording belongs to another session"));
                }
                this.change(|s| s.owner.recording = Some(recording.id));
                Ok(recording)
            }
            .await;
            let recording = match prepared {
                Ok(r) => r,
                Err(error) => {
                    this.finish(Outcome::SaveFailed, Some(error));
                    let _ = started.send(this.status());
                    return;
                }
            };
            let factory = this.0.factory.clone();
            let device_sink = sink.clone();
            let opening = recording.clone();
            let opened = tokio::task::spawn_blocking(move || factory(device_sink, &opening)).await;
            let recorder = match opened {
                Ok(Ok(recorder)) => recorder,
                result => {
                    if id.is_none()
                        && let Err(error) = sink.delete(recording.id).await
                    {
                        tracing::warn!(message=%error.message,"cannot remove unopened recording");
                    }
                    let message = match result {
                        Ok(Err(error)) => format!("{error:#}"),
                        _ => "microphone startup task failed".into(),
                    };
                    this.finish(Outcome::MicrophoneFailed, Some(RpcError::internal(message)));
                    let _ = started.send(this.status());
                    return;
                }
            };
            this.change(|s| s.phase = Phase::Live);
            let _ = started.send(this.status());
            drop(gate);
            let mut changed = this.0.changed.subscribe();
            loop {
                {
                    let mut s = this.0.state.lock().unwrap_or_else(|p| p.into_inner());
                    s.seconds = recorder.seconds();
                    s.level = recorder.level();
                    s.revision += 1;
                }
                let stopping = this.0.state.lock().unwrap_or_else(|p| p.into_inner()).stop;
                if stopping || recorder.has_ended() {
                    break;
                }
                tokio::select! {_=tokio::time::sleep(std::time::Duration::from_millis(50))=>{},_=changed.changed()=>{}}
            }
            this.change(|s| s.phase = Phase::Stopping);
            let ended = tokio::task::spawn_blocking(move || recorder.stop())
                .await
                .unwrap_or_else(|_| Ended::Failed(study_core::err!("recorder join failed")));
            if let Ended::Failed(error) = ended {
                this.finish(
                    Outcome::Failed,
                    Some(RpcError::internal(format!("{error:#}"))),
                );
                return;
            }
            this.change(|s| s.phase = Phase::Posting);
            let _gate = this.0.gate.lock().await;
            match sink.post(&recording).await {
                Ok(posted) => this.finish(
                    if !posted {
                        Outcome::Empty
                    } else if matches!(ended, Ended::Full) {
                        Outcome::Full
                    } else {
                        Outcome::Posted
                    },
                    None,
                ),
                Err(error) => this.finish(Outcome::SaveFailed, Some(error)),
            }
        });
        ready
            .await
            .map_err(|_| RpcError::internal("microphone startup stopped"))
    }
    pub async fn stop(&self) -> std::result::Result<RecordingStatus, RpcError> {
        self.change(|s| s.stop = true);
        let mut changed = self.0.changed.subscribe();
        loop {
            if self.status().phase == Phase::Idle {
                let _gate = self.0.gate.lock().await;
                if self.status().phase == Phase::Idle {
                    return Ok(self.status());
                }
            }
            changed
                .changed()
                .await
                .map_err(|_| RpcError::internal("microphone lifecycle closed"))?;
        }
    }
    pub async fn shutdown(&self) -> std::result::Result<RecordingStatus, RpcError> {
        self.change(|s| s.closing = true);
        self.stop().await
    }
    async fn unfinished(
        &self,
        sink: AudioSink,
        id: RecordingId,
        discard: bool,
    ) -> std::result::Result<RecordingStatus, RpcError> {
        if self.status().phase != Phase::Idle {
            return Err(RpcError::invalid("microphone operation in progress"));
        }
        let gate = self.0.gate.clone().lock_owned().await;
        self.reserve(
            if discard {
                Phase::Discarding
            } else {
                Phase::Sending
            },
            Owner {
                recording: Some(id),
                ..Owner::default()
            },
        )?;
        let this = self.clone();
        let (done, result) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let work = async {
                let Some(recording) = sink.get(id).await? else {
                    // A refresh/event can remove a shelf row while its last click is in
                    // flight. Sending/discarding an already posted row is idempotent.
                    return Ok(if discard {
                        Outcome::Discarded
                    } else {
                        Outcome::Empty
                    });
                };
                let project = sink.project(recording.session_id).await?;
                this.change(|s| {
                    s.owner = Owner {
                        recording: Some(id),
                        session: Some(recording.session_id),
                        project: Some(project),
                    }
                });
                if discard {
                    sink.delete(id).await?;
                    Ok(Outcome::Discarded)
                } else {
                    sink.post(&recording).await.map(|sent| {
                        if sent {
                            Outcome::Posted
                        } else {
                            Outcome::Empty
                        }
                    })
                }
            }
            .await;
            match work {
                Ok(kind) => this.finish(kind, None),
                Err(error) => this.finish(Outcome::SaveFailed, Some(error)),
            }
            drop(gate);
            let _ = done.send(this.status());
        });
        result
            .await
            .map_err(|_| RpcError::internal("recording operation stopped"))
    }
    /// The IPC fence and device reservation share a gate. Recheck at dispatch, including
    /// stale delete confirmations and direct typed consumers bypassing shelf controls.
    pub async fn rpc(
        &self,
        client: &RpcClient,
        method: &str,
        payload: &[u8],
    ) -> std::result::Result<Vec<u8>, RpcError> {
        if self
            .0
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .installing
        {
            return Err(RpcError::invalid("update installation in progress"));
        }
        let descriptor = client.method(method)?;
        let target = match descriptor.name() {
            "DeleteSession" => Some((
                0,
                p::SessionId::decode(payload)
                    .map_err(|_| RpcError::invalid("invalid session"))?
                    .value,
            )),
            "DeleteProject" => Some((
                1,
                p::ProjectId::decode(payload)
                    .map_err(|_| RpcError::invalid("invalid project"))?
                    .value,
            )),
            "DeleteRecording" => Some((
                2,
                p::RecordingId::decode(payload)
                    .map_err(|_| RpcError::invalid("invalid recording"))?
                    .value,
            )),
            "PostRecording" => Some((
                2,
                p::PostRecordingRequest::decode(payload)
                    .map_err(|_| RpcError::invalid("invalid recording"))?
                    .recording
                    .ok_or_else(|| RpcError::invalid("missing recording"))?
                    .value,
            )),
            _ => None,
        };
        if let Some((kind, id)) = target {
            let blocked = || {
                let state = self.0.state.lock().unwrap_or_else(|p| p.into_inner());
                let owned = match kind {
                    0 => state.owner.session.map(|v| v.get()),
                    1 => state.owner.project.map(|v| v.get()),
                    _ => state.owner.recording.map(|v| v.get()),
                };
                state.closing
                    || state.installing
                    || (state.phase != Phase::Idle && owned.is_none_or(|v| v == id))
            };
            if blocked() {
                return Err(RpcError::invalid("recording owner is busy"));
            }
            let _gate = self.0.gate.lock().await;
            if blocked() {
                return Err(RpcError::invalid("recording owner is busy"));
            }
            return client.call_bytes(method, payload).await;
        }
        client.call_bytes(method, payload).await
    }
}
/// Installer ownership outlives IPC callers and releases capture admission on failure.
pub struct InstallReservation(Microphone);
impl Drop for InstallReservation {
    fn drop(&mut self) {
        self.0.change(|s| s.installing = false);
    }
}
fn id(value: &str) -> std::result::Result<i64, RpcError> {
    value
        .parse::<i64>()
        .ok()
        .filter(|v| *v > 0)
        .ok_or_else(|| RpcError::invalid("invalid recording identity"))
}
#[tauri::command]
pub async fn recording_start(
    shell: tauri::State<'_, crate::Shell>,
    microphone: tauri::State<'_, Microphone>,
    session_id: String,
    recording_id: Option<String>,
) -> std::result::Result<RecordingStatus, RpcError> {
    microphone
        .start(
            AudioSink::new(shell.client.clone()),
            SessionId::new(id(&session_id)?),
            recording_id
                .as_deref()
                .map(id)
                .transpose()?
                .map(RecordingId::new),
        )
        .await
}
#[tauri::command]
pub async fn recording_stop(
    microphone: tauri::State<'_, Microphone>,
) -> std::result::Result<RecordingStatus, RpcError> {
    microphone.stop().await
}
#[tauri::command]
pub fn recording_status(microphone: tauri::State<'_, Microphone>) -> RecordingStatus {
    microphone.status()
}
#[tauri::command]
pub async fn recording_send(
    shell: tauri::State<'_, crate::Shell>,
    microphone: tauri::State<'_, Microphone>,
    recording_id: String,
) -> std::result::Result<RecordingStatus, RpcError> {
    microphone
        .unfinished(
            AudioSink::new(shell.client.clone()),
            RecordingId::new(id(&recording_id)?),
            false,
        )
        .await
}
#[tauri::command]
pub async fn recording_discard(
    shell: tauri::State<'_, crate::Shell>,
    microphone: tauri::State<'_, Microphone>,
    recording_id: String,
) -> std::result::Result<RecordingStatus, RpcError> {
    microphone
        .unfinished(
            AudioSink::new(shell.client.clone()),
            RecordingId::new(id(&recording_id)?),
            true,
        )
        .await
}
#[tauri::command]
pub fn recording_ack(
    microphone: tauri::State<'_, Microphone>,
    through: String,
) -> std::result::Result<RecordingStatus, RpcError> {
    Ok(microphone.acknowledge(
        through
            .parse()
            .map_err(|_| RpcError::invalid("invalid recording event"))?,
    ))
}

#[cfg(test)]
mod tests;
