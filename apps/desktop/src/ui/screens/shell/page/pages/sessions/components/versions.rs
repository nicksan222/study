//! The versions of a note or an answer: the switcher under it, the quiet bar of what can be
//! done with it, the AI edit menu, and editing its words in place.
//!
//! An entry keeps every version of its words (see `study_app::views::MessageVersion`). The
//! switcher names the finished version on screen and steps through the others; a version
//! being written is told apart from them, as "Writing…" or "Failed", and cannot be stepped to.

use super::super::ids;
use crate::ui::screens::shell::AppShell;
use crate::ui::screens::shell::page::pages::components::named_field;
use gpui_kit::assets::IconName;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::component::popover::Popover;
use gpui_kit::component::{Disableable as _, Selectable, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    Anchor, AnyElement, App, AppContext as _, Context, Entity, FocusHandle, Hsla,
    InteractiveElement as _, IntoElement, KeyDownEvent, ParentElement as _, Pixels, RenderOnce,
    StatefulInteractiveElement as _, Styled as _, Subscription, Window, div,
};
use std::collections::{HashMap, HashSet};
use study_app::views::{
    Asked, ChatMessage, MessageRole, MessageStatus, MessageVersion, Rewrite, VersionOrigin,
};
use study_core::text::title_from;
use study_core::{MessageId, VersionId};
use study_localization::{Locale, Message, review_progress, text};
use study_ui::{MenuItem, button, icon_button, palette, units};

const LEFT: &str = "left";
const RIGHT: &str = "right";
const ESCAPE: &str = "escape";

/// Most characters of an instruction the switcher names its version by.
const INSTRUCTION_CHARS: usize = 24;
/// How wide the AI edit menu is, in units.
const MENU_WIDTH: f32 = 280.;

/// The focus an entry's controls keep, so the keyboard and the pointer meet in the same
/// places.
pub(in crate::ui::screens::shell::page::pages::sessions) struct EntryFocus {
    /// The action bar: while focus is inside it, it shows.
    pub(in crate::ui::screens::shell::page::pages::sessions) bar: FocusHandle,
    /// The AI edit button's place: the menu gives focus back to it when it closes.
    pub(in crate::ui::screens::shell::page::pages::sessions) ai: FocusHandle,
    /// The switcher: a click on an arrow leaves focus here, so the arrow keys keep stepping.
    pub(in crate::ui::screens::shell::page::pages::sessions) switcher: FocusHandle,
}

/// What the sessions page remembers about versions: which entry is being edited or has its AI
/// edit menu open, the instruction being written, and what the switchers should say.
pub(in crate::ui::screens::shell::page) struct VersionsState {
    /// The entry whose words are being edited in place, and whether the edit is being saved.
    editing: Option<(MessageId, bool)>,
    pub(in crate::ui::screens::shell::page::pages::sessions) edit_field: Entity<TextareaState>,
    /// The entry whose AI edit menu is open.
    pub(in crate::ui::screens::shell::page::pages::sessions) menu: Option<MessageId>,
    pub(in crate::ui::screens::shell::page::pages::sessions) instruction: Entity<InputState>,
    /// Why the last request on an entry did nothing, shown under it.
    notice: Option<(MessageId, Message)>,
    pub(in crate::ui::screens::shell::page::pages::sessions) focus: HashMap<MessageId, EntryFocus>,
    /// Entries where a version finished while an older one was on screen.
    fresh: HashSet<MessageId>,
    /// How many finished versions each entry had when last loaded.
    finished: HashMap<MessageId, usize>,
    _subscriptions: [Subscription; 2],
}

