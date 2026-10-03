//! An attached file in the notebook: one line with its kind, name and size, its open and
//! preview buttons showing on hover; under it, the work done on it folded into one faint
//! line ("Transcribed · 8 min") that opens to the text in an inset, or how that work is
//! going. On the timeline a last faint line opens the file's thread once it holds replies.

use super::super::ids;
use crate::features::clock::now;
use crate::features::jobs::{Problem, elapsed};
use crate::features::media::{AttachmentInfo, file_summary};
use crate::ui::screens::shell::AppShell;
use crate::ui::screens::shell::page::pages::components::{
    file_tile, job_status, retry_button, status_icon,
};
use gpui_kit::assets::IconName;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{
    Sizable as _,
    button::{Button, ButtonVariants as _},
};
use gpui_kit::{
    AnyElement, Context, InteractiveElement as _, IntoElement, ParentElement as _, Role,
    SharedString, StatefulInteractiveElement as _, Styled as _, div, prelude::FluentBuilder as _,
};
use study_app::views::{Document, Job, JobKind, JobStatus, ThreadSummary};
use study_core::processing::{ExtractorKind, first_extractor};
use study_core::{JobId, PartId, SourceId, SourceKind};
use study_localization::{Locale, Message, ago, joined, reply_count, status_with_duration, text};
use study_ui::{button, icon_button, units};

/// One attached file, as its message shows it.
pub(in crate::ui::screens::shell::page::pages::sessions) struct Attached<'a> {
    pub part: PartId,
    /// `None` once the file was deleted from the Library.
    pub source_id: Option<SourceId>,
    pub name: &'a str,
    pub kind: SourceKind,
    /// `None` while the preview is still being made.
    pub info: Option<&'a AttachmentInfo>,
    /// The latest read of the file, if it is read at all.
    pub job: Option<&'a Job>,
    pub document: Option<&'a Document>,
    /// Whether the user opened the fold with what was read.
    pub expanded: bool,
    /// What was read, always open: the file heads its thread.
    pub whole: bool,
    /// The file's thread, when the file is on the timeline.
    pub thread: Option<ThreadLink>,
}

/// An attachment's thread, as its file on the timeline links to it.
#[derive(Clone, Copy)]
pub(in crate::ui::screens::shell::page::pages::sessions) struct ThreadLink {
    pub summary: ThreadSummary,
    /// Whether the side panel shows this thread.
    pub open: bool,
}

/// The group a file's line is, so its buttons show while it is hovered.
const FILE: &str = "attachment-line";

/// Height of a file's line, in units.
const LINE_HEIGHT: f32 = 36.;

/// One attachment: its line, the fold with what was read from it, and its thread's line.
/// Clicking the line shows the file's details in the side panel.
pub(in crate::ui::screens::shell::page::pages::sessions) fn source_card(
    attached: Attached<'_>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let read_text = attached
        .job
        .filter(|job| job.status == JobStatus::Succeeded)
        .and(attached.document)
        .map(Document::text)
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty());
    div()
        .w_full()
        .min_w_0()
        .flex()
        .flex_col()
        .when(attached.source_id.is_none(), |this| this.opacity(0.6))
        .child(file_line(&attached, locale, cx))
        .children(
            attached
                .job
                .map(|job| work_fold(job, &attached, read_text, locale, cx)),
        )
        .children(
            attached
                .thread
                .filter(|link| link.summary.replies > 0)
                .map(|link| thread_line(attached.part, link, locale, cx)),
        )
        .into_any_element()
}

