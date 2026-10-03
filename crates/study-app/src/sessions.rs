//! Sessions, their messages and threads, recordings, and titles.

use std::path::PathBuf;

use study_core::Result;
use study_core::db::{
    Asked, ChatMessage, ChatSession, MessageEvent, MessageRole, NewPart, Place, Recording, Rewrite,
    Thread,
};
use study_core::{JobId, JobKind, MessageId, PartId, ProjectId, RecordingId, SessionId, VersionId};

use crate::App;
use crate::agents::title::TitleHandler;

impl App {
    /// Every session in every project, most recently active first.
    pub fn all_sessions(&self) -> Result<Vec<ChatSession>> {
        self.with(|database| database.list_all_sessions())
    }

    /// One session; `None` when it is gone.
    pub fn session(&self, id: SessionId) -> Result<Option<ChatSession>> {
        self.with(|database| database.session(id))
    }

    /// A session with a title the user chose.
    pub fn create_session(&self, project: ProjectId, title: &str) -> Result<ChatSession> {
        self.with(|database| database.create_session(project, title))
    }

    /// A session whose `placeholder` title stands in until the title agent names it.
    pub fn create_untitled_session(
        &self,
        project: ProjectId,
        placeholder: &str,
    ) -> Result<ChatSession> {
        self.with(|database| database.create_untitled_session(project, placeholder))
    }

    /// Deletes a session with its messages, and stops the work on them. Attached files stay
    /// in the Library. `false` when it was already gone.
    pub fn delete_session(&self, id: SessionId) -> Result<bool> {
        self.delete(|database| database.delete_session(id))
    }

    /// Asks for a finished answer again, from what the session holds now. The new answer is a
    /// version of the message, shown once written. [`Asked::Unavailable`] when it is gone,
    /// is not an answer, or shows material (which is written again on its page).
    pub fn reanswer(&self, id: MessageId) -> Result<Asked> {
        self.queue(|database| database.reanswer(id))
    }

    /// Asks for a new version of a message's text, improved, summarized or changed as `how`
    /// says, from its active version and what was read from its files. It is shown once
    /// written, unless the student has chosen another version meanwhile.
    pub fn rewrite_message(&self, id: MessageId, how: &Rewrite) -> Result<Asked> {
        self.queue(|database| database.rewrite_message(id, how))
    }

    /// Writes `text` as a new version of a message, as the student's edit. `None` when the
    /// message is gone or the text is empty or unchanged.
    pub fn edit_message(&self, id: MessageId, text: &str) -> Result<Option<VersionId>> {
        self.with(|database| database.edit_message(id, text))
    }

    /// Shows another finished version of a message. `false` when it is not one of its.
    pub fn set_active_version(&self, message: MessageId, version: VersionId) -> Result<bool> {
        self.with(|database| database.set_active_version(message, version))
    }

    /// Deletes a note or an answer, and what the database cascades from it: an answer to the
    /// note, material an answer shows, threads under its files, and their jobs, stopping any
    /// under way. Attached files stay in the Library. `false` when it was already gone.
    pub fn delete_message(&self, id: MessageId) -> Result<bool> {
        self.delete(|database| database.delete_message(id))
    }

    /// A session's timeline, oldest first, with each part's jobs and each attachment's
    /// thread summary.
    pub fn messages(&self, session: SessionId) -> Result<Vec<ChatMessage>> {
        self.with(|database| database.list_messages(session))
    }

    /// The thread under an attachment: the file and what was read from it, then the replies.
    /// `None` when `root` is not an attachment on a timeline.
    pub fn thread(&self, root: PartId) -> Result<Option<Thread>> {
        self.with(|database| database.thread(root))
    }

    /// Posts a user message with attached files to a session's timeline (a [`SessionId`])
    /// or a thread, queues what reads them (and names the session, while its title is
    /// provisional), and announces it.
    pub fn post_message(
        &self,
        place: impl Into<Place>,
        text: &str,
        files: &[PathBuf],
    ) -> Result<ChatMessage> {
        let mut parts = Vec::with_capacity(files.len() + 1);
        if !text.trim().is_empty() {
            parts.push(NewPart::Text(text.to_owned()));
        }
        parts.extend(files.iter().cloned().map(NewPart::File));
        self.post(place.into(), &parts)
    }

    fn post(&self, place: Place, parts: &[NewPart]) -> Result<ChatMessage> {
        self.running()?;
        let message = self.queue_reads(|database, readable| {
            database.post_message(place, MessageRole::User, parts, readable)
        })?;
        self.bus().publish(MessageEvent::Posted {
            session_id: message.session_id,
            thread_root: message.thread_root,
            message_id: message.id,
        });
        Ok(message)
    }

    /// Asks the title agent for a new title from the whole session, even over one the
    /// user typed. Asking again before that title is written returns the same job. The job's
    /// events say when it ends.
    pub fn regenerate_title(&self, session: SessionId) -> Result<JobId> {
        self.running()?
            .jobs
            .enqueue_once(&TitleHandler::requested(session))
    }

    /// The sessions being named right now, or waiting to be.
    pub fn sessions_being_titled(&self) -> Result<Vec<SessionId>> {
        self.with(|database| database.sessions_with_pending(JobKind::Title))
    }

    /// Every recording not posted yet, most recently saved first.
    pub fn recordings(&self) -> Result<Vec<Recording>> {
        self.with(|database| database.list_recordings())
    }

    /// One recording; `None` when it was posted or discarded.
    pub fn recording(&self, id: RecordingId) -> Result<Option<Recording>> {
        self.with(|database| database.recording(id))
    }

    /// Starts an empty recording in `session`.
    pub fn create_recording(&self, session: SessionId) -> Result<Recording> {
        self.with(|database| database.create_recording(session))
    }

    /// Saves the next stretch of audio at the end of a recording.
    pub fn append_recording(&self, id: RecordingId, samples: &[i16]) -> Result<()> {
        self.with(|database| database.append_recording(id, samples))
    }

    /// Discards a recording not posted yet. `false` when it was already gone.
    pub fn delete_recording(&self, id: RecordingId) -> Result<bool> {
        self.with(|database| database.delete_recording(id))
    }

    /// Posts a recording to its session as a WAV file named `name`.
    pub fn post_recording(
        &self,
        session: SessionId,
        recording: RecordingId,
        name: &str,
    ) -> Result<ChatMessage> {
        let part = NewPart::Recording {
            id: recording,
            name: name.to_owned(),
        };
        self.post(Place::Timeline(session), &[part])
    }
}