impl VersionsState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        let edit_field = cx.new(|cx| TextareaState::new(window, cx));
        let instruction = cx.new(|cx| InputState::new(window, cx));
        let edited =
            cx.subscribe_in(
                &edit_field,
                window,
                |this, _, event: &InputEvent, _, cx| match event {
                    InputEvent::PressEnter {
                        secondary: true, ..
                    } => this.save_edit(cx),
                    InputEvent::Change => cx.notify(),
                    _ => {}
                },
            );
        let instructed = cx.subscribe_in(
            &instruction,
            window,
            |this, _, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { .. } => this.run_instruction(window, cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            },
        );
        Self {
            editing: None,
            edit_field,
            menu: None,
            instruction,
            notice: None,
            focus: HashMap::new(),
            fresh: HashSet::new(),
            finished: HashMap::new(),
            _subscriptions: [edited, instructed],
        }
    }

    /// The entry with focus inside its action bar, if any. The bar shows while it has, so a
    /// control reached by Tab is seen and its ring is not hidden with it.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn focused_bar(
        &self,
        window: &Window,
        cx: &App,
    ) -> Option<MessageId> {
        self.focus
            .iter()
            .find(|(_, focus)| focus.bar.contains_focused(window, cx))
            .map(|(id, _)| *id)
    }

    /// Whether `id` has its words being edited.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn editing(
        &self,
        id: MessageId,
    ) -> bool {
        self.editing.is_some_and(|(editing, _)| editing == id)
    }

    /// Takes in messages just loaded: an entry whose version finished while an older one is on
    /// screen gets the "new version" cue, and each entry gets the focus places its controls
    /// keep.
    pub(in crate::ui::screens::shell::page) fn observe(
        &mut self,
        messages: &[ChatMessage],
        cx: &mut Context<AppShell>,
    ) {
        for message in messages {
            self.focus.entry(message.id).or_insert_with(|| EntryFocus {
                bar: cx.focus_handle(),
                ai: cx.focus_handle().tab_stop(true),
                switcher: cx.focus_handle(),
            });
            let finished = message
                .versions
                .iter()
                .filter(|version| version.status == MessageStatus::Complete)
                .count();
            let before = self.finished.insert(message.id, finished);
            let latest = message
                .versions
                .iter()
                .rev()
                .find(|version| version.status == MessageStatus::Complete)
                .map(|version| version.id);
            if message.active_version == latest {
                self.fresh.remove(&message.id);
            } else if before.is_some_and(|before| finished > before) {
                self.fresh.insert(message.id);
            }
        }
    }

    /// Whether a version is being written: waiting, queued or running. One that failed or was
    /// stopped is not.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn is_writing(
        message: &ChatMessage,
    ) -> bool {
        message.unfinished().is_some()
            && message
                .reply
                .as_ref()
                .is_some_and(|job| !job.status.is_stopped())
    }

    /// Whether the version on screen is the newest finished one: the one a new version will
    /// replace.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn shows_latest(
        message: &ChatMessage,
    ) -> bool {
        message
            .versions
            .iter()
            .rev()
            .find(|version| version.status == MessageStatus::Complete)
            .map(|version| version.id)
            == message.active_version
    }
}

/// Which version the switcher shows, how many there are, and where its arrows go.
#[derive(Debug, Eq, PartialEq)]
struct Position {
    /// Counting from 1.
    shown: usize,
    /// Every version, the one being written included.
    total: usize,
    previous: Option<VersionId>,
    next: Option<VersionId>,
}

/// The switcher's position for `message`: the finished version on screen among all of its
/// versions; `None` when it has fewer than two. A version being written is the last one and
/// is not stepped to.
fn position(message: &ChatMessage) -> Option<Position> {
    let versions = &message.versions;
    let total = versions.len();
    if total < 2 {
        return None;
    }
    let shown = message
        .active_version
        .and_then(|id| versions.iter().position(|version| version.id == id))?;
    let finished = |at: usize| {
        versions
            .get(at)
            .filter(|version| version.status == MessageStatus::Complete)
            .map(|version| version.id)
    };
    Some(Position {
        shown: shown + 1,
        total,
        previous: shown.checked_sub(1).and_then(finished),
        next: finished(shown + 1),
    })
}

/// What made a version, in a word, or the instruction it followed, cut short.
fn origin_label(version: &MessageVersion, locale: Locale) -> String {
    let message = match version.origin {
        VersionOrigin::Typed => Message::VersionOriginTyped,
        VersionOrigin::Edited => Message::VersionOriginEdited,
        VersionOrigin::Answer => Message::VersionOriginAnswer,
        VersionOrigin::Improve => Message::VersionOriginImproved,
        VersionOrigin::Summarize => Message::VersionOriginSummarized,
        VersionOrigin::Instruction => {
            return title_from(
                version.instruction.as_deref().unwrap_or_default(),
                INSTRUCTION_CHARS,
            )
            .unwrap_or_default();
        }
    };
    text(locale, message).to_owned()
}