/// The file on one line: its kind's glyph, its name, then its kind and size; open, preview
/// and, on the timeline before anyone replied, reply show while the line is hovered.
fn file_line(attached: &Attached<'_>, locale: Locale, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let part = attached.part;
    let subtitle: SharedString = if attached.source_id.is_none() {
        text(locale, Message::FileRemovedFromLibrary).into()
    } else {
        file_summary(
            attached.name,
            attached.info.map(|info| info.size_bytes),
            locale,
        )
        .into()
    };
    let open_thread = attached.thread.is_some_and(|link| link.open);
    let reply = attached
        .thread
        .filter(|link| link.summary.replies == 0)
        .map(|_| {
            icon_button(
                (ids::OPEN_THREAD, part.get() as u64),
                text(locale, Message::ReplyInThread),
                IconName::Reply,
                cx,
            )
            .xsmall()
            .on_click(cx.listener(move |this, _, window, cx| {
                cx.stop_propagation();
                this.open_thread(part, window, cx)
            }))
        });
    let buttons = attached.source_id.map(|id| {
        vec![
            icon_button(
                (ids::OPEN_ATTACHMENT, part.get() as u64),
                text(locale, Message::OpenOriginal),
                IconName::ExternalLink,
                cx,
            )
            .xsmall()
            .on_click(cx.listener(move |this, _, _, cx| {
                cx.stop_propagation();
                this.open_original(id, |view| &mut view.sessions.error, cx)
            })),
            icon_button(
                (ids::ATTACHMENT_DETAILS, part.get() as u64),
                text(locale, Message::ViewDetails),
                IconName::PanelRight,
                cx,
            )
            .xsmall()
            .on_click(cx.listener(move |this, _, _, cx| {
                cx.stop_propagation();
                this.show_attachment(id, cx)
            })),
        ]
    });
    div()
        .id((ids::ATTACHMENT, part.get() as u64))
        .test_support()
        .aria_label(attached.name.to_owned())
        .group(FILE)
        .min_w_0()
        // Reaches out by its padding, so the glyph lines up with the notes' text.
        .mx(-unit(study_ui::scale::SPACE_XS))
        .h(unit(LINE_HEIGHT))
        .px(unit(study_ui::scale::SPACE_XS))
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XS))
        .rounded(unit(study_ui::scale::RADIUS_MD))
        .when(open_thread, |this| this.bg(palette.active))
        .child(file_tile(attached.kind, 16., cx))
        .child(
            div()
                .min_w_0()
                .text_ellipsis()
                .whitespace_nowrap()
                .text_size(unit(study_ui::scale::TEXT_UI))
                .text_color(palette.foreground)
                .child(SharedString::from(attached.name.to_owned())),
        )
        .child(
            div()
                .min_w_0()
                .text_ellipsis()
                .whitespace_nowrap()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(palette.faint)
                .child(subtitle),
        )
        .child(div().flex_1())
        .child(
            div()
                .flex_none()
                .flex()
                .items_center()
                .gap(unit(study_ui::scale::SPACE_XXS))
                .children(
                    reply
                        .into_iter()
                        .chain(buttons.into_iter().flatten())
                        .map(|button| revealed(button, open_thread)),
                ),
        )
        .when_some(attached.source_id, |this, id| {
            this.role(Role::Button)
                .cursor_pointer()
                .hover(|style| style.bg(palette.hover))
                .on_click(cx.listener(move |this, _, _, cx| this.show_attachment(id, cx)))
        })
        .into_any_element()
}

/// A file line's button, hidden until the line is hovered, or shown while `shown` (its
/// thread is open); the keyboard on it shows it too, so tabbing never lands on something
/// invisible.
fn revealed(button: Button, shown: bool) -> Button {
    button
        .opacity(if shown { 1. } else { 0. })
        .group_hover(FILE, |style| style.opacity(1.))
        .focus_visible(|style| style.opacity(1.))
}

