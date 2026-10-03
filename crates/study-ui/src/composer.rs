//! Text entry and the notebook's text: [`Composer`] and [`Note`]. Both highlight what the
//! caller marks, such as a mention: the composer draws the input's inline tokens as
//! highlighter chips, and a note washes its marked ranges in the highlighter.

use std::ops::Range;

use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{
    ActiveTheme as _,
    button::Button,
    input::{InlineTokenContext, Textarea, TextareaState},
};
use gpui_kit::{
    AnyElement, App, ElementId, Entity, Focusable as _, FontWeight, HighlightStyle,
    InteractiveElement as _, IntoElement, ParentElement as _, Pixels, RenderOnce, SharedString,
    Styled as _, StyledText, Window, div, px,
};

use crate::button::composer_submit_sized;

/// Where the composer's text starts, in units from its edge: 16 across, 12 down
/// (`DESIGN.md`, the composer).
const TEXT_INSET_X: f32 = 16.;
const TEXT_INSET_TOP: f32 = 12.;
/// The padding GPUI Kit's text box keeps around its text at the default size, already part
/// of the inset.
const EDITOR_PADDING_X: Pixels = px(10.);
const EDITOR_PADDING_TOP: Pixels = px(8.);

/// A reusable, presentation-only surface for composing multi-line text.
///
/// The caller owns the text state and supplies every action, keeping this
/// component independent of any chat or persistence domain. Inline tokens the
/// caller puts in the text show as tinted chips.
#[derive(IntoElement)]
pub struct Composer {
    input: Entity<TextareaState>,
    /// Names the editor for tests and agents: the text box's own id is made up per run.
    id: Option<ElementId>,
    context: Option<AnyElement>,
    actions: Vec<AnyElement>,
    trailing: Option<AnyElement>,
    submit_button: Option<Button>,
}

impl Composer {
    pub fn new(input: &Entity<TextareaState>) -> Self {
        Self {
            input: input.clone(),
            id: None,
            context: None,
            actions: Vec::new(),
            trailing: None,
            submit_button: None,
        }
    }

    /// Names the editor `id`, so it can be found the same way every run.
    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Adds content above the editor, such as an attachment or selected context.
    pub fn context(mut self, context: impl IntoElement) -> Self {
        self.context = Some(context.into_any_element());
        self
    }

    /// Adds a leading action in the footer, after any added before it: a button, or one
    /// that opens a menu.
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    /// Adds caller-owned content before the submit button in the footer.
    pub fn trailing(mut self, trailing: impl IntoElement) -> Self {
        self.trailing = Some(trailing.into_any_element());
        self
    }

    /// Adds the caller-configured submit button and its click behavior.
    pub fn submit_button(mut self, submit_button: Button) -> Self {
        self.submit_button = Some(submit_button);
        self
    }
}

impl RenderOnce for Composer {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let colors = cx.theme().colors;
        let focused = self.input.read(cx).focus_handle(cx).is_focused(window);
        let border = gpui_kit::base::transition(
            crate::ids::composer_border(self.input.entity_id()),
            if focused {
                colors.foreground.opacity(0.26)
            } else {
                colors.border
            },
            gpui_kit::base::Transition::new(cx.theme().motion.duration_fast),
            window,
            cx,
        );
        let unit = crate::theme::units(cx);
        let has_footer =
            !self.actions.is_empty() || self.trailing.is_some() || self.submit_button.is_some();