/// What a version still being written is called: how its job is going.
fn writing_label(message: &ChatMessage, locale: Locale) -> String {
    use study_app::views::JobStatus;
    let message = match message.reply.as_ref().map(|job| job.status) {
        Some(JobStatus::Failed) => Message::VersionFailed,
        Some(JobStatus::Cancelled) => Message::StatusStopped,
        _ => Message::VersionWriting,
    };
    text(locale, message).to_owned()
}

/// What shows under an entry's words: the switcher between its versions when it has two or
/// more, naming the finished one on screen, with a small "Writing…" beside it while a new one
/// is written and a cue when one finished meanwhile; and why a request did nothing. `None` when
/// there is neither.
pub(in crate::ui::screens::shell::page::pages::sessions) fn version_line(
    message: &ChatMessage,
    locale: Locale,
    versions: &VersionsState,
    cx: &mut Context<AppShell>,
) -> Option<AnyElement> {
    let id = message.id;
    let mid = id.get() as u64;
    let unit = units(cx);
    let palette = palette(cx);
    let notice = versions
        .notice
        .filter(|(noticed, _)| *noticed == id)
        .map(|(_, notice)| notice);
    let switch_focus = versions.focus.get(&id).map(|focus| focus.switcher.clone());
    let switcher = position(message).map(|position| {
        let label = message
            .versions
            .get(position.shown - 1)
            .map(|version| origin_label(version, locale))
            .unwrap_or_default();
        let (previous, next) = (position.previous, position.next);
        let arrow = |name: &'static str,
                     tip: Message,
                     icon: IconName,
                     step: Option<VersionId>,
                     cx: &mut Context<AppShell>| {
            let focus = switch_focus.clone();
            icon_button((name, mid), text(locale, tip), icon, cx)
                .xsmall()
                .disabled(step.is_none())
                .when_some(step, |button, version| {
                    button.on_click(cx.listener(move |this, _, window, cx| {
                        // A click leaves focus on the switcher, so the arrow keys go on
                        // stepping.
                        if let Some(focus) = &focus {
                            window.focus(focus, cx);
                        }
                        this.step_version(id, version, cx)
                    }))
                })
        };
        div()
            .id((ids::VERSION_SWITCHER, mid))
            .test_support()
            .aria_label(text(locale, Message::VersionSwitcher))
            .when_some(switch_focus.as_ref(), |line, focus| line.track_focus(focus))
            // The arrow's glyph, not its hit area, lines up with the words above.
            .ml(unit(-6.))
            .flex()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .text_size(unit(study_ui::scale::TEXT_CAPTION))
            .text_color(palette.faint)
            .whitespace_nowrap()
            .on_key_down(cx.listener(move |this, event: &KeyDownEvent, _, cx| {
                let step = match event.keystroke.key.as_str() {
                    LEFT => previous,
                    RIGHT => next,
                    _ => None,
                };
                if let Some(version) = step {
                    this.step_version(id, version, cx);
                    cx.stop_propagation();
                }
            }))
            .child(arrow(
                ids::VERSION_PREVIOUS,
                Message::VersionPrevious,
                IconName::ChevronLeft,
                previous,
                cx,
            ))
            .child(review_progress(locale, position.shown, position.total))
            .child(arrow(
                ids::VERSION_NEXT,
                Message::VersionNext,
                IconName::ChevronRight,
                next,
                cx,
            ))
            .child(label)
            .when(versions.fresh.contains(&id), |line| {
                line.child(
                    div()
                        .text_color(palette.muted)
                        .child(text(locale, Message::VersionNew)),
                )
            })
    });
    let writing = switcher
        .is_some()
        .then(|| message.unfinished().map(|_| writing_label(message, locale)))
        .flatten();
    if switcher.is_none() && notice.is_none() {
        return None;
    }
    Some(
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_x(unit(study_ui::scale::SPACE_SM))
            .children(switcher)
            .children(writing.map(|writing| {
                div()
                    .id((ids::VERSION_WRITING, mid))
                    .test_support()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(palette.muted)
                    .child(writing)
            }))
            .children(notice.map(|notice| {
                div()
                    .id((ids::VERSION_NOTICE, mid))
                    .test_support()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(palette.muted)
                    .child(text(locale, notice))
            }))
            .into_any_element(),
    )
}