/// Opens the file's thread once it holds replies: how many, and when the latest came.
fn thread_line(
    part: PartId,
    link: ThreadLink,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let palette = study_ui::palette(cx);
    let ThreadSummary {
        replies,
        last_reply_at,
    } = link.summary;
    let mut label = vec![reply_count(locale, replies)];
    label.extend(last_reply_at.map(|at| ago(locale, now() - at)));
    quiet_line(
        button((ids::OPEN_THREAD, part.get() as u64), joined(&label), cx)
            .icon(study_ui::icon(IconName::Reply))
            .text_color(if link.open {
                palette.muted
            } else {
                palette.faint
            })
            .on_click(cx.listener(move |this, _, window, cx| {
                cx.stop_propagation();
                this.open_thread(part, window, cx)
            })),
        cx,
    )
}

/// A faint caption button on its own line, as the fold and the thread lines are.
fn quiet_line(line: Button, cx: &Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    div()
        .flex()
        .child(
            line.ghost()
                .xsmall()
                .text_size(unit(study_ui::scale::TEXT_CAPTION)),
        )
        .into_any_element()
}

/// The work done on the file, folded into one faint line: what was done and how long it
/// took, opening to the text in an inset; or how it is going, or what went wrong.
fn work_fold(
    job: &Job,
    attached: &Attached<'_>,
    read_text: Option<String>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let kind = attached.kind;
    let file_removed = attached.source_id.is_none();
    let job_id = job.id;
    let fold = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(unit(study_ui::scale::SPACE_XXS));
    match job.status {
        JobStatus::Succeeded => {
            let done = done_line(job, kind, locale);
            let Some(read) = read_text else {
                // Nothing to open: say why on the line itself. A read that ran and found
                // nothing needs the learner, so it takes the danger colour; a skipped one
                // (switched off, or the file went) stays quiet.
                let read_nothing = attached.document.is_some();
                let why = no_text(read_nothing, file_removed, kind);
                let failed = read_nothing && !file_removed;
                let color = if failed {
                    palette.danger
                } else {
                    palette.faint
                };
                // A file read for nothing says what to do, as Activity does; a silent
                // recording just says so.
                let why = match (failed && why == Message::NothingRead, kind) {
                    (true, SourceKind::Image) => Message::NoTextInPhoto,
                    (true, _) => Message::ProblemNotReadable,
                    (false, _) => why,
                };
                // A failure says only what went wrong: "Read · 5 s" would contradict it.
                let words = if failed {
                    text(locale, why).to_owned()
                } else {
                    joined(&[done, text(locale, why).to_owned()])
                };
                let glyph = failed.then_some((IconName::CircleAlert, palette.danger));
                return fold
                    .child(state_line(glyph, words, color, cx))
                    .into_any_element();
            };
            let open = attached.expanded || attached.whole;
            let header = if attached.whole {
                // Always open in the thread: nothing to fold, so no button.
                faint_words(done, cx)
            } else {
                quiet_line(
                    button((ids::EXPAND_JOB, job_id.get() as u64), done, cx)
                        .icon(study_ui::icon(if open {
                            IconName::ChevronDown
                        } else {
                            IconName::ChevronRight
                        }))
                        .text_color(palette.faint)
                        .on_click(cx.listener(move |this, _, _, cx| this.toggle_job(job_id, cx))),
                    cx,
                )
            };
            fold.child(header)
                .when(open, |this| {
                    this.child(read_inset(read, job_id, locale, cx))
                })
                .into_any_element()
        }
        JobStatus::Failed => {
            let reason = if file_removed {
                Message::FileRemovedFromLibrary
            } else {
                // The raw error is one click away, in the details panel.
                Problem::of_job(job).explanation()
            };
            let line = div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(unit(study_ui::scale::SPACE_XS))
                .px(unit(study_ui::scale::SPACE_XS))
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .child(glyph_slot(
                    Some((IconName::CircleAlert, palette.danger)),
                    cx,
                ))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_color(palette.danger)
                        .whitespace_normal()
                        .child(text(locale, reason)),
                )
                .when(!file_removed, |this| {
                    this.child(
                        retry_button(
                            (ids::RETRY_JOB, job_id.get() as u64),
                            job,
                            AppShell::retry_job,
                            locale,
                            cx,
                        )
                        .ghost()
                        .xsmall(),
                    )
                });
            fold.child(line).into_any_element()
        }
        JobStatus::Cancelled => {
            let (_, _, status) = job_status(job, Some(kind), locale, &cx_colors(cx));
            fold.child(
                state_line(
                    Some((IconName::Square, palette.faint)),
                    status.to_string(),
                    palette.faint,
                    cx,
                )
                .child(
                    retry_button(
                        (ids::RETRY_JOB, job_id.get() as u64),
                        job,
                        AppShell::retry_job,
                        locale,
                        cx,
                    )
                    .ghost()
                    .xsmall(),
                ),
            )
            .into_any_element()
        }
        JobStatus::Blocked | JobStatus::Waiting | JobStatus::Queued | JobStatus::Running => {
            let (icon, _, status) = job_status(job, Some(kind), locale, &cx_colors(cx));
            fold.child(
                div()
                    .flex()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_XS))
                    .px(unit(study_ui::scale::SPACE_XS))
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(palette.faint)
                    .map(|line| running_words(line, job, icon, status, cx)),
            )
            .into_any_element()
        }
    }
}

