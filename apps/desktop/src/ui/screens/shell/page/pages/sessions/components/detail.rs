//! The side panel for one attached file: what it is, a larger look at it, the text read
//! from it block by block with where each block is in the file, and the jobs that read it,
//! with their timings.
//!
//! Each block of read text can be corrected in place, such as a word a transcript misheard;
//! search and answers then use the correction.

use super::super::ids;
use super::nothing_read;
use crate::features::jobs::job_label;
use crate::features::media::{AttachmentInfo, MediaPreview, file_summary};
use crate::ui::screens::shell::AppShell;
use crate::ui::screens::shell::page::pages::components::{
    cited_blocks, cited_start, code_block, file_tile, job_controls, job_status, named_field, panel,
    status_icon,
};
use crate::ui::screens::shell::page::pages::media_list::{is_page, page_picture};
use gpui_kit::assets::IconName;
use gpui_kit::component::input::{Textarea, TextareaState};
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, Sizable as _, button::ButtonVariants as _,
};
use gpui_kit::{
    AnyElement, AppContext as _, Context, Entity, InteractiveElement as _, IntoElement, ObjectFit,
    ParentElement as _, SharedString, StatefulInteractiveElement as _, Styled as _,
    StyledImage as _, Window, div, img,
};
use study_app::views::{Anchor, Block, Document, Job};
use study_core::{SourceId, SourceKind};
use study_localization::{Locale, Message, ago, anchor_label, job_duration, text};
use study_ui::{button, icon_button, units};

/// Width of the panel, before scaling.
const PANEL_WIDTH: f32 = 400.;
/// Most blocks of read text drawn; the rest is reached by copying.
const MAX_BLOCKS: usize = 400;
/// The hover group of a block of read text, which shows its correct button.
const BLOCK: &str = "read-block";

/// The block of read text being corrected, if any, and the field it is corrected in.
pub(in crate::ui::screens::shell::page) struct CorrectionState {
    open: Option<Correcting>,
    field: Entity<TextareaState>,
}

/// One block being corrected.
struct Correcting {
    source_id: SourceId,
    /// The block's place in its document, counting blank blocks.
    ordinal: usize,
    /// The block's text as it was shown, so a read that replaced it meanwhile is not
    /// overwritten.
    before: String,
    saving: bool,
    error: Option<Message>,
}

impl CorrectionState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        Self {
            open: None,
            field: cx.new(|cx| TextareaState::new(window, cx)),
        }
    }

    fn editing(&self, source_id: SourceId, ordinal: usize) -> Option<&Correcting> {
        self.open
            .as_ref()
            .filter(|open| open.source_id == source_id && open.ordinal == ordinal)
    }
}

impl AppShell {
    /// Opens block `ordinal` of a file's read text for correction, closing any other.
    fn start_correction(
        &mut self,
        source_id: SourceId,
        ordinal: usize,
        before: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let correction = &mut self.sessions.correction;
        if correction.open.as_ref().is_some_and(|open| open.saving) {
            return;
        }
        let value = before.trim().to_owned();
        correction.field.update(cx, |field, cx| {
            field.set_value(value, window, cx);
            field.focus(window, cx);
        });
        correction.open = Some(Correcting {
            source_id,
            ordinal,
            before,
            saving: false,
            error: None,
        });
        cx.notify();
    }

    fn cancel_correction(&mut self, cx: &mut Context<Self>) {
        let correction = &mut self.sessions.correction;
        if correction.open.as_ref().is_some_and(|open| !open.saving) {
            correction.open = None;
            cx.notify();
        }
    }

    /// Saves the open correction, then reloads the session to show it.
    fn save_correction(&mut self, cx: &mut Context<Self>) {
        let Some(session_id) = self.sessions.session_id() else {
            return;
        };
        let after = self.sessions.correction.field.read(cx).value().to_string();
        let Some(open) = self
            .sessions
            .correction
            .open
            .as_mut()
            .filter(|open| !open.saving)
        else {
            return;
        };
        if after.trim() == open.before.trim() {
            self.sessions.correction.open = None;
            cx.notify();
            return;
        }
        open.saving = true;
        open.error = None;
        let (source_id, ordinal, before) = (open.source_id, open.ordinal, open.before.clone());
        cx.notify();
        self.background(
            move |app| app.correct_block(source_id, ordinal, &before, &after),
            move |view, result, cx| {
                let correction = &mut view.sessions.correction;
                let error = match result {
                    Ok(true) => None,
                    // The block was read again meanwhile, so the correction would undo that.
                    Ok(false) => Some(Message::CorrectionStale),
                    Err(error) => {
                        crate::features::errors::report(&error);
                        Some(Message::CorrectionError)
                    }
                };
                match error {
                    None => correction.open = None,
                    Some(error) => {
                        if let Some(open) = correction.open.as_mut() {
                            open.saving = false;
                            open.error = Some(error);
                        }
                    }
                }
                view.reload_session(session_id, cx);
            },
            cx,
        );
    }
}