/// What an entry's action bar offers, in the order it shows them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::ui::screens::shell::page::pages::sessions) enum Action {
    AiEdit,
    Regenerate,
    Edit,
    Copy,
    Stop,
    Delete,
}

/// What can be done with `message`: rewriting needs words (or, for a note, a read file) to
/// rewrite. While a version is written the words can only be copied, and the version stopped
/// or the entry deleted; one that failed or was stopped does not count (trying again is in the
/// line under the words).
pub(in crate::ui::screens::shell::page::pages::sessions) fn actions_of(
    message: &ChatMessage,
) -> Vec<Action> {
    let words = !message.text().trim().is_empty();
    // Only a version still queued, running or waiting holds the entry back: Edit and AI edit
    // would race it. One that failed or was stopped leaves the bar to the finished version on
    // screen; starting anything drops it.
    if VersionsState::is_writing(message) {
        let mut actions = Vec::new();
        if words {
            actions.push(Action::Copy);
        }
        actions.push(Action::Stop);
        actions.push(Action::Delete);
        return actions;
    }
    let readable = message.role == MessageRole::User
        && message.parts.iter().any(|part| {
            part.document
                .as_ref()
                .is_some_and(|document| !document.text().trim().is_empty())
        });
    let rewritable = words || readable;
    let mut actions = Vec::new();
    if rewritable {
        actions.push(Action::AiEdit);
    }
    if message.role == MessageRole::Assistant && words {
        actions.push(Action::Regenerate);
    }
    if rewritable {
        actions.push(Action::Edit);
    }
    if words {
        actions.push(Action::Copy);
    }
    actions.push(Action::Delete);
    actions
}

/// The action bar of an entry, with an icon button for each thing that can be done with it.
/// The caller places it. It shows while the pointer is over the entry (`group`), while focus
/// is inside it, or while `shown`.
pub(in crate::ui::screens::shell::page::pages::sessions) fn action_bar(
    message: &ChatMessage,
    locale: Locale,
    copied: bool,
    shown: bool,
    group: &'static str,
    versions: &VersionsState,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let id = message.id;
    let mid = id.get() as u64;
    let palette = palette(cx);
    let words = crate::features::sessions::message_words(message);
    let job = message.reply.as_ref().map(|job| job.id);
    let mut bar = div()
        .id((ids::ACTION_BAR, mid))
        .flex()
        .items_center()
        .text_color(palette.faint)
        .opacity(if shown { 1. } else { 0. })
        .group_hover(group, |style| style.opacity(1.));
    if let Some(focus) = versions.focus.get(&id) {
        bar = bar.track_focus(&focus.bar);
    }
    for action in actions_of(message) {
        let button = match action {
            Action::AiEdit => ai_edit(message, locale, versions, cx),
            Action::Regenerate => icon_button(
                (ids::REANSWER, mid),
                text(locale, Message::Regenerate),
                IconName::RotateCw,
                cx,
            )
            .on_click(cx.listener(move |this, _, _, cx| this.reanswer(id, cx)))
            .into_any_element(),
            Action::Edit => {
                let words = message.text().to_owned();
                icon_button(
                    (ids::EDIT_MESSAGE, mid),
                    text(locale, Message::EditMessage),
                    IconName::SquarePen,
                    cx,
                )
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.start_edit(id, words.clone(), window, cx)
                }))
                .into_any_element()
            }
            Action::Copy => {
                let words = words.clone();
                icon_button(
                    (ids::COPY_MESSAGE, mid),
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
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.copy_text(words.clone(), cx);
                    this.sessions.copied = Some(id);
                    cx.notify();
                }))
                .into_any_element()
            }
            Action::Stop => icon_button(
                (ids::STOP_VERSION, mid),
                text(locale, Message::StopVersion),
                IconName::Square,
                cx,
            )
            .when_some(job, |button, job| {
                button.on_click(cx.listener(move |this, _, _, cx| this.stop_job(job, cx)))
            })
            .into_any_element(),
            Action::Delete => icon_button(
                (ids::DELETE_MESSAGE, mid),
                text(locale, Message::DeleteMessage),
                IconName::Trash,
                cx,
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                this.sessions.deleting = Some(id);
                cx.notify();
            }))
            .into_any_element(),
        };
        bar = bar.child(button);
    }
    bar.into_any_element()
}

