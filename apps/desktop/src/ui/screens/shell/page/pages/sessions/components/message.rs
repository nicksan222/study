//! One entry of the notebook: a note in plain body prose with its files, or an answer from
//! `@study` under a faint "Study" label, in words with citation chips or as the study
//! material or practice a tool made. When it was written and what can be done with it (copy,
//! answer again, delete) stay out of the way: on the timeline they appear in the margin to
//! the right while the entry is hovered; in a thread, the moment shows under it.

use super::super::ids;
use super::{Attached, ThreadLink, marked_note, source_card};
use crate::features::jobs::Problem;
use crate::features::media::AttachmentInfo;
use crate::ui::screens::shell::AppShell;
use crate::ui::screens::shell::page::pages::components::{
    ChatGptState, OnCite, citation_chip, job_problem_parts, job_status, prose, prose_citing,
};
use gpui_kit::assets::IconName;
use gpui_kit::component::{
    ActiveTheme as _, Sizable as _,
    button::{Button, ButtonVariants as _},
};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    AnyElement, Context, Div, InteractiveElement as _, IntoElement, ParentElement as _,
    Styled as _, div,
};
use std::collections::{HashMap, HashSet};
use study_app::views::{ChatMessage, Job, JobStatus, MessageRole, MessageStatus, PartContent};
use study_core::{JobId, MessageId, PartId, SourceId};
use study_localization::{Locale, Message, joined, text};
use study_ui::{Note, button, icon_button, units};

/// The margin to the right of the notebook's column, in units, where an entry's time and
/// actions appear while it is hovered. The composer keeps the same margin, so it lines up
/// with the notes.
pub(in crate::ui::screens::shell::page::pages::sessions) const META_GUTTER: f32 = 96.;

/// One entry: a note with its files, each folding what was read from it; or an answer. On
/// the timeline each file links to its thread; `open_thread` is the one shown beside it.
pub(in crate::ui::screens::shell::page::pages::sessions) fn message_row(
    message: &ChatMessage,
    locale: Locale,
    expanded: &HashSet<JobId>,
    attachments: &HashMap<SourceId, AttachmentInfo>,
    open_thread: Option<PartId>,
    marks: RowMarks,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let content = if message.role == MessageRole::Assistant {
        answer_content(message, marks.chatgpt, locale, cx)
    } else {
        note_content(message, expanded, attachments, open_thread, locale, cx)
    };
    let unit = units(cx);
    let shown =
        marks.keyboard || marks.deleting == Some(message.id) || marks.copied == Some(message.id);
    let actions = actions(message, locale, marks, shown, cx);
    if message.thread_root.is_some() {
        // In a narrow thread: the moment stays under the entry, since no day label names
        // it; the actions show beside it on hover.
        return div()
            .group(ROW)
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .child(content)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_XS))
                    .child(sent_at(message, locale, cx))
                    .child(actions),
            )
            .into_any_element();
    }
    // The margin comes first, drawn on the right: the keyboard reaches an entry's actions
    // before the files and folds inside it, in reading order.
    div()
        .group(ROW)
        .w_full()
        .flex()
        .flex_row_reverse()
        .items_start()
        .child(
            div()
                .flex_none()
                .w(unit(META_GUTTER))
                .pl(unit(study_ui::scale::SPACE_SM))
                .flex()
                .flex_col()
                .items_end()
                .child(reveal_on_hover(
                    div()
                        .h(unit(24.))
                        .flex()
                        .items_center()
                        .child(sent_at(message, locale, cx)),
                    shown,
                ))
                .child(actions),
        )
        .child(content)
        .into_any_element()
}