/// Everything the panel shows about one file.
pub(in crate::ui::screens::shell::page::pages::sessions) struct Detail<'a> {
    pub source_id: SourceId,
    pub name: &'a str,
    pub kind: SourceKind,
    pub info: Option<&'a AttachmentInfo>,
    /// The jobs that read it, oldest first.
    pub jobs: Vec<&'a Job>,
    /// What was read from it, once it was.
    pub document: Option<&'a Document>,
    /// The block of it being corrected, if any.
    pub correction: &'a CorrectionState,
    /// The place a citation opened it at: its blocks start there, marked.
    pub cited: Option<&'a Anchor>,
    /// The text before the cited place shows too.
    pub cited_earlier: bool,
    /// The time now, which the jobs' times are told against.
    pub now: i64,
}

/// The side panel for one file, revealed beside the conversation.
pub(in crate::ui::screens::shell::page::pages::sessions) fn detail_panel(
    detail: Detail<'_>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> super::Panel {
    let unit = units(cx);
    let colors = cx.theme().colors;
    // The title bar shows the panel's header, with its close button, above the panel.
    let title = study_ui::PageHeader::new(text(locale, Message::FileDetails))
        .icon(IconName::Info)
        .action(
            icon_button(
                ids::DETAIL_CLOSE,
                text(locale, Message::ClosePanel),
                IconName::X,
                cx,
            )
            .on_click(cx.listener(|this, _, _, cx| this.close_panel(cx))),
        );
    let open = div().flex().child(
        button(ids::DETAIL_OPEN, text(locale, Message::OpenOriginal), cx)
            .icon(study_ui::icon(IconName::FolderOpen))
            .on_click({
                let id = detail.source_id;
                cx.listener(move |this, _, _, cx| {
                    this.open_original(id, |view| &mut view.sessions.error, cx)
                })
            }),
    );
    let body = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(unit(18.))
        .p(unit(16.))
        .children(preview(&detail, locale, cx))
        .child(open)
        .children(
            detail
                .document
                .map(|document| document_section(document, &detail, locale, cx)),
        )
        .child(results_section(&detail, locale, cx));
    let panel = div()
        .w(unit(PANEL_WIDTH))
        .flex_none()
        .h_full()
        .flex()
        .flex_col()
        .border_l_1()
        .border_color(colors.border)
        .bg(colors.background)
        .child(file_header(&detail, locale, cx))
        .child(
            div()
                .id(ids::DETAIL_SCROLL)
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .child(body),
        );
    super::reveal(panel, title, PANEL_WIDTH, cx)
}

/// The file's kind as a tile beside its name, with its type and size under the name.
fn file_header(detail: &Detail<'_>, locale: Locale, cx: &mut Context<AppShell>) -> gpui_kit::Div {
    let unit = units(cx);
    let colors = cx.theme().colors;
    div()
        .flex_none()
        .w_full()
        .px(unit(16.))
        .py(unit(12.))
        .flex()
        .items_center()
        .gap(unit(10.))
        .border_b_1()
        .border_color(colors.border)
        .child(file_tile(detail.kind, 38., cx))
        .child(
            div()
                .min_w_0()
                .flex_1()
                .flex()
                .flex_col()
                .child(
                    div()
                        .w_full()
                        .text_ellipsis()
                        .whitespace_nowrap()
                        .font_weight(gpui_kit::FontWeight::MEDIUM)
                        .child(SharedString::from(detail.name.to_owned())),
                )
                .child(
                    div()
                        .w_full()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(colors.muted_foreground)
                        .child(SharedString::from(file_summary(
                            detail.name,
                            detail.info.map(|info| info.size_bytes),
                            locale,
                        ))),
                ),
        )
}

/// How tall the panel's picture of a file is.
const PREVIEW_HEIGHT: f32 = 240.;