/// The AI edit button inside the place that keeps its focus: the popover opened from a
/// pointer click leaves nothing focused, so the place is what the menu returns focus to.
#[derive(IntoElement)]
struct AiTrigger {
    id: u64,
    button: Button,
    slot: Option<FocusHandle>,
    ring: Hsla,
    radius: Pixels,
    open: bool,
}

impl Selectable for AiTrigger {
    fn selected(mut self, selected: bool) -> Self {
        self.open = selected;
        self
    }

    fn is_selected(&self) -> bool {
        self.open
    }
}

impl RenderOnce for AiTrigger {
    fn render(self, _: &mut Window, _: &mut gpui_kit::App) -> impl IntoElement {
        let button = self.button.selected(self.open);
        let ring = self.ring;
        match self.slot {
            Some(slot) => div()
                .id((ids::AI_EDIT_SLOT, self.id))
                .track_focus(&slot)
                .rounded(self.radius)
                .border_1()
                .border_color(gpui_kit::transparent_black())
                .focus_visible(move |style| style.border_color(ring))
                .child(button)
                .into_any_element(),
            None => button.into_any_element(),
        }
    }
}

/// The AI edit button and the menu it opens: two ready-made rewrites, and a field for an
/// instruction of the student's own. It closes with Escape or a choice, and focus goes back to
/// the button, which a pointer click would not have focused.
fn ai_edit(
    message: &ChatMessage,
    locale: Locale,
    versions: &VersionsState,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let id = message.id;
    let mid = id.get() as u64;
    let shell = cx.entity().downgrade();
    let open = versions.menu == Some(id);
    let instruction = versions.instruction.clone();
    let focus = gpui_kit::Focusable::focus_handle(instruction.read(cx), cx);
    let slot = versions.focus.get(&id).map(|focus| focus.ai.clone());
    let trigger = icon_button(
        (ids::AI_EDIT, mid),
        text(locale, Message::AiEdit),
        IconName::WandSparkles,
        cx,
    )
    // The slot around it is the tab stop, so the menu can hand focus back to it.
    .when(slot.is_some(), |button| button.tab_stop(false));
    let ring = palette(cx).primary;
    let radius = units(cx)(study_ui::scale::RADIUS_MD);
    let changed = shell.clone();
    let field = instruction.clone();
    let returned = slot.clone();
    Popover::new((ids::AI_MENU, mid))
        .anchor(Anchor::TopRight)
        .open(open)
        .on_open_change(move |open, window, cx| {
            if *open {
                field.update(cx, |input, cx| {
                    input.set_value("", window, cx);
                    input.set_placeholder(
                        text(locale, Message::RewriteInstructionPlaceholder),
                        window,
                        cx,
                    )
                });
            } else if let Some(slot) = &returned {
                slot.focus(window, cx);
            }
            changed
                .update(cx, |this, cx| {
                    this.sessions.versions.menu = open.then_some(id);
                    cx.notify();
                })
                .ok();
        })
        .trigger(AiTrigger {
            id: mid,
            button: trigger,
            slot,
            ring,
            radius,
            open: false,
        })
        .track_focus(&focus)
        .content(move |_, _, cx| {
            let unit = units(cx);
            let run = |how: Rewrite| {
                let shell = shell.clone();
                move |_: &gpui_kit::ClickEvent, window: &mut Window, cx: &mut gpui_kit::App| {
                    shell
                        .update(cx, |this, cx| this.rewrite(id, how.clone(), window, cx))
                        .ok();
                }
            };
            let typed = !instruction.read(cx).value().trim().is_empty();
            let instructed = shell.clone();
            div()
                .w(unit(MENU_WIDTH))
                .flex()
                .flex_col()
                .gap(unit(study_ui::scale::SPACE_XXS))
                .child(
                    MenuItem::new(
                        (ids::AI_IMPROVE, mid),
                        text(locale, Message::RewriteImprove),
                    )
                    .icon(IconName::WandSparkles)
                    .on_click(run(Rewrite::Improve)),
                )
                .child(
                    MenuItem::new(
                        (ids::AI_SUMMARIZE, mid),
                        text(locale, Message::RewriteSummarize),
                    )
                    .icon(IconName::WandSparkles)
                    .on_click(run(Rewrite::Summarize)),
                )
                .child(
                    div()
                        .pt(unit(study_ui::scale::SPACE_XS))
                        .flex()
                        .flex_col()
                        .gap(unit(study_ui::scale::SPACE_XXS))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(unit(study_ui::scale::SPACE_XS))
                                // Space and Enter belong to the field, not to the popover
                                // around it (see `bind_shortcuts`).
                                .key_context(crate::app::desktop::PROMPT_FIELD)
                                .child(named_field(
                                    (ids::AI_INSTRUCTION, mid),
                                    text(locale, Message::RewriteInstruction),
                                    Input::new(&instruction)
                                        .aria_label(text(locale, Message::RewriteInstruction)),
                                ))
                                .child(
                                    button(
                                        (ids::AI_RUN, mid),
                                        text(locale, Message::RewriteRun),
                                        cx,
                                    )
                                    .primary()
                                    .disabled(!typed)
                                    .on_click(
                                        move |_, window, cx| {
                                            instructed
                                                .update(cx, |this, cx| {
                                                    this.run_instruction(window, cx)
                                                })
                                                .ok();
                                        },
                                    ),
                                ),
                        )
                        .child(
                            div()
                                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                                .text_color(study_ui::palette(cx).faint)
                                .child(text(locale, Message::RewriteInstructionHint)),
                        ),
                )
        })
        .into_any_element()
}