/// A job's state on a quiet line: while it runs, its words with the highlight sweeping
/// through them; while it waits, its icon and plain words.
pub(in crate::ui::screens::shell::page::pages::sessions) fn running_words(
    line: gpui_kit::Div,
    job: &Job,
    icon: IconName,
    status: gpui_kit::SharedString,
    cx: &Context<AppShell>,
) -> gpui_kit::Div {
    let unit = units(cx);
    if job.status == JobStatus::Running {
        // The slot the waiting icon and the finished chevron take, kept empty, so the words
        // start in the same place before, during and after.
        line.child(glyph_slot(None, cx))
            .child(study_ui::Shimmer::new(
                (ids::JOB_SHIMMER, job.id.get() as u64),
                status,
            ))
    } else {
        let faint = study_ui::palette(cx).faint;
        line.child(status_icon(job.status, icon, faint, unit(12.)))
            .child(status)
    }
}

/// The theme's colours, for the shared job helpers that take them.
fn cx_colors(cx: &Context<AppShell>) -> gpui_kit::component::ThemeColor {
    use gpui_kit::component::ActiveTheme as _;
    cx.theme().colors
}

/// A fold line in one of its states: the 12px glyph slot the chevron takes when it is
/// finished (an alert when it failed, a stop square when stopped, empty while it runs), then
/// its words in `color`. Every state starts its words at the same place.
fn state_line(
    glyph: Option<(IconName, gpui_kit::Hsla)>,
    words: String,
    color: gpui_kit::Hsla,
    cx: &Context<AppShell>,
) -> gpui_kit::Div {
    let unit = units(cx);
    div()
        .flex()
        .items_center()
        .gap(unit(study_ui::scale::SPACE_XS))
        .px(unit(study_ui::scale::SPACE_XS))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .child(glyph_slot(glyph, cx))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_color(color)
                .whitespace_normal()
                .child(words),
        )
}

/// The 12px place at the start of a fold line, with `glyph` in it or empty.
fn glyph_slot(glyph: Option<(IconName, gpui_kit::Hsla)>, cx: &Context<AppShell>) -> gpui_kit::Div {
    let unit = units(cx);
    div()
        .flex_none()
        .w(unit(12.))
        .flex()
        .items_center()
        .justify_center()
        .children(glyph.map(|(name, color)| study_ui::icon(name).size(unit(12.)).text_color(color)))
}

/// Words on a faint caption line, aligned with the fold's button text.
fn faint_words(words: String, cx: &Context<AppShell>) -> AnyElement {
    caption_words(words, study_ui::palette(cx).faint, cx)
}

/// Words on a caption line in `color`, aligned with the fold's button text.
fn caption_words(words: String, color: gpui_kit::Hsla, cx: &Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    div()
        .px(unit(study_ui::scale::SPACE_XS))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(color)
        .whitespace_normal()
        .child(words)
        .into_any_element()
}