        // The context shelf sits behind the editor, rather than dividing it.
        // Each surface paints its own corners; children never own its background.
        div()
            .w_full()
            .flex()
            .flex_col()
            .text_color(colors.foreground)
            .children(self.context.map(|context| {
                div()
                    .mx(unit(14.))
                    .px(unit(14.))
                    .pt(unit(10.))
                    .pb(unit(14.))
                    .mb(unit(-8.))
                    .rounded_t(unit(crate::scale::RADIUS_LG))
                    .bg(colors.muted.opacity(0.30))
                    .child(context)
            }))
            .child(
                div()
                    .id(self
                        .id
                        .unwrap_or_else(|| crate::ids::composer_editor(self.input.entity_id())))
                    .test_support()
                    .w_full()
                    .min_h(unit(if has_footer { 102. } else { 56. }))
                    .flex()
                    .flex_col()
                    .rounded(unit(crate::scale::RADIUS_XL))
                    .border_1()
                    .border_color(border)
                    .bg(crate::theme::palette(cx).raised)
                    .shadow(crate::theme::float_shadow(cx))
                    .child(
                        Textarea::new(&self.input)
                            .token(|token, _, cx| token_chip(token, cx))
                            .h(unit(56.))
                            // The text box pads its own text by GPUI Kit's input padding;
                            // the rest brings the text, caret and placeholder alike, to
                            // the composer's inset.
                            .px(unit(TEXT_INSET_X) - EDITOR_PADDING_X)
                            .pt(unit(TEXT_INSET_TOP) - EDITOR_PADDING_TOP)
                            .text_size(unit(crate::scale::TEXT_BODY))
                            .appearance(false)
                            .bordered(false),
                    )
                    .children(has_footer.then(|| {
                        div()
                            .w_full()
                            .px(unit(10.))
                            .pb(unit(9.))
                            .flex()
                            .items_center()
                            .gap(unit(10.))
                            .children(self.actions)
                            .child(div().flex_1())
                            .children(self.trailing)
                            .children(
                                self.submit_button
                                    .map(|button| composer_submit_sized(button, cx)),
                            )
                    })),
            )
    }
}

/// An inline token of the composer's text, drawn as a highlighter chip.
fn token_chip(token: &InlineTokenContext, cx: &mut App) -> gpui_kit::Div {
    let mark = mark(cx);
    let fill = if token.is_selected() {
        cx.theme().selection
    } else {
        mark.background_color.unwrap_or_default()
    };
    div()
        .flex()
        .items_center()
        .h(token.line_height())
        .max_w(token.available_width())
        .px(crate::theme::unit(cx, 4.))
        .rounded(crate::theme::unit(cx, crate::scale::RADIUS_SM))
        .bg(fill)
        .text_color(mark.color.unwrap_or_default())
        .font_weight(mark.font_weight.unwrap_or_default())
        .child(
            div()
                .min_w_0()
                .text_ellipsis()
                .child(token.token().label().clone()),
        )
}

/// How a mention is drawn, as a chip in the composer and a marked range in a note: ink on
/// the highlighter's wash, so the learner sees which notes will be answered.
fn mark(cx: &App) -> HighlightStyle {
    let palette = crate::theme::palette(cx);
    HighlightStyle {
        color: Some(palette.foreground),
        background_color: Some(palette.highlighter_wash),
        font_weight: Some(FontWeight::MEDIUM),
        ..HighlightStyle::default()
    }
}

/// A note in the notebook: body text on the page itself, left-aligned at the column's width,
/// with no bubble or box.
#[derive(IntoElement)]
pub struct Note {
    body: SharedString,
    marks: Vec<Range<usize>>,
}

impl Note {
    pub fn new(body: impl Into<SharedString>) -> Self {
        Self {
            body: body.into(),
            marks: Vec::new(),
        }
    }

    /// Byte ranges of the body to highlight, in order and apart, such as mentions.
    pub fn marks(mut self, marks: Vec<Range<usize>>) -> Self {
        self.marks = marks;
        self
    }
}

impl RenderOnce for Note {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        let style = mark(cx);
        let body = StyledText::new(self.body)
            .with_highlights(self.marks.into_iter().map(|range| (range, style)));
        div()
            .w_full()
            .min_w_0()
            .text_size(unit(crate::scale::TEXT_BODY))
            .line_height(unit(24.))
            .text_color(cx.theme().colors.foreground)
            .whitespace_normal()
            .child(body)
    }
}