/// The edit box that replaces an entry's words while they are edited: the text, what the
/// keys do, and Save and Cancel.
pub(in crate::ui::screens::shell::page::pages::sessions) fn edit_box(
    message: &ChatMessage,
    locale: Locale,
    versions: &VersionsState,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let mid = message.id.get() as u64;
    let unit = units(cx);
    let saving = versions.editing.is_some_and(|(_, saving)| saving);
    let empty = versions.edit_field.read(cx).value().trim().is_empty();
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(unit(study_ui::scale::SPACE_XS))
        .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
            if event.keystroke.key == ESCAPE && !event.keystroke.modifiers.modified() {
                this.cancel_edit(cx);
                cx.stop_propagation();
            }
        }))
        .child(named_field(
            (ids::EDIT_TEXT, mid),
            text(locale, Message::EditMessage),
            Textarea::new(&versions.edit_field)
                .h(unit(120.))
                .disabled(saving)
                .aria_label(text(locale, Message::EditMessage)),
        ))
        .child(
            div()
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(palette(cx).faint)
                .child(text(locale, Message::EditMessageHint)),
        )
        .child(
            div()
                .flex()
                .justify_end()
                .gap(unit(study_ui::scale::SPACE_XS))
                .child(
                    button((ids::CANCEL_EDIT, mid), text(locale, Message::Cancel), cx)
                        .ghost()
                        .disabled(saving)
                        .on_click(cx.listener(|this, _, _, cx| this.cancel_edit(cx))),
                )
                .child(
                    button((ids::SAVE_EDIT, mid), text(locale, Message::Save), cx)
                        .primary()
                        .disabled(saving || empty)
                        .on_click(cx.listener(|this, _, _, cx| this.save_edit(cx))),
                ),
        )
        .into_any_element()
}

