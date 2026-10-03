//! Short, non-layout motion: entrances, and the sweep over running work's words. Native
//! GPUI honors reduced-motion preferences.

use std::time::Duration;

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    Animation, AnimationExt as _, AnyElement, App, ElementId, HighlightStyle, IntoElement,
    ParentElement as _, RenderOnce, SharedString, Styled as _, StyledText, Window, div,
    ease_out_quint,
};

/// Fades newly mounted content in without moving its bounds or delaying input.
/// Use a stable ID for the same content; changing it starts a new entrance.
#[derive(IntoElement)]
pub struct FadeIn {
    id: ElementId,
    content: AnyElement,
}

impl FadeIn {
    pub fn new(id: impl Into<ElementId>, content: impl IntoElement) -> Self {
        Self {
            id: id.into(),
            content: content.into_any_element(),
        }
    }
}

impl RenderOnce for FadeIn {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        div().size_full().child(self.content).with_animation(
            self.id,
            Animation::new(cx.theme().motion.duration_normal).with_easing(ease_out_quint()),
            // From nearly opaque, so switching pages never shows a blank frame.
            |element, progress| element.opacity(0.88 + 0.12 * progress),
        )
    }
}

/// Rises a few pixels into place while fading in, starting `delay` after it mounts, so a
/// page's sections arrive one after another. Layout is final from the first frame.
#[derive(IntoElement)]
pub struct Rise {
    id: ElementId,
    delay: Duration,
    travel: f32,
    content: AnyElement,
}

impl Rise {
    pub fn new(id: impl Into<ElementId>, content: impl IntoElement) -> Self {
        Self {
            id: id.into(),
            delay: Duration::ZERO,
            travel: 10.,
            content: content.into_any_element(),
        }
    }

    /// How long after mounting the rise starts.
    pub fn delay(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }

    /// How far it rises, in design pixels; 10 by default.
    pub fn travel(mut self, travel: f32) -> Self {
        self.travel = travel;
        self
    }
}

impl RenderOnce for Rise {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let travel = crate::theme::unit(cx, self.travel);
        let rise = cx.theme().motion.duration_normal * 2;
        let total = rise + self.delay;
        // One animation spans the delay and the rise; the easing holds still through the delay.
        let (delay, rise_secs, total_secs) = (
            self.delay.as_secs_f32(),
            rise.as_secs_f32(),
            total.as_secs_f32(),
        );
        div().w_full().child(self.content).with_animation(
            self.id,
            Animation::new(total).with_easing(move |t: f32| {
                let local = ((t * total_secs - delay) / rise_secs).clamp(0., 1.);
                ease_out_quint()(local)
            }),
            move |element, progress| {
                element
                    .relative()
                    .top(travel * (1. - progress))
                    .opacity(progress)
            },
        )
    }
}

/// Words of work that is running, such as "Transcribing…": faint, with a band of full ink
/// sweeping through them over and over (`DESIGN.md`, the folded work line). Only the colour
/// moves, so the line's layout never does.
#[derive(IntoElement)]
pub struct Shimmer {
    id: ElementId,
    text: SharedString,
}

impl Shimmer {
    /// Use a stable ID for the same line, so the sweep doesn't restart on every frame.
    pub fn new(id: impl Into<ElementId>, text: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
        }
    }
}

/// How many characters the bright band spans, and how long one sweep takes.
const SHIMMER_BAND: usize = 6;
const SHIMMER_SWEEP: Duration = Duration::from_millis(1600);

impl RenderOnce for Shimmer {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let palette = crate::theme::palette(cx);
        let text = self.text;
        // Character boundaries, so the band never splits a character.
        let bounds: Vec<usize> = text
            .char_indices()
            .map(|(at, _)| at)
            .chain([text.len()])
            .collect();
        let chars = bounds.len() - 1;
        div().text_color(palette.faint).with_animation(
            self.id,
            Animation::new(SHIMMER_SWEEP).repeat(),
            move |element, progress| {
                // The band enters from before the first character and leaves after the
                // last, so each sweep starts and ends on plain faint words.
                let travel = (chars + 2 * SHIMMER_BAND) as f32;
                let lead = (progress * travel) as usize;
                let start = lead.saturating_sub(2 * SHIMMER_BAND).min(chars);
                let end = lead.saturating_sub(SHIMMER_BAND).min(chars);
                let band = HighlightStyle {
                    color: Some(palette.foreground),
                    ..HighlightStyle::default()
                };
                let highlights = (start < end).then(|| (bounds[start]..bounds[end], band));
                element.child(StyledText::new(text.clone()).with_highlights(highlights))
            },
        )
    }
}