/// What a note says, its files, and where in the session's recording it was written.
fn note_content(
    message: &ChatMessage,
    expanded: &HashSet<JobId>,
    attachments: &HashMap<SourceId, AttachmentInfo>,
    open_thread: Option<PartId>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Div {
    let mut content = column(cx);
    if !message.text().is_empty() {
        let (shown, marks) = marked_note(message.text());
        content = content.child(Note::new(shown).marks(marks));
    }
    for part in &message.parts {
        let PartContent {
            source_id,
            name,
            kind,
        } = &part.content;
        // The file's line, and right under it what was read from it, folded.
        let job = part.jobs.last();
        content = content.child(source_card(
            Attached {
                part: part.id,
                source_id: *source_id,
                name,
                kind: *kind,
                info: source_id.and_then(|id| attachments.get(&id)),
                job,
                document: part.document.as_ref(),
                expanded: job.is_some_and(|job| expanded.contains(&job.id)),
                whole: false,
                // Threads hang off the timeline only.
                thread: message.thread_root.is_none().then_some(ThreadLink {
                    summary: part.thread,
                    open: open_thread == Some(part.id),
                }),
            },
            locale,
            cx,
        ));
    }
    content.children(recording_link(message, locale, cx))
}

/// The column an entry's content is set in, at the notebook's full width.
fn column(cx: &gpui_kit::App) -> Div {
    div()
        .flex_1()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(units(cx)(study_ui::scale::SPACE_XXS))
}

/// What the transcript marks on a row: the message whose deletion waits for a
/// confirmation, and the one just copied.
#[derive(Clone, Copy, Debug, Default)]
pub(in crate::ui::screens::shell::page::pages::sessions) struct RowMarks {
    pub(in crate::ui::screens::shell::page::pages::sessions) deleting: Option<MessageId>,
    pub(in crate::ui::screens::shell::page::pages::sessions) copied: Option<MessageId>,
    /// Whether the learner is moving through the page by keyboard: then every entry shows
    /// its time and actions, as a hovered one does, so focus never lands on something
    /// unseen.
    pub(in crate::ui::screens::shell::page::pages::sessions) keyboard: bool,
    /// The ChatGPT sign-in, for an answer held up by it.
    pub(in crate::ui::screens::shell::page::pages::sessions) chatgpt: ChatGptState,
}

/// The group every message row is, so its time and actions show while it is hovered.
const ROW: &str = "message-row";

/// `element`, hidden until its row is hovered, or shown while `shown` (a deletion waits
/// for its answer, or the words were just copied).
fn reveal_on_hover(element: Div, shown: bool) -> Div {
    element
        .opacity(if shown { 1. } else { 0. })
        .group_hover(ROW, |style| style.opacity(1.))
}

/// A row's action button, hidden like [`reveal_on_hover`] until its row is hovered, and
/// shown too while the keyboard is on it, so tabbing never lands on something invisible.
fn revealed(button: Button, shown: bool) -> Button {
    button
        .opacity(if shown { 1. } else { 0. })
        .group_hover(ROW, |style| style.opacity(1.))
        .focus_visible(|style| style.opacity(1.))
}

/// What can be done with a message: copy its words, ask a finished answer again, delete it.
fn actions(
    message: &ChatMessage,
    locale: Locale,
    marks: RowMarks,
    shown: bool,
    cx: &mut Context<AppShell>,
) -> Div {
    let id = message.id;
    let words = crate::features::sessions::message_words(message);
    let copy = (!words.is_empty()).then(|| {
        let words = words.clone();
        let copied = marks.copied == Some(id);
        icon_button(
            (ids::COPY_MESSAGE, id.get() as u64),
            text(
                locale,
                if copied {
                    Message::MaterialCopied
                } else {
                    Message::CopyText
                },
            ),
            if copied {
                IconName::Check
            } else {
                IconName::Copy
            },
            cx,
        )
        .xsmall()
        .map(|button| revealed(button, shown))
        .on_click(cx.listener(move |this, _, _, cx| {
            this.copy_text(words.clone(), cx);
            this.sessions.copied = Some(id);
            cx.notify();
        }))
    });
    // A finished answer in words can be asked for again.
    let again = (message.role == MessageRole::Assistant
        && message.status == MessageStatus::Complete
        && !words.is_empty())
    .then(|| {
        icon_button(
            (ids::REANSWER, id.get() as u64),
            text(locale, Message::AnswerAgain),
            IconName::RotateCw,
            cx,
        )
        .xsmall()
        .map(|button| revealed(button, shown))
        .on_click(cx.listener(move |this, _, _, cx| this.reanswer(id, cx)))
    });
    div()
        .flex()
        .items_center()
        .text_color(study_ui::palette(cx).faint)
        .children(copy)
        .children(again)
        .child(
            icon_button(
                (ids::DELETE_MESSAGE, id.get() as u64),
                text(locale, Message::DeleteMessage),
                IconName::Trash,
                cx,
            )
            .xsmall()
            .map(|button| revealed(button, shown))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.sessions.deleting = Some(id);
                cx.notify();
            })),
        )
}

/// When a message was sent, as a faint caption: the time on the timeline, whose day labels
/// name the day, and the day too in a thread.
fn sent_at(message: &ChatMessage, locale: Locale, cx: &Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    div()
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(study_ui::palette(cx).faint)
        .whitespace_nowrap()
        .child({
            let when = if message.thread_root.is_none() {
                crate::features::clock::time_of_day(message.created_at)
            } else {
                crate::features::clock::moment(locale, message.created_at)
            };
            // A note written during a recording says where in it, to find it in the audio;
            // once the recording is posted, a link says so instead.
            match message
                .recording_ms
                .filter(|_| message.recorded_in.is_none())
            {
                Some(ms) => joined(&[when, study_localization::recording_moment(locale, ms)]),
                None => when,
            }
        })
        .into_any_element()
}

