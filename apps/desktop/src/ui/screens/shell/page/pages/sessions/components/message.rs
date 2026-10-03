//! One entry of the notebook: a note in plain body prose with its files, or an answer from
//! `@study` under a faint "Study" label, in words with citation chips or as the study
//! material or practice a tool made. When it was written and what can be done with it (copy,
//! answer again, delete) stay out of the way: on the timeline they appear in the margin to
//! the right while the entry is hovered or has focus; in a thread, they make one line under
//! it.

use super::super::ids;
use super::versions::{VersionsState, action_bar, edit_box, version_line};
use super::{Attached, ThreadLink, marked_note, source_card};
use crate::features::media::AttachmentInfo;
use crate::ui::screens::shell::AppShell;
use crate::ui::screens::shell::page::pages::components::{
    ChatGptState, OnCite, citation_chip, job_status, prose, prose_citing, sign_in_line,
    stopped_line_parts,
};
use gpui_kit::assets::IconName;
use gpui_kit::component::{ActiveTheme as _, Sizable as _, button::ButtonVariants as _};
use gpui_kit::{
    AnyElement, Context, Div, InteractiveElement as _, IntoElement, ParentElement as _,
    Styled as _, div,
};
use std::collections::{HashMap, HashSet};
use study_app::views::{ChatMessage, Job, MessageRole, PartContent};
use study_core::{JobId, MessageId, PartId, SourceId};
use study_localization::{Locale, Message, joined, text};
use study_ui::{Note, button, units};

/// The margin to the right of the notebook's column, in units, where an entry's time and
/// actions appear while it is hovered. The composer keeps the same margin, so it lines up
/// with the notes.
pub(in crate::ui::screens::shell::page::pages::sessions) const META_GUTTER: f32 = 168.;

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
    let versions = marks.versions;
    let editing = versions.editing(message.id);
    let content = if message.role == MessageRole::Assistant {
        answer_content(message, marks.chatgpt, marks.versions, locale, cx)
    } else {
        note_content(
            message,
            expanded,
            attachments,
            open_thread,
            marks,
            locale,
            cx,
        )
    };
    let unit = units(cx);
    let shown = marks.deleting == Some(message.id)
        || marks.copied == Some(message.id)
        || marks.focused == Some(message.id)
        || versions.menu == Some(message.id);
    let bar = (!editing).then(|| {
        action_bar(
            message,
            locale,
            marks.copied == Some(message.id),
            shown,
            ROW,
            versions,
            cx,
        )
    });
    if message.thread_root.is_some() {
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
                    .children(bar),
            )
            .into_any_element();
    }
    div()
        .group(ROW)
        .w_full()
        .flex()
        .flex_row()
        .items_start()
        .child(content)
        .child(
            div()
                .relative()
                .flex_none()
                .w(unit(META_GUTTER))
                .h(unit(0.))
                .child(
                    div()
                        .absolute()
                        .top(unit(0.))
                        .left(unit(study_ui::scale::SPACE_MD))
                        .flex()
                        .flex_col()
                        .items_start()
                        .child(reveal_on_hover(
                            div()
                                .h(unit(24.))
                                .flex()
                                .items_center()
                                .child(sent_at(message, locale, cx)),
                            shown,
                        ))
                        // The glyphs, not their hit areas, line up with the time.
                        .children(bar.map(|bar| div().ml(unit(-6.)).child(bar))),
                ),
        )
        .into_any_element()
}

/// What a note says, its files, and where in the session's recording it was written.
fn note_content(
    message: &ChatMessage,
    expanded: &HashSet<JobId>,
    attachments: &HashMap<SourceId, AttachmentInfo>,
    open_thread: Option<PartId>,
    marks: RowMarks,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> Div {
    let (versions, chatgpt) = (marks.versions, marks.chatgpt);
    let mut content = column(cx);
    if versions.editing(message.id) {
        content = content.child(edit_box(message, locale, versions, cx));
    } else if !message.text().is_empty() {
        let (shown, marks) = marked_note(message.text());
        content = content.child(Note::new(shown).marks(marks));
    }
    content = content.children(version_line(message, locale, versions, cx));
    if message.unfinished().is_some() {
        content = content.children(
            message
                .reply
                .as_ref()
                .map(|job| reply_line(job, chatgpt, locale, cx)),
        );
    }
    for part in &message.parts {
        let PartContent {
            source_id,
            name,
            kind,
        } = &part.content;
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
/// confirmation, the one just copied, and their versions.
#[derive(Clone, Copy)]
pub(in crate::ui::screens::shell::page::pages::sessions) struct RowMarks<'a> {
    pub(in crate::ui::screens::shell::page::pages::sessions) deleting: Option<MessageId>,
    pub(in crate::ui::screens::shell::page::pages::sessions) copied: Option<MessageId>,
    /// The ChatGPT sign-in, for an answer held up by it.
    pub(in crate::ui::screens::shell::page::pages::sessions) chatgpt: ChatGptState,
    /// What the entries' versions are doing: edits, menus and switchers.
    pub(in crate::ui::screens::shell::page::pages::sessions) versions: &'a VersionsState,
    /// The entry whose action bar has focus inside it: its bar shows, so the keyboard sees
    /// where it is.
    pub(in crate::ui::screens::shell::page::pages::sessions) focused: Option<MessageId>,
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
    versions: &VersionsState,
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
    if versions.editing(message.id) {
        return content.child(edit_box(message, locale, versions, cx));
    }
    if message.unfinished().is_some() {
        // An answer being written again keeps its newest words, faded, until the new ones
        // land; an older version the student stepped to stays as it is.
        let earlier = Some(message.text()).filter(|body| !body.is_empty());
        let replaced = VersionsState::shows_latest(message) && VersionsState::is_writing(message);
        if let Some(body) = earlier {
            let text = answer_text(cx).child(prose(body, cx));
            content = content.child(if replaced { text.opacity(0.45) } else { text });
        }
        content = content.children(version_line(message, locale, versions, cx));
        // An answer that failed, or is still being written, can be deleted too, stopping it.
        content = content.children(
            message
                .reply
                .as_ref()
                .map(|job| reply_line(job, chatgpt, locale, cx)),
        );
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
    content = content.children(version_line(message, locale, versions, cx));
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
    let mut line = div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XS))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(palette.faint);
    if let Some(parts) = sign_in_line(job, chatgpt, locale, cx) {
        return line.children(parts).into_any_element();
    }
    if job.status.is_stopped() {
        return line
            .children(stopped_line_parts(
                (ids::RETRY_JOB, job_id.get() as u64),
                job,
                AppShell::retry_job,
                locale,
                cx,
            ))
            .into_any_element();
    }
    line = super::attachment::running_words(line, job, icon, status, cx);
    line.into_any_element()
}
