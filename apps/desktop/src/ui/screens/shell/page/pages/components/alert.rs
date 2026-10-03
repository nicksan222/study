//! The alert that asks before something is lost or replaced: a centred card over a dimmed
//! window, naming what is about to happen as a question, what goes with it, then Cancel and
//! the button that goes ahead.
//!
//! An alert is drawn from the shell's state, never opened: the page that asks keeps the flag
//! it always kept (`deleting`, `rewriting`, …), says what its alert reads in
//! `AppShell::alert`, and the shell draws it over everything. Clearing the flag anywhere
//! closes it. Cancel, Escape and a click on the dimmed window all run the alert's
//! `dismiss`, so they always agree.

use crate::ui::screens::shell::page::*;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::{ActiveTheme as _, Disableable as _, Icon, ThemeMode};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{AnyElement, ElementId, FontWeight, MouseButton, SharedString};
use std::rc::Rc;
use study_ui::{button, palette, scale, units};

/// How wide an alert's card is at most.
const ALERT_WIDTH: f32 = 420.;

/// How dark the window behind an alert turns, in dark and in light.
const SCRIM: (f32, f32) = (0.55, 0.25);

/// What closing an alert without going ahead does to the shell.
pub(in crate::ui::screens::shell::page) type Dismiss =
    Rc<dyn Fn(&mut AppShell, &mut Context<AppShell>)>;

/// One alert's words and buttons, built by the page that asks.
pub(in crate::ui::screens::shell::page) struct Alert {
    /// Losing something (a delete) is marked in the danger colour; replacing it (writing it
    /// again) in the highlighter.
    danger: bool,
    title: SharedString,
    body: SharedString,
    /// A line under the body, such as the page's own error line.
    note: Option<AnyElement>,
    /// Why the last try failed, under the body in the danger colour.
    failure: Option<SharedString>,
    /// The button that goes ahead, styled by the caller (`.danger()` or `.primary()`).
    confirm: Button,
    cancel_id: ElementId,
    /// `None` while the alert cannot be left, such as while the delete runs.
    dismiss: Option<Dismiss>,
}

impl Alert {
    /// An alert asking `title`, explaining `body`, going ahead with `confirm`; its Cancel
    /// takes `cancel_id` and runs `dismiss`.
    pub(in crate::ui::screens::shell::page) fn new(
        title: impl Into<SharedString>,
        body: impl Into<SharedString>,
        confirm: Button,
        cancel_id: impl Into<ElementId>,
        dismiss: impl Fn(&mut AppShell, &mut Context<AppShell>) + 'static,
    ) -> Self {
        Self {
            danger: true,
            title: title.into(),
            body: body.into(),
            note: None,
            failure: None,
            confirm,
            cancel_id: cancel_id.into(),
            dismiss: Some(Rc::new(dismiss)),
        }
    }

    /// Adds `note` under the body.
    pub(in crate::ui::screens::shell::page) fn note(mut self, note: Option<AnyElement>) -> Self {
        self.note = note;
        self
    }

    /// Says why the last try failed, under the body.
    pub(in crate::ui::screens::shell::page) fn failure(
        mut self,
        failure: Option<SharedString>,
    ) -> Self {
        self.failure = failure;
        self
    }

    /// Keeps the alert open, Cancel disabled, while `locked`.
    pub(in crate::ui::screens::shell::page) fn locked(mut self, locked: bool) -> Self {
        if locked {
            self.dismiss = None;
        }
        self
    }

    /// What Escape runs while this alert is open.
    pub(in crate::ui::screens::shell::page) fn dismiss(&self) -> Option<Dismiss> {
        self.dismiss.clone()
    }

    /// The alert over the whole window: the dimmed backdrop, which closes it when clicked,
    /// and the floating card in its middle.
    pub(in crate::ui::screens::shell::page) fn render(
        self,
        locale: Locale,
        cx: &mut Context<AppShell>,
    ) -> AnyElement {
        let unit = units(cx);
        let palette = palette(cx);
        let (icon, wash, ink) = if self.danger {
            (
                IconName::Trash,
                palette.danger.opacity(0.12),
                palette.danger,
            )
        } else {
            (
                IconName::RotateCw,
                palette.highlighter_wash,
                palette.highlighter_ink,
            )
        };
        let dismiss = self.dismiss;
        let cancel = button(self.cancel_id, text(locale, Message::Cancel), cx)
            .ghost()
            .disabled(dismiss.is_none())
            .when_some(dismiss.clone(), |cancel, dismiss| {
                cancel.on_click(cx.listener(move |this, _, _, cx| dismiss(this, cx)))
            });
        let card = div()
            .w_full()
            .max_w(unit(ALERT_WIDTH))
            .flex()
            .flex_col()
            .gap(unit(scale::SPACE_LG))
            .p(unit(scale::SPACE_LG))
            .rounded(unit(scale::RADIUS_LG))
            .bg(palette.raised)
            .border_1()
            .border_color(palette.border)
            .shadow(study_ui::float_shadow(cx))
            // A click on the card is not a click on the backdrop behind it.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap(unit(scale::SPACE_MD))
                    .child(
                        div()
                            .flex_none()
                            .size(unit(40.))
                            .rounded_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(wash)
                            .child(Icon::new(icon).size(unit(18.)).text_color(ink)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(unit(scale::SPACE_XXS))
                            .child(
                                div()
                                    .text_size(unit(scale::TEXT_TITLE))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(palette.foreground)
                                    .whitespace_normal()
                                    .child(self.title),
                            )
                            .child(
                                div()
                                    .text_size(unit(scale::TEXT_SMALL))
                                    .text_color(palette.muted)
                                    .whitespace_normal()
                                    .child(self.body),
                            )
                            .children(self.note)
                            .children(self.failure.map(|failure| {
                                div()
                                    .text_size(unit(scale::TEXT_SMALL))
                                    .text_color(palette.danger)
                                    .whitespace_normal()
                                    .child(failure)
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(unit(scale::SPACE_XS))
                    .child(cancel)
                    .child(self.confirm),
            );
        div()
            .absolute()
            .inset_0()
            .occlude()
            .flex()
            .items_center()
            .justify_center()
            .p(unit(scale::SPACE_LG))
            .bg(gpui_kit::hsla(
                0.,
                0.,
                0.,
                if cx.theme().mode == ThemeMode::Dark {
                    SCRIM.0
                } else {
                    SCRIM.1
                },
            ))
            .when_some(dismiss, |backdrop, dismiss| {
                backdrop.on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, _, _, cx| dismiss(this, cx)),
                )
            })
            .child(card)
            .into_any_element()
    }
}