/// Where in the session's recording a note was written, as a quiet link that opens the
/// recording's transcript at that minute; `None` until the recording is posted.
fn recording_link(
    message: &ChatMessage,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Option<AnyElement> {
    let (Some(ms), Some(file)) = (message.recording_ms, message.recorded_in) else {
        return None;
    };
    let unit = units(cx);
    Some(
        div()
            .flex()
            .child(
                button(
                    (ids::RECORDING_LINK, message.id.get() as u64),
                    study_localization::recording_moment(locale, ms),
                    cx,
                )
                .ghost()
                .xsmall()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(study_ui::palette(cx).faint)
                .icon(IconName::Mic)
                .on_click(cx.listener(move |this, _, window, cx| {
                    let at = study_app::views::Anchor::Time {
                        start_ms: ms,
                        end_ms: ms + 1,
                    };
                    let name = study_localization::recording_moment(locale, ms);
                    this.open_cited(file, name, at, window, cx)
                })),
            )
            .into_any_element(),
    )
}

/// An answer: a faint "Study" label, then its words in plain body prose with the passages
/// it cites as chips; or how writing it is going.
fn answer_content(
    message: &ChatMessage,
    chatgpt: ChatGptState,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Div {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let mut content = column(cx).gap(unit(study_ui::scale::SPACE_XS)).child(
        div()
            .h(unit(24.))
            .flex()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .text_size(unit(study_ui::scale::TEXT_CAPTION))
            .text_color(palette.faint)
            .child(study_ui::icon(IconName::Sparkles).size(unit(12.)))
            .child(text(locale, Message::AnswerAuthor)),
    );
    if message.status != MessageStatus::Complete {
        // An answer being written again keeps its old words, faded, until the new ones land.
        let earlier = Some(message.text()).filter(|body| !body.is_empty());
        // An answer that failed, or is still being written, can be deleted too, stopping it.
        content = content.children(
            message
                .reply
                .as_ref()
                .map(|job| reply_line(job, chatgpt, locale, cx)),
        );
        if let Some(body) = earlier {
            content = content.child(answer_text(cx).opacity(0.45).child(prose(body, cx)));
        }
        return content;
    }
    if !message.text().is_empty() {
        let cite = cite_handler(message, cx);
        let id = (ids::ANSWER_TEXT, message.id.get() as u64);
        content = content.child(answer_text(cx).child(prose_citing(
            message.text(),
            Some((id.into(), cite)),
            cx,
        )));
    }
    if !message.citations.is_empty() {
        content = content.child(citations(message, locale, cx));
    }
    content
}

/// The column an answer's words are set in: no bubble, the notebook's full width.
fn answer_text(cx: &gpui_kit::App) -> Div {
    div()
        .w_full()
        .min_w_0()
        .text_color(cx.theme().colors.foreground)
}

/// What clicking a marker such as `[2]` in an answer's words does: opens the passage that
/// citation points at, as its chip under the answer would.
fn cite_handler(message: &ChatMessage, cx: &mut Context<AppShell>) -> OnCite {
    let shell = cx.entity().downgrade();
    let cited: Vec<_> = message
        .citations
        .iter()
        .filter_map(|citation| {
            let source = citation.source_id?;
            Some((
                citation.marker,
                source,
                citation.source_name.clone(),
                citation.anchor.clone(),
            ))
        })
        .collect();
    std::rc::Rc::new(move |marker, window, cx| {
        let Some((_, source, name, anchor)) = cited.iter().find(|(m, ..)| *m == marker) else {
            return;
        };
        let (source, name, anchor) = (*source, name.clone(), anchor.clone());
        shell
            .update(cx, |this, cx| {
                this.open_cited(source, name, anchor, window, cx)
            })
            .ok();
    })
}

/// The passages an answer cites, as chips under its words: each names its source and
/// place, and opens the source there.
fn citations(message: &ChatMessage, locale: Locale, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let mut chips = div()
        .w_full()
        .flex()
        .flex_wrap()
        .gap(unit(study_ui::scale::SPACE_XS));
    for citation in &message.citations {
        let id = (
            ids::ANSWER_CITATION,
            (message.id.get() as u64) << 16 | u64::from(citation.marker),
        );
        chips = chips.child(citation_chip(
            id,
            citation,
            AppShell::open_cited,
            locale,
            cx,
        ));
    }
    chips.into_any_element()
}

/// How writing an answer is going, as one quiet line; once it failed or stopped, what went
/// wrong in the danger colour and a way to start it again.
fn reply_line(
    job: &Job,
    chatgpt: ChatGptState,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let colors = cx.theme().colors;
    let job_id = job.id;
    let (icon, _, status) = job_status(job, None, locale, &colors);
    let has_problem = matches!(job.status, JobStatus::Failed | JobStatus::Waiting);
    let mut line = div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XS))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(palette.faint);
    if !has_problem {
        // A problem says what needs attention instead, below.
        line = super::attachment::running_words(line, job, icon, status, cx);
    }
    if job.status.is_stopped() || job.status == JobStatus::Waiting {
        let explanation = has_problem.then(|| Problem::of_job(job).explanation());
        line = line.children(job_problem_parts(
            (
                (ids::RETRY_JOB, job_id.get() as u64),
                (ids::ANSWER_SETTINGS, job_id.get() as u64),
            ),
            job,
            chatgpt,
            explanation,
            AppShell::retry_job,
            locale,
            cx,
        ));
    }
    line.into_any_element()
}