/// A larger look at the file itself: an image, or the start of its text; `None` for a file
/// with neither.
fn preview(detail: &Detail<'_>, locale: Locale, cx: &mut Context<AppShell>) -> Option<AnyElement> {
    let unit = units(cx);
    match &detail.info?.preview {
        // On the fill tile: a photo fills it, a rendered page sits on it as framed paper, so a
        // white page still reads on the light theme's white.
        MediaPreview::Image { path, .. } => Some(
            div()
                .relative()
                .w_full()
                .h(unit(PREVIEW_HEIGHT))
                .rounded(unit(study_ui::scale::RADIUS_LG))
                .overflow_hidden()
                .bg(study_ui::palette(cx).fill)
                .child(if is_page(detail.kind) {
                    page_picture(path.clone(), PREVIEW_HEIGHT, cx).into_any_element()
                } else {
                    img(path.clone())
                        .size_full()
                        .object_fit(ObjectFit::Contain)
                        .into_any_element()
                })
                .into_any_element(),
        ),
        MediaPreview::Text(snippet) => Some(section(
            text(locale, Message::DetailPreview),
            None,
            code_block(snippet.trim(), cx),
            cx,
        )),
        MediaPreview::Unavailable => None,
    }
}

/// The jobs that read the file, or that none has yet.
fn results_section(detail: &Detail<'_>, locale: Locale, cx: &mut Context<AppShell>) -> AnyElement {
    let unit = units(cx);
    let content = if detail.jobs.is_empty() {
        div()
            .text_size(unit(study_ui::scale::TEXT_SMALL))
            .text_color(cx.theme().colors.muted_foreground)
            .child(text(locale, Message::DetailNoResults))
            .into_any_element()
    } else {
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(14.))
            .children(
                detail
                    .jobs
                    .iter()
                    .map(|job| job_section(job, detail, locale, cx)),
            )
            .into_any_element()
    };
    section(text(locale, Message::DetailResults), None, content, cx)
}

/// A titled group in the panel.
fn section(
    title: &'static str,
    trailing: Option<AnyElement>,
    content: impl IntoElement,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(unit(8.))
        .child(
            div()
                .w_full()
                .flex()
                .items_center()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .font_weight(gpui_kit::FontWeight::MEDIUM)
                .text_color(cx.theme().colors.muted_foreground)
                .child(div().flex_1().child(title))
                .children(trailing),
        )
        .child(content)
        .into_any_element()
}

/// The text read from the file, block by block, each with where in the file it is.
fn document_section(
    document: &Document,
    detail: &Detail<'_>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let read = document.text();
    if read.trim().is_empty() {
        return section(
            text(locale, Message::DetailOutput),
            None,
            div()
                .text_size(unit(study_ui::scale::TEXT_SMALL))
                .text_color(colors.muted_foreground)
                .child(text(locale, nothing_read(detail.kind))),
            cx,
        );
    }
    let copy_button = icon_button(
        (ids::DETAIL_COPY, detail.source_id.get() as u64),
        text(locale, Message::CopyText),
        IconName::Copy,
        cx,
    )
    .on_click(cx.listener(move |this, _, _, cx| this.copy_text(read.clone(), cx)))
    .into_any_element();
    // A citation opened it: the cited passage comes first, marked, with a way to the top.
    let cited = cited_blocks(&document.blocks, detail.cited);
    let start = cited_start(&document.blocks, detail.cited).filter(|_| !detail.cited_earlier);
    let mut blocks = Vec::new();
    if start.is_some() {
        blocks.push(
            div()
                .child(
                    button(
                        (ids::DETAIL_FROM_START, detail.source_id.get() as u64),
                        text(locale, Message::ShowFromStart),
                        cx,
                    )
                    .ghost()
                    .small()
                    .icon(IconName::ArrowUp)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.sessions.cited_earlier = true;
                        cx.notify();
                    })),
                )
                .into_any_element(),
        );
    }
    // Ordinals count blank blocks too: they are the blocks' places in the document.
    for (ordinal, block) in document
        .blocks
        .iter()
        .enumerate()
        .skip(start.unwrap_or(0))
        .filter(|(_, block)| !block.text.trim().is_empty())
        .take(MAX_BLOCKS)
    {
        let editing = detail.correction.editing(detail.source_id, ordinal);
        let row = block_row(block, ordinal, editing, detail, locale, cx);
        let marked = cited.contains(&ordinal);
        blocks.push(if marked {
            div()
                .px(unit(8.))
                .py(unit(6.))
                .rounded(unit(study_ui::scale::RADIUS_MD))
                // The cited passage, washed in the highlighter as its citation is.
                .bg(study_ui::palette(cx).highlighter_wash)
                .child(row)
                .into_any_element()
        } else {
            row
        });
    }
    section(
        text(locale, Message::DetailOutput),
        Some(copy_button),
        div()
            .w_full()
            .px(unit(12.))
            .py(unit(10.))
            .flex()
            .flex_col()
            .gap(unit(8.))
            .rounded(unit(study_ui::scale::RADIUS_MD))
            .bg(colors.secondary.opacity(0.35))
            .children(blocks),
        cx,
    )
}

