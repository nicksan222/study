//! A session as agents read it: every message with the text read from its files, rendered
//! to fit a budget. Most messages are the student's notes; the assistant's answers appear
//! only where a note asked for one.

use std::fmt::Write as _;

use study_ai::agent::{escape, escape_attribute};
use study_core::db::{ChatMessage, Database, MessageRole};
use study_core::text::truncate_chars;
use study_core::{Result, SessionId};

/// A session's messages, oldest first.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Conversation {
    /// Only messages with text or a file.
    pub turns: Vec<Turn>,
}

/// One message: what it says, and the files it carries.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Turn {
    /// Who wrote it.
    pub role: MessageRole,
    /// The text of its active version, trimmed, without the `[n]` markers of the sources it
    /// cites: those sources are not part of the conversation.
    pub text: String,
    /// Its files and material, in the order they appear.
    pub attachments: Vec<Attachment>,
}

/// A file on a message, or study material a tool made.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attachment {
    /// The file's name, or the material's title.
    pub name: String,
    /// What was read from it (a transcript, recognized text), if anything yet.
    pub excerpt: Option<String>,
}

/// How much of a conversation a prompt may hold, in characters.
#[derive(Clone, Copy, Debug)]
pub struct Budget {
    /// The whole conversation.
    pub total: usize,
    /// One message's text.
    pub per_message: usize,
    /// What was read from one attachment; 0 names attachments without their text.
    pub per_attachment: usize,
    /// Attachments named per message.
    pub attachments_per_message: usize,
}

impl Conversation {
    /// Every message of a session.
    pub fn load(database: &Database, session_id: SessionId) -> Result<Self> {
        Ok(Self::from_messages(&database.list_messages(session_id)?))
    }

    /// `messages` as turns, leaving out those with nothing to read.
    pub fn from_messages(messages: &[ChatMessage]) -> Self {
        Self {
            turns: messages.iter().filter_map(Turn::of).collect(),
        }
    }

    /// Whether no message has anything to read.
    pub fn is_empty(&self) -> bool {
        self.turns.is_empty()
    }

    /// The conversation as tagged text. When it does not fit, the first message (which
    /// usually says what the session is about) and the latest ones are kept, and a marker
    /// says how many were left out between them.
    pub fn render(&self, budget: Budget) -> String {
        let rendered: Vec<String> = self.turns.iter().map(|turn| turn.render(budget)).collect();
        let size = |text: &String| text.chars().count();
        if rendered.iter().map(size).sum::<usize>() <= budget.total {
            return rendered.concat();
        }
        let Some((first, rest)) = rendered.split_first() else {
            return String::new();
        };
        let mut used = size(first);
        let mut latest = Vec::new();
        for turn in rest.iter().rev() {
            if used + size(turn) > budget.total {
                break;
            }
            used += size(turn);
            latest.push(turn.as_str());
        }
        let omitted = rest.len() - latest.len();
        let mut text = first.clone();
        if omitted > 0 {
            let _ = writeln!(text, "<omitted messages=\"{omitted}\"/>");
        }
        latest
            .into_iter()
            .rev()
            .for_each(|turn| text.push_str(turn));
        text
    }
}

impl Turn {
    /// A message's text and attachments; `None` when it has neither.
    fn of(message: &ChatMessage) -> Option<Self> {
        let mut turn = Self {
            role: message.role,
            text: String::new(),
            attachments: Vec::new(),
        };
        turn.text = message.plain_text().trim().to_owned();
        for part in &message.parts {
            turn.attachments.push(Attachment {
                name: part.content.name.clone(),
                excerpt: part
                    .document
                    .as_ref()
                    .map(|document| document.text())
                    .filter(|text| !text.trim().is_empty()),
            });
        }
        (!turn.text.is_empty() || !turn.attachments.is_empty()).then_some(turn)
    }