/// What a finished read did, and how long it took when that is worth saying: "Transcribed
/// · 8 min 8 s", "Read · 3 s".
fn done_line(job: &Job, kind: SourceKind, locale: Locale) -> String {
    let done = text(locale, done_word(job.kind, kind));
    match elapsed(job, now()).filter(|&seconds| seconds > 0) {
        Some(seconds) => status_with_duration(done, seconds),
        None => done.to_owned(),
    }
}

/// The word for finished work on a file of `kind`: a recording is transcribed, anything
/// else read.
fn done_word(job: JobKind, kind: SourceKind) -> Message {
    match (job, first_extractor(kind)) {
        (JobKind::Extract, Some(ExtractorKind::Transcription)) => Message::WorkTranscribed,
        (JobKind::Extract, _) => Message::WorkRead,
        _ => Message::StatusFinished,
    }
}

/// The opened fold: the transcript or recognized text in an inset, with a way to copy it.
fn read_inset(
    output: String,
    job_id: JobId,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let palette = study_ui::palette(cx);
    let copy_value = output.clone();
    div()
        .w_full()
        .flex()
        .items_start()
        .gap(unit(study_ui::scale::SPACE_XS))
        .p(unit(study_ui::scale::SPACE_MD))
        .rounded(unit(study_ui::scale::RADIUS_MD))
        .bg(palette.fill)
        .child(
            study_ui::body_text(cx)
                .flex_1()
                .min_w_0()
                .text_color(palette.foreground)
                .whitespace_normal()
                .child(SharedString::from(output)),
        )
        .child(
            icon_button(
                (ids::COPY_JOB, job_id.get() as u64),
                text(locale, Message::CopyText),
                IconName::Copy,
                cx,
            )
            .xsmall()
            .on_click(cx.listener(move |this, _, _, cx| this.copy_text(copy_value.clone(), cx))),
        )
        .into_any_element()
}

/// Why a read that ended well shows no text. A read done without a document was skipped,
/// as the file went or reading its kind of file is switched off; with one, the file had
/// nothing to read.
fn no_text(read: bool, file_removed: bool, kind: SourceKind) -> Message {
    match (read, file_removed) {
        (true, _) => nothing_read(kind),
        (false, true) => Message::FileRemovedFromLibrary,
        (false, false) => Message::ReadingSwitchedOff,
    }
}

/// What to say when reading a file of `kind` found nothing: no speech in a recording, else
/// no text.
pub(in crate::ui::screens::shell::page::pages::sessions) fn nothing_read(
    kind: SourceKind,
) -> Message {
    if matches!(kind, SourceKind::Audio | SourceKind::Video) {
        Message::NoSpeechDetected
    } else {
        Message::NothingRead
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A read skipped because its step is switched off says so, not that the file was silent.
    #[test]
    fn a_read_without_a_document_was_skipped_not_empty() {
        assert_eq!(
            no_text(false, false, SourceKind::Audio),
            Message::ReadingSwitchedOff
        );
        assert_eq!(
            no_text(false, true, SourceKind::Audio),
            Message::FileRemovedFromLibrary
        );
        assert_eq!(
            no_text(true, false, SourceKind::Audio),
            Message::NoSpeechDetected
        );
        assert_eq!(no_text(true, true, SourceKind::Pdf), Message::NothingRead);
    }

    /// The fold names what was done: a recording was transcribed, a page read.
    #[test]
    fn finished_work_is_named_for_what_it_did() {
        assert_eq!(
            done_word(JobKind::Extract, SourceKind::Audio),
            Message::WorkTranscribed
        );
        assert_eq!(
            done_word(JobKind::Extract, SourceKind::Pdf),
            Message::WorkRead
        );
        assert_eq!(
            done_word(JobKind::Index, SourceKind::Pdf),
            Message::StatusFinished
        );
    }
}