/// One block of read text with where in the file it is: a button to correct it, or, while
/// it is being corrected, the field to do it in.
fn block_row(
    block: &Block,
    ordinal: usize,
    editing: Option<&Correcting>,
    detail: &Detail<'_>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let source_id = detail.source_id;
    let place = div()
        .flex_none()
        .w(unit(72.))
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(colors.muted_foreground)
        .children(anchor_label(locale, &block.anchor).map(SharedString::from));
    let row = div().w_full().flex().gap(unit(10.)).child(place);
    // File in the high half, block in the low, so no two blocks' buttons share an id.
    let id = (source_id.get() as u64) << 32 | ordinal as u64;

    let Some(editing) = editing else {
        let before = block.text.clone();
        let correct = icon_button(
            (ids::DETAIL_CORRECT, id),
            text(locale, Message::CorrectText),
            IconName::SquarePen,
            cx,
        )
        .on_click(cx.listener(move |this, _, window, cx| {
            this.start_correction(source_id, ordinal, before.clone(), window, cx)
        }));
        return row
            .group(BLOCK)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .text_size(unit(study_ui::scale::TEXT_UI))
                    .line_height(unit(22.))
                    .whitespace_normal()
                    .child(SharedString::from(block.text.trim().to_owned())),
            )
            .child(
                div()
                    .flex_none()
                    .invisible()
                    .group_hover(BLOCK, |style| style.visible())
                    .child(correct),
            )
            .into_any_element();
    };

    let saving = editing.saving;
    let field = div()
        .flex_1()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(unit(8.))
        .child(named_field(
            ids::CORRECTION,
            text(locale, Message::CorrectText),
            Textarea::new(&detail.correction.field)
                .h(unit(120.))
                .disabled(saving)
                .aria_label(text(locale, Message::CorrectText)),
        ))
        .child(
            div()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(colors.muted_foreground)
                .whitespace_normal()
                .child(text(locale, Message::CorrectionHint)),
        )
        .children(editing.error.map(|error| {
            div()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(cx.theme().colors.danger)
                .whitespace_normal()
                .child(text(locale, error))
        }))
        .child(
            div()
                .flex()
                .justify_end()
                .gap(unit(8.))
                .child(
                    button(
                        (ids::DETAIL_CANCEL_CORRECTION, id),
                        text(locale, Message::Cancel),
                        cx,
                    )
                    .ghost()
                    .disabled(saving)
                    .on_click(cx.listener(|this, _, _, cx| this.cancel_correction(cx))),
                )
                .child(
                    button(
                        (ids::DETAIL_SAVE_CORRECTION, id),
                        text(locale, Message::Save),
                        cx,
                    )
                    .primary()
                    .disabled(saving)
                    .on_click(cx.listener(|this, _, _, cx| this.save_correction(cx))),
                ),
        );
    row.child(field).into_any_element()
}

/// One job that read the file.
fn job_section(
    job: &Job,
    detail: &Detail<'_>,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let (icon, tint, status) = job_status(job, Some(detail.kind), locale, &colors);
    let job_id = job.id;

    let mut facts = Vec::new();
    facts.push((Message::DetailAttempts, job.attempts.to_string()));
    if let Some(started) = job.started_at {
        facts.push((Message::DetailStarted, ago(locale, detail.now - started)));
    }
    if let Some((started, finished)) = job.started_at.zip(job.finished_at) {
        facts.push((Message::DetailTook, job_duration(finished - started)));
    }

    let key = job_id.get() as u64;
    let actions = div()
        .flex()
        .items_center()
        .gap(unit(8.))
        .children(job_controls(
            ((ids::DETAIL_STOP, key), (ids::DETAIL_RETRY, key)),
            job,
            (AppShell::stop_job, AppShell::retry_job),
            locale,
            cx,
        ));

    let block = panel(cx)
        .w_full()
        .p(unit(12.))
        .gap(unit(10.))
        .child(
            div()
                .w_full()
                .flex()
                .items_center()
                .gap(unit(8.))
                .child(status_icon(job.status, icon, tint, unit(16.)))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .font_weight(gpui_kit::FontWeight::MEDIUM)
                        .child(text(locale, job_label(job.kind, Some(detail.kind)))),
                )
                .child(
                    div()
                        .flex_none()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(colors.muted_foreground)
                        .child(status),
                ),
        )
        .child(
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(unit(3.))
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .children(facts.into_iter().map(|(label, value)| {
                    div()
                        .w_full()
                        .flex()
                        .justify_between()
                        .child(
                            div()
                                .text_color(colors.muted_foreground)
                                .child(text(locale, label)),
                        )
                        .child(SharedString::from(value))
                })),
        );

    block.child(actions).into_any_element()
}