impl AppShell {
    /// Shows another finished version of an entry on the switcher's arrow.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn step_version(
        &mut self,
        id: MessageId,
        version: VersionId,
        cx: &mut Context<Self>,
    ) {
        let versions = &mut self.sessions.versions;
        versions.notice = None;
        versions.fresh.remove(&id);
        let Some(session_id) = self.sessions.session_id() else {
            return;
        };
        if !self.workers.allow(&mut self.sessions.error, cx) {
            return;
        }
        self.background(
            move |app| app.set_active_version(id, version),
            move |view, result, cx| {
                if let Err(error) = &result {
                    crate::features::errors::report(error);
                    view.sessions.fail_in(session_id, Message::JobActionError);
                }
                view.reload_session(session_id, cx);
            },
            cx,
        );
    }

    /// Opens an entry's words for editing in place, closing any other edit.
    fn start_edit(
        &mut self,
        id: MessageId,
        words: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let versions = &mut self.sessions.versions;
        if versions.editing.is_some_and(|(_, saving)| saving) {
            return;
        }
        versions.menu = None;
        versions.notice = None;
        versions.editing = Some((id, false));
        versions.edit_field.update(cx, |field, cx| {
            field.set_value(words, window, cx);
            field.focus(window, cx);
        });
        cx.notify();
    }

    fn cancel_edit(&mut self, cx: &mut Context<Self>) {
        let versions = &mut self.sessions.versions;
        if versions.editing.is_some_and(|(_, saving)| !saving) {
            versions.editing = None;
            cx.notify();
        }
    }

    /// Saves the edit as a new version, which becomes the one shown. Words left as they were
    /// make no version.
    fn save_edit(&mut self, cx: &mut Context<Self>) {
        let versions = &mut self.sessions.versions;
        let Some((id, false)) = versions.editing else {
            return;
        };
        let words = versions.edit_field.read(cx).value().trim_end().to_owned();
        if words.trim().is_empty() {
            return;
        }
        let Some(session_id) = self.sessions.session_id() else {
            return;
        };
        if !self.workers.allow(&mut self.sessions.error, cx) {
            return;
        }
        self.sessions.versions.editing = Some((id, true));
        cx.notify();
        self.background(
            move |app| app.edit_message(id, &words),
            move |view, result, cx| {
                let versions = &mut view.sessions.versions;
                match result {
                    Ok(saved) => {
                        versions.editing = None;
                        versions.fresh.remove(&id);
                        if saved.is_none() {
                            versions.notice = Some((id, Message::EditUnchanged));
                        }
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        versions.editing = Some((id, false));
                        view.sessions
                            .fail_in(session_id, Message::SessionsSaveError);
                    }
                }
                view.reload_session(session_id, cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Asks for a new version of an entry's words, written as `how` says.
    fn rewrite(
        &mut self,
        id: MessageId,
        how: Rewrite,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.sessions.versions.menu = None;
        self.sessions
            .versions
            .instruction
            .update(cx, |field, cx| field.set_value("", window, cx));
        self.ask_version(id, move |app| app.rewrite_message(id, &how), cx);
    }

    /// Runs the instruction written in the AI edit menu on the entry the menu is open for.
    fn run_instruction(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.sessions.versions.menu else {
            return;
        };
        let instruction = self
            .sessions
            .versions
            .instruction
            .read(cx)
            .value()
            .trim()
            .to_owned();
        if instruction.is_empty() {
            return;
        }
        self.rewrite(id, Rewrite::Instruction(instruction), window, cx);
    }

    /// Asks for a new version of an entry, then reloads. When one is already being written,
    /// or the entry cannot have one, the entry says so: a click never goes unanswered.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn ask_version(
        &mut self,
        id: MessageId,
        ask: impl FnOnce(&study_app::App) -> study_core::Result<Asked> + Send + 'static,
        cx: &mut Context<Self>,
    ) {
        let Some(session_id) = self.sessions.session_id() else {
            return;
        };
        if !self.workers.allow(&mut self.sessions.error, cx) {
            return;
        }
        self.sessions.versions.notice = None;
        self.background(
            ask,
            move |view, asked, cx| {
                let versions = &mut view.sessions.versions;
                match asked {
                    Ok(Asked::Queued(_)) => {}
                    Ok(Asked::Busy) => versions.notice = Some((id, Message::RewriteBusy)),
                    Ok(Asked::Unavailable) => {
                        versions.notice = Some((id, Message::RewriteUnavailable))
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        view.sessions.fail_in(session_id, Message::JobActionError);
                    }
                }
                view.reload_session(session_id, cx);
                cx.notify();
            },
            cx,
        );
    }
}