    fn render(&self, budget: Budget) -> String {
        let role = match self.role {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
        };
        // Messages, names and file text are the user's: escaped, so none can close a tag.
        let mut text = format!("<message role=\"{role}\">\n");
        if !self.text.is_empty() {
            text.push_str(&escape(truncate_chars(&self.text, budget.per_message)));
            text.push('\n');
        }
        for attachment in self.attachments.iter().take(budget.attachments_per_message) {
            let _ = writeln!(
                text,
                "<attachment name=\"{}\">",
                escape_attribute(&attachment.name)
            );
            if let Some(excerpt) = attachment
                .excerpt
                .as_ref()
                .filter(|_| budget.per_attachment > 0)
            {
                text.push_str(&escape(truncate_chars(excerpt, budget.per_attachment)));
                text.push('\n');
            }
            text.push_str("</attachment>\n");
        }
        text.push_str("</message>\n");
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::db::{
        Job, JobTarget, MessagePart, MessageStatus, MessageVersion, PartContent, ThreadSummary,
        VersionOrigin,
    };
    use study_core::{
        Anchor, Block, BlockKind, Citation, Document, JobId, JobKind, JobStatus, MessageId, PartId,
        SourceId, SourceKind, VersionId,
    };

    const ROOMY: Budget = Budget {
        total: 10_000,
        per_message: 1_000,
        per_attachment: 1_000,
        attachments_per_message: 4,
    };

    fn read(status: JobStatus) -> Job {
        Job {
            id: JobId::new(1),
            kind: JobKind::Extract,
            target: JobTarget::Source(SourceId::new(1)),
            args: None,
            status,
            attempts: 1,
            error_kind: None,
            error: None,
            created_at: 0,
            updated_at: 0,
            started_at: None,
            finished_at: None,
            waiting_for: None,
            needs: None,
        }
    }

    fn transcript(text: &str) -> Document {
        Document {
            blocks: vec![Block {
                kind: BlockKind::Segment,
                text: text.into(),
                anchor: Anchor::Time {
                    start_ms: 0,
                    end_ms: 1_000,
                },
            }],
            ..Document::default()
        }
    }

    type Part = (PartContent, Vec<Job>, Option<Document>);

    fn message(role: MessageRole, text: &str, parts: Vec<Part>) -> ChatMessage {
        let version = MessageVersion {
            id: VersionId::new(1),
            number: 1,
            origin: VersionOrigin::Typed,
            instruction: None,
            status: MessageStatus::Complete,
            text: text.into(),
            based_on: None,
            created_at: 0,
        };
        ChatMessage {
            id: MessageId::new(1),
            session_id: SessionId::new(1),
            role,
            status: MessageStatus::Complete,
            reply_to: None,
            thread_root: None,
            recording_ms: None,
            recorded_in: None,
            created_at: 0,
            citations: Vec::new(),
            reply: None,
            active_version: (!text.is_empty()).then_some(version.id),
            versions: if text.is_empty() {
                Vec::new()
            } else {
                vec![version]
            },
            parts: parts
                .into_iter()
                .enumerate()
                .map(|(id, (content, jobs, document))| MessagePart {
                    id: PartId::new(id as i64),
                    content,
                    jobs,
                    document,
                    thread: ThreadSummary::default(),
                })
                .collect(),
        }
    }

    #[test]
    fn the_markers_of_cited_sources_are_not_part_of_the_conversation() {
        let mut cited = message(
            MessageRole::User,
            "Mitochondria power the cell [1].",
            Vec::new(),
        );
        cited.citations = vec![Citation {
            marker: 1,
            source_id: Some(SourceId::new(3)),
            source_name: "biology.pdf".into(),
            anchor: Anchor::Page { page: 1 },
            quote: "mitochondria".into(),
        }];
        let conversation = Conversation::from_messages(&[cited]);
        assert_eq!(conversation.turns[0].text, "Mitochondria power the cell.");
    }

    #[test]
    fn brackets_in_a_message_without_citations_are_kept() {
        let conversation = Conversation::from_messages(&[message(
            MessageRole::User,
            "why is a[0] not a[1]?",
            Vec::new(),
        )]);
        assert_eq!(conversation.turns[0].text, "why is a[0] not a[1]?");
    }

    #[test]
    fn messages_carry_their_text_and_what_was_read_from_each_file() {
        let conversation = Conversation::from_messages(&[message(
            MessageRole::User,
            "  can you explain this? ",
            vec![
                (
                    PartContent {
                        source_id: Some(SourceId::new(3)),
                        name: "lecture 4.mp3".into(),
                        kind: SourceKind::Audio,
                    },
                    vec![read(JobStatus::Succeeded)],
                    Some(transcript("Today: the Krebs cycle.")),
                ),
                (
                    PartContent {
                        source_id: None,
                        name: "notes.pdf".into(),
                        kind: SourceKind::Pdf,
                    },
                    vec![read(JobStatus::Failed)],
                    None,
                ),
            ],
        )]);
        assert_eq!(
            conversation.render(ROOMY),
            "<message role=\"user\">\ncan you explain this?\n\
             <attachment name=\"lecture 4.mp3\">\nToday: the Krebs cycle.\n</attachment>\n\
             <attachment name=\"notes.pdf\">\n</attachment>\n</message>\n"
        );
    }

    #[test]
    fn a_file_not_read_yet_still_counts_as_something_to_read() {
        let conversation = Conversation::from_messages(&[message(
            MessageRole::User,
            "",
            vec![(
                PartContent {
                    source_id: Some(SourceId::new(1)),
                    name: "talk.mp3".into(),
                    kind: SourceKind::Audio,
                },
                vec![read(JobStatus::Running)],
                None,
            )],
        )]);
        assert!(!conversation.is_empty());
        assert!(Conversation::from_messages(&[message(MessageRole::User, "", vec![])]).is_empty());
    }

    #[test]
    fn a_long_conversation_keeps_its_first_and_latest_messages() {
        let messages: Vec<_> = (1..=10)
            .map(|n| message(MessageRole::User, &format!("message {n}"), vec![]))
            .collect();
        let one = Conversation::from_messages(&messages[..1]).render(ROOMY);
        let budget = Budget {
            total: one.chars().count() * 3 + 2,
            ..ROOMY
        };
        let rendered = Conversation::from_messages(&messages).render(budget);
        assert!(rendered.starts_with("<message role=\"user\">\nmessage 1\n"));
        assert!(rendered.contains("<omitted messages=\"7\"/>"));
        assert!(rendered.contains("message 9\n") && rendered.ends_with("message 10\n</message>\n"));
        assert!(!rendered.contains("message 8\n"));
    }
}
