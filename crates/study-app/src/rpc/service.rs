//! Each generated RPC delegates to its corresponding typed App operation.
use super::*;
use std::pin::Pin;
use study_core as c;
use study_core::bus::Heard;
use study_core::db as d;
use study_core::db::{JobEvent, MessageEvent};
use tokio_stream::Stream;

#[tonic::async_trait]
impl p::study_server::Study for Service {
    async fn get_material_settings(
        &self,
        request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::MaterialSettings>, Status> {
        self.authorize(&request)?;
        self.run(false, move |s| {
            Ok(p::MaterialSettings {
                sift: outcome(s.app.preferences::<c::processing::MaterialPreferences>())?.sift,
            })
        })
        .await
    }
    async fn save_material_settings(
        &self,
        request: tonic::Request<p::MaterialSettings>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            outcome(
                s.app
                    .save_preferences(&c::processing::MaterialPreferences { sift: r.sift }),
            )?;
            Ok(p::Empty {})
        })
        .await
    }

    async fn export_source_to_file(
        &self,
        request: tonic::Request<p::ExportSourceToFileRequest>,
    ) -> Result<tonic::Response<p::CountResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            let id = source(required(r.source_id, "source_id")?)?;
            let destination = std::path::Path::new(&r.destination);
            let parent = destination
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| std::path::Path::new("."));
            let mut file = tempfile::NamedTempFile::new_in(parent)
                .map_err(|e| status(c::Error::classified(e)))?;
            let written = outcome(s.app.export_source(id, file.as_file_mut()))?;
            file.as_file()
                .sync_all()
                .map_err(|e| status(c::Error::classified(e)))?;
            file.persist(destination)
                .map_err(|e| status(c::Error::classified(e.error)))?;
            Ok(p::CountResult { value: written })
        })
        .await
    }

    async fn get_health(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Health>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            outcome(s.app.projects())?;
            Ok(p::Health {
                protocol_version: 1,
                workers_running: s.app.workers_running(),
                test_mode: s.test_mode,
            })
        })
        .await
    }
    async fn projects(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Projects>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::Projects {
                items: outcome(s.app.projects())?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn create_project(
        &self,
        request: tonic::Request<p::CreateProjectRequest>,
    ) -> Result<tonic::Response<p::Project>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(outcome(s.app.create_project(&r.name))?.wire())
        })
        .await
    }
    async fn rename_project(
        &self,
        request: tonic::Request<p::RenameProjectRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(
                    s.app
                        .rename_project(project(required(r.id, "id")?)?, &r.name),
                )?,
            })
        })
        .await
    }
    async fn set_exam(
        &self,
        request: tonic::Request<p::SetExamRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.set_exam(
                    project(required(r.id, "id")?)?,
                    r.exam_on.map(IntoDomain::domain).transpose()?,
                ))?,
            })
        })
        .await
    }
    async fn delete_project(
        &self,
        request: tonic::Request<p::ProjectId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_project(project(r)?))?,
            })
        })
        .await
    }
    async fn sources(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Sources>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::Sources {
                items: outcome(s.app.sources())?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn source(
        &self,
        request: tonic::Request<p::SourceId>,
    ) -> Result<tonic::Response<p::OptionalSource>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalSource {
                value: outcome(s.app.source(source(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn import_files(
        &self,
        request: tonic::Request<p::ImportFilesRequest>,
    ) -> Result<tonic::Response<p::ImportResults>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let project = r.project.map(project).transpose()?;
            let mut items = Vec::with_capacity(r.paths.len());
            for path in r.paths {
                let result = match s.app.import_file(std::path::Path::new(&path), project) {
                    Ok(source) => p::import_outcome::Result::Source(source.wire()),
                    Err(error) => p::import_outcome::Result::Error(p::ErrorDetails {
                        kind: p::ErrorKind::from_domain(error.kind()) as i32,
                        message: format!("{error:#}"),
                        retry_after_ms: None,
                    }),
                };
                items.push(p::ImportOutcome {
                    path,
                    result: Some(result),
                });
            }
            Ok(p::ImportResults { items })
        })
        .await
    }
    async fn import_file(
        &self,
        request: tonic::Request<p::ImportFileRequest>,
    ) -> Result<tonic::Response<p::Source>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(outcome(s.app.import_file(
                std::path::Path::new(&r.path),
                r.project.map(project).transpose()?,
            ))?
            .wire())
        })
        .await
    }
    async fn create_note(
        &self,
        request: tonic::Request<p::CreateNoteRequest>,
    ) -> Result<tonic::Response<p::Source>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            if r.text.trim().is_empty() {
                return Err(invalid("a note needs text"));
            }
            Ok(outcome(
                s.app
                    .create_note(r.project.map(project).transpose()?, &r.title, &r.text),
            )?
            .wire())
        })
        .await
    }
    async fn add_link(
        &self,
        request: tonic::Request<p::AddLinkRequest>,
    ) -> Result<tonic::Response<p::Source>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(outcome(s.app.add_link(r.project.map(project).transpose()?, &r.url))?.wire())
        })
        .await
    }
    async fn source_document(
        &self,
        request: tonic::Request<p::SourceId>,
    ) -> Result<tonic::Response<p::OptionalDocument>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalDocument {
                value: outcome(s.app.source_document(source(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn correct_block(
        &self,
        request: tonic::Request<p::CorrectBlockRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.correct_block(
                    source(required(r.id, "id")?)?,
                    ordinal(r.ordinal)?,
                    &r.before,
                    &r.after,
                ))?,
            })
        })
        .await
    }
    async fn set_source_project(
        &self,
        request: tonic::Request<p::SetSourceProjectRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.set_source_project(
                    source(required(r.id, "id")?)?,
                    r.project.map(project).transpose()?,
                ))?,
            })
        })
        .await
    }
    async fn delete_source(
        &self,
        request: tonic::Request<p::SourceId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_source(source(r)?))?,
            })
        })
        .await
    }
    async fn export_source(
        &self,
        request: tonic::Request<p::SourceId>,
    ) -> Result<tonic::Response<p::BytesResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            let mut bytes = Vec::new();
            outcome(s.app.export_source(source(r)?, &mut bytes))?;
            Ok(p::BytesResult { value: bytes })
        })
        .await
    }
    async fn preview(
        &self,
        request: tonic::Request<p::SourceId>,
    ) -> Result<tonic::Response<p::Preview>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            let source = outcome(s.app.source(source(r)?))?
                .ok_or_else(|| classified(c::ErrorKind::NotFound, "source not found"))?;
            Ok(outcome(s.app.preview(&source))?.wire())
        })
        .await
    }
    async fn has_preview(
        &self,
        request: tonic::Request<p::HasPreviewRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |_s| {
            Ok(p::BoolResult {
                value: crate::has_preview(
                    enumeration::<p::SourceKind, c::SourceKind>(r.kind)?,
                    r.mime.as_deref(),
                ),
            })
        })
        .await
    }
    async fn all_sessions(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::ChatSessions>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::ChatSessions {
                items: outcome(s.app.all_sessions())?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn session(
        &self,
        request: tonic::Request<p::SessionId>,
    ) -> Result<tonic::Response<p::OptionalChatSession>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalChatSession {
                value: outcome(s.app.session(session(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn create_session(
        &self,
        request: tonic::Request<p::CreateSessionRequest>,
    ) -> Result<tonic::Response<p::ChatSession>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(outcome(
                s.app
                    .create_session(project(required(r.project, "project")?)?, &r.title),
            )?
            .wire())
        })
        .await
    }
    async fn create_untitled_session(
        &self,
        request: tonic::Request<p::CreateSessionRequest>,
    ) -> Result<tonic::Response<p::ChatSession>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(outcome(
                s.app
                    .create_untitled_session(project(required(r.project, "project")?)?, &r.title),
            )?
            .wire())
        })
        .await
    }
    async fn delete_session(
        &self,
        request: tonic::Request<p::SessionId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_session(session(r)?))?,
            })
        })
        .await
    }
    async fn reanswer(
        &self,
        request: tonic::Request<p::MessageId>,
    ) -> Result<tonic::Response<p::Asked>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(outcome(s.app.reanswer(message(r)?))?.wire())
        })
        .await
    }
    async fn rewrite_message(
        &self,
        request: tonic::Request<p::RewriteMessageRequest>,
    ) -> Result<tonic::Response<p::Asked>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            let how = match required(r.how, "how")? {
                p::rewrite_message_request::How::Improve(_) => d::Rewrite::Improve,
                p::rewrite_message_request::How::Summarize(_) => d::Rewrite::Summarize,
                p::rewrite_message_request::How::Instruction(v) => d::Rewrite::Instruction(v),
            };
            Ok(outcome(s.app.rewrite_message(message(required(r.id, "id")?)?, &how))?.wire())
        })
        .await
    }
    async fn edit_message(
        &self,
        request: tonic::Request<p::EditMessageRequest>,
    ) -> Result<tonic::Response<p::OptionalVersionId>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::OptionalVersionId {
                value: outcome(s.app.edit_message(message(required(r.id, "id")?)?, &r.text))?
                    .map(IntoWire::wire),
            })
        })
        .await
    }
    async fn set_active_version(
        &self,
        request: tonic::Request<p::SetActiveVersionRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.set_active_version(
                    message(required(r.message, "message")?)?,
                    version(required(r.version, "version")?)?,
                ))?,
            })
        })
        .await
    }
    async fn delete_message(
        &self,
        request: tonic::Request<p::MessageId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_message(message(r)?))?,
            })
        })
        .await
    }
    async fn messages(
        &self,
        request: tonic::Request<p::SessionId>,
    ) -> Result<tonic::Response<p::ChatMessages>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::ChatMessages {
                items: outcome(s.app.messages(session(r)?))?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn thread(
        &self,
        request: tonic::Request<p::PartId>,
    ) -> Result<tonic::Response<p::OptionalThread>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalThread {
                value: outcome(s.app.thread(part(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn post_message(
        &self,
        request: tonic::Request<p::PostMessageRequest>,
    ) -> Result<tonic::Response<p::ChatMessage>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let place = match required(r.place, "place")? {
                p::post_message_request::Place::Timeline(v) => d::Place::Timeline(session(v)?),
                p::post_message_request::Place::Thread(v) => d::Place::Thread(part(v)?),
            };
            let files = r
                .files
                .into_iter()
                .map(std::path::PathBuf::from)
                .collect::<Vec<_>>();
            let message = if s.test_mode {
                let mut parts = Vec::new();
                if !r.text.trim().is_empty() {
                    parts.push(d::NewPart::Text(r.text));
                }
                parts.extend(files.into_iter().map(d::NewPart::File));
                s.post_dormant(place, &parts)
            } else {
                s.workers()?;
                s.app.post_message(place, &r.text, &files)
            };
            Ok(outcome(message)?.wire())
        })
        .await
    }
    async fn regenerate_title(
        &self,
        request: tonic::Request<p::SessionId>,
    ) -> Result<tonic::Response<p::JobId>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(outcome(s.app.regenerate_title(session(r)?))?.wire())
        })
        .await
    }
    async fn sessions_being_titled(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::SessionIds>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::SessionIds {
                items: outcome(s.app.sessions_being_titled())?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn recordings(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Recordings>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::Recordings {
                items: outcome(s.app.recordings())?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn recording(
        &self,
        request: tonic::Request<p::RecordingId>,
    ) -> Result<tonic::Response<p::OptionalRecording>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalRecording {
                value: outcome(s.app.recording(recording(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn create_recording(
        &self,
        request: tonic::Request<p::SessionId>,
    ) -> Result<tonic::Response<p::Recording>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(outcome(s.app.create_recording(session(r)?))?.wire())
        })
        .await
    }
    async fn append_recording(
        &self,
        request: tonic::Request<p::AppendRecordingRequest>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let samples = r
                .samples
                .into_iter()
                .map(|v| i16::try_from(v).map_err(|_| invalid("PCM sample out of range")))
                .collect::<Result<Vec<_>, _>>()?;
            outcome(
                s.app
                    .append_recording(recording(required(r.id, "id")?)?, &samples),
            )?;
            Ok(p::Empty {})
        })
        .await
    }
    async fn delete_recording(
        &self,
        request: tonic::Request<p::RecordingId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_recording(recording(r)?))?,
            })
        })
        .await
    }
    async fn post_recording(
        &self,
        request: tonic::Request<p::PostRecordingRequest>,
    ) -> Result<tonic::Response<p::ChatMessage>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let session = session(required(r.session, "session")?)?;
            let recording = recording(required(r.recording, "recording")?)?;
            let message = if s.test_mode {
                s.post_dormant(
                    d::Place::Timeline(session),
                    &[d::NewPart::Recording {
                        id: recording,
                        name: r.name,
                    }],
                )
            } else {
                s.workers()?;
                s.app.post_recording(session, recording, &r.name)
            };
            Ok(outcome(message)?.wire())
        })
        .await
    }
    async fn update_material(
        &self,
        request: tonic::Request<p::MaterialRequest>,
    ) -> Result<tonic::Response<p::ArtifactId>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(outcome(s.app.update_material(
                project(required(r.project, "project")?)?,
                enumeration::<p::ArtifactKind, c::ArtifactKind>(r.kind)?,
            ))?
            .wire())
        })
        .await
    }
    async fn can_update_material(
        &self,
        request: tonic::Request<p::MaterialRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.can_update_material(
                    project(required(r.project, "project")?)?,
                    enumeration::<p::ArtifactKind, c::ArtifactKind>(r.kind)?,
                ))?,
            })
        })
        .await
    }
    async fn material_changes(
        &self,
        request: tonic::Request<p::ArtifactId>,
    ) -> Result<tonic::Response<p::OptionalChanges>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalChanges {
                value: outcome(s.app.material_changes(artifact(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn delete_material(
        &self,
        request: tonic::Request<p::MaterialRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_material(
                    project(required(r.project, "project")?)?,
                    enumeration::<p::ArtifactKind, c::ArtifactKind>(r.kind)?,
                ))?,
            })
        })
        .await
    }
    async fn material(
        &self,
        request: tonic::Request<p::ProjectId>,
    ) -> Result<tonic::Response<p::Materials>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::Materials {
                items: outcome(s.app.material(project(r)?))?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn artifact(
        &self,
        request: tonic::Request<p::ArtifactId>,
    ) -> Result<tonic::Response<p::OptionalArtifact>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalArtifact {
                value: outcome(s.app.artifact(artifact(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn set_card(
        &self,
        request: tonic::Request<p::SetCardRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let change = match required(r.change, "change")? {
                p::set_card_request::Change::Write(v) => d::CardChange::Write {
                    front: v.front,
                    back: v.back,
                },
                p::set_card_request::Change::Delete(_) => d::CardChange::Delete,
            };
            Ok(p::BoolResult {
                value: outcome(s.app.set_card(
                    artifact(required(r.artifact, "artifact")?)?,
                    ordinal(r.index)?,
                    change,
                ))?,
            })
        })
        .await
    }
    async fn delete_artifact(
        &self,
        request: tonic::Request<p::ArtifactId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_artifact(artifact(r)?))?,
            })
        })
        .await
    }
    async fn review_times(
        &self,
        request: tonic::Request<p::ReviewTimesRequest>,
    ) -> Result<tonic::Response<p::ReviewTimes>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::ReviewTimes {
                items: outcome(
                    s.app
                        .review_times(r.project.map(project).transpose()?, r.since),
                )?,
            })
        })
        .await
    }
    async fn due_by(
        &self,
        request: tonic::Request<p::DueByRequest>,
    ) -> Result<tonic::Response<p::CountResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::CountResult {
                value: outcome(s.app.due_by(r.project.map(project).transpose()?, r.until))? as u64,
            })
        })
        .await
    }
    async fn due_cards(
        &self,
        request: tonic::Request<p::DueCardsRequest>,
    ) -> Result<tonic::Response<p::DueCards>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::DueCards {
                items: outcome(
                    s.app
                        .due_cards(r.project.map(project).transpose()?, limit(r.limit)?),
                )?
                .into_iter()
                .map(IntoWire::wire)
                .collect(),
            })
        })
        .await
    }
    async fn due_count(
        &self,
        request: tonic::Request<p::OptionalProject>,
    ) -> Result<tonic::Response<p::CountResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::CountResult {
                value: outcome(s.app.due_count(r.project.map(project).transpose()?))? as u64,
            })
        })
        .await
    }
    async fn review(
        &self,
        request: tonic::Request<p::ReviewRequest>,
    ) -> Result<tonic::Response<p::OptionalMemory>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::OptionalMemory {
                value: outcome(s.app.review(
                    card(required(r.card, "card")?)?,
                    enumeration::<p::Rating, c::Rating>(r.rating)?,
                ))?
                .map(IntoWire::wire),
            })
        })
        .await
    }
    async fn project_practice(
        &self,
        request: tonic::Request<p::ProjectId>,
    ) -> Result<tonic::Response<p::PracticeId>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(outcome(s.app.project_practice(project(r)?))?.wire())
        })
        .await
    }
    async fn practices(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::PracticeSummaries>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::PracticeSummaries {
                items: outcome(s.app.practices())?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn practice(
        &self,
        request: tonic::Request<p::PracticeId>,
    ) -> Result<tonic::Response<p::OptionalPractice>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalPractice {
                value: outcome(s.app.practice(practice(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn answer_question(
        &self,
        request: tonic::Request<p::AnswerQuestionRequest>,
    ) -> Result<tonic::Response<p::Answered>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(outcome(s.app.answer_question(
                question(required(r.id, "id")?)?,
                &required(r.answer, "answer")?.domain()?,
            ))?
            .wire())
        })
        .await
    }
    async fn add_to_flashcards(
        &self,
        request: tonic::Request<p::AddToFlashcardsRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(
                    s.app
                        .add_to_flashcards(question(required(r.question, "question")?)?, &r.title),
                )?,
            })
        })
        .await
    }
    async fn delete_practice(
        &self,
        request: tonic::Request<p::PracticeId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.delete_practice(practice(r)?))?,
            })
        })
        .await
    }
    async fn job_overviews(
        &self,
        request: tonic::Request<p::LimitRequest>,
    ) -> Result<tonic::Response<p::JobOverviews>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::JobOverviews {
                items: outcome(s.app.job_overviews(limit(r.limit)?))?
                    .into_iter()
                    .map(IntoWire::wire)
                    .collect(),
            })
        })
        .await
    }
    async fn job(
        &self,
        request: tonic::Request<p::JobId>,
    ) -> Result<tonic::Response<p::OptionalJob>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::OptionalJob {
                value: outcome(s.app.job(job(r)?))?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn cancel_job(
        &self,
        request: tonic::Request<p::JobId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(p::BoolResult {
                value: outcome(s.app.cancel_job(job(r)?))?,
            })
        })
        .await
    }
    async fn retry_job(
        &self,
        request: tonic::Request<p::JobId>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.workers()?;
            Ok(p::BoolResult {
                value: outcome(s.app.retry_job(job(r)?))?,
            })
        })
        .await
    }
    async fn search(
        &self,
        request: tonic::Request<p::SearchRequest>,
    ) -> Result<tonic::Response<p::SearchResults>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(outcome(s.app.search(&r.query, limit(r.limit)?))?.wire())
        })
        .await
    }
    async fn get_app_settings(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::AppSettings>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| outcome(s.load_app_settings()))
            .await
    }
    async fn save_app_settings(
        &self,
        request: tonic::Request<p::AppSettings>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            s.store_app_settings(r)?;
            Ok(p::Empty {})
        })
        .await
    }
    async fn get_llm_settings(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::LlmSettings>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(outcome(s.app.preferences::<study_ai::chat::LlmPreferences>())?.wire())
        })
        .await
    }
    async fn save_llm_settings(
        &self,
        request: tonic::Request<p::LlmSettings>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let value: study_ai::chat::LlmPreferences = r.domain()?;
            outcome(s.app.save_preferences(&value))?;
            Ok(p::Empty {})
        })
        .await
    }
    async fn get_transcription_settings(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::TranscriptionSettings>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(outcome(
                s.app
                    .preferences::<study_ai::stt::TranscriptionPreferences>(),
            )?
            .wire())
        })
        .await
    }
    async fn save_transcription_settings(
        &self,
        request: tonic::Request<p::TranscriptionSettings>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let value: study_ai::stt::TranscriptionPreferences = r.domain()?;
            outcome(s.app.save_preferences(&value))?;
            Ok(p::Empty {})
        })
        .await
    }
    async fn get_review_settings(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::ReviewSettings>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(outcome(s.app.preferences::<c::ReviewPreferences>())?.wire())
        })
        .await
    }
    async fn save_review_settings(
        &self,
        request: tonic::Request<p::ReviewSettings>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let value: c::ReviewPreferences = r.domain()?;
            outcome(s.app.save_preferences(&value))?;
            Ok(p::Empty {})
        })
        .await
    }
    async fn connections(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Connections>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::Connections {
                chatgpt: outcome(s.app.connections())?.chatgpt.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn processing(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::ProcessingSettings>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            let v = outcome(s.app.processing())?;
            let mut switches = Vec::new();
            for &kind in c::SourceKind::ALL {
                for switch in v.switches(kind) {
                    switches.push(p::ProcessingSwitch {
                        source: p::SourceKind::from_domain(kind) as i32,
                        processor: Some(switch.processor.wire()),
                        default: switch.default,
                        on: switch.on,
                    });
                }
            }
            Ok(p::ProcessingSettings { switches })
        })
        .await
    }
    async fn switch_processor(
        &self,
        request: tonic::Request<p::SwitchProcessorRequest>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            Ok({
                outcome(s.app.switch_processor(
                    enumeration::<p::SourceKind, c::SourceKind>(r.kind)?,
                    required(r.processor, "processor")?.domain()?,
                    r.on,
                ))?;
                p::Empty {}
            })
        })
        .await
    }
    async fn machine_report(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::OptionalReport>, Status> {
        self.authorize(&_request)?;
        self.run(false, move |s| {
            Ok(p::OptionalReport {
                value: outcome(s.app.machine_report())?.map(IntoWire::wire),
            })
        })
        .await
    }
    async fn measure_machine(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Report>, Status> {
        self.authorize(&_request)?;
        self.run(true, move |s| {
            s.production()?;
            Ok(outcome(s.app.measure_machine())?.wire())
        })
        .await
    }
    async fn measure_machine_once(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Report>, Status> {
        self.authorize(&_request)?;
        self.production()?;
        let app = self.app.clone();
        let report = self
            .async_work(async move { outcome(app.measure_machine_once().await) })
            .await?;
        Ok(self.refreshed(report.wire()))
    }
    async fn apply_plan(
        &self,
        request: tonic::Request<p::Plan>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(true, move |s| {
            let transcription = match p::Placement::try_from(r.transcription) {
                Ok(p::Placement::Local) => study_ai::catalog::Placement::Local,
                Ok(p::Placement::NotEnoughMemory) => study_ai::catalog::Placement::NotHere(
                    study_ai::catalog::Reason::NotEnoughMemory,
                ),
                Ok(p::Placement::TooSlow) => {
                    study_ai::catalog::Placement::NotHere(study_ai::catalog::Reason::TooSlow)
                }
                _ => return Err(invalid("placement is required")),
            };
            let plan = study_ai::catalog::Plan {
                transcription,
                transcription_instances: r.transcription_instances.map(copies).transpose()?,
            };
            Ok(p::BoolResult {
                value: outcome(s.app.apply_plan(&plan))?,
            })
        })
        .await
    }
    async fn model_status(
        &self,
        request: tonic::Request<p::ModelRequest>,
    ) -> Result<tonic::Response<p::ModelStatus>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            let model = local_model(r.model)?;
            Ok(p::ModelStatus {
                model: r.model,
                installed: s.app.model_installed(model),
                size_bytes: s.app.model_size(model),
            })
        })
        .await
    }
    async fn install_model(
        &self,
        request: tonic::Request<p::ModelRequest>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.production()?;
        self.install(local_model(r.model)?).await?;
        Ok(self.refreshed(p::Empty {}))
    }
    async fn start_chatgpt_sign_in(
        &self,
        request: tonic::Request<p::StartSignInRequest>,
    ) -> Result<tonic::Response<p::SignInAttempt>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.production()?;
        Ok(tonic::Response::new(self.begin_sign_in(r.reconsent).await?))
    }
    async fn finish_chatgpt_sign_in(
        &self,
        request: tonic::Request<p::FinishSignInRequest>,
    ) -> Result<tonic::Response<p::ChatGptAccount>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.production()?;
        let service = self.clone();
        Ok(tonic::Response::new(
            self.async_work(async move { service.complete_sign_in(r.attempt_id).await })
                .await?,
        ))
    }
    async fn cancel_chatgpt_sign_in(
        &self,
        request: tonic::Request<p::FinishSignInRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        Ok(tonic::Response::new(p::BoolResult {
            value: self.cancel_sign_in(r.attempt_id).await?,
        }))
    }
    async fn sign_out_chatgpt(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&_request)?;
        self.production()?;
        self.sign_out().await?;
        Ok(self.refreshed(p::Empty {}))
    }
    async fn reads(
        &self,
        request: tonic::Request<p::ReadableRequest>,
    ) -> Result<tonic::Response<p::BoolResult>, Status> {
        self.authorize(&request)?;
        let r = request.into_inner();
        self.run(false, move |s| {
            Ok(p::BoolResult {
                value: outcome(s.app.reader())?.reads(
                    enumeration::<p::SourceKind, c::SourceKind>(r.kind)?,
                    &r.mime,
                ),
            })
        })
        .await
    }
    async fn start_workers(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&_request)?;
        self.run(true, move |s| {
            s.production()?;
            outcome(s.app.start_workers())?;
            Ok(p::Empty {})
        })
        .await
    }
    async fn turn_off_search_model(
        &self,
        _request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<p::Empty>, Status> {
        self.authorize(&_request)?;
        self.run(true, move |s| {
            s.app.turn_off_search_model();
            Ok(p::Empty {})
        })
        .await
    }

    type SubscribeStream = Pin<Box<dyn Stream<Item = Result<p::Event, Status>> + Send + 'static>>;
    async fn subscribe(
        &self,
        request: tonic::Request<p::Empty>,
    ) -> Result<tonic::Response<Self::SubscribeStream>, Status> {
        self.authorize(&request)?;
        let mut refresh = self.refresh.subscribe();
        let stopped = self.lifecycle.clone();
        let mut jobs = self.app.bus().listen::<d::Job>();
        let mut messages = self.app.bus().listen::<d::ChatMessage>();
        let stream = async_stream::try_stream! {
            yield p::Event {kind:Some(p::event::Kind::RefreshAll(p::Empty {}))};
            loop {
                if stopped.check().is_err() {break;}
                let kind=tokio::select! {
                    _=stopped.cancelled()=>{break;},
                    value=refresh.recv()=>{ if matches!(value,Err(tokio::sync::broadcast::error::RecvError::Closed)) {break;} p::event::Kind::RefreshAll(p::Empty {}) },
                    value=jobs.next()=>match value {
                        Heard::Event(JobEvent::Changed {job_id,kind,status,source_id,session_id})=>p::event::Kind::Job(p::JobChanged {job_id:Some(job_id.wire()),kind:p::JobKind::from_domain(kind) as i32,status:p::JobStatus::from_domain(status) as i32,source_id:source_id.map(IntoWire::wire),session_id:session_id.map(IntoWire::wire)}),
                        Heard::Missed=>p::event::Kind::RefreshAll(p::Empty {}),
                    },
                    value=messages.next()=>match value {
                        Heard::Event(MessageEvent::Posted {session_id,thread_root,message_id})=>p::event::Kind::Message(p::MessagePosted {session_id:Some(session_id.wire()),thread_root:thread_root.map(IntoWire::wire),message_id:Some(message_id.wire())}),
                        Heard::Missed=>p::event::Kind::RefreshAll(p::Empty {}),
                    },
                };
                yield p::Event {kind:Some(kind)};
            }
        };
        Ok(tonic::Response::new(Box::pin(stream)))
    }
}
