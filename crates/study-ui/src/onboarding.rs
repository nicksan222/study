//! The first-run tour's window: its own chrome and a centered stage that walks through a
//! few steps, its footer pinned to the stage's bottom so the controls stay put from step to
//! step. It receives every step's content and control from the app; it owns only the
//! layout, the progress bar and the entrance motion.

use gpui_kit::component::{ActiveTheme as _, button::Button};
use gpui_kit::{
    AnyElement, App, Div, InteractiveElement as _, IntoElement, ParentElement as _, RenderOnce,
    Role, SharedString, Stateful, StatefulInteractiveElement as _, Styled as _, Window, div,
    prelude::FluentBuilder as _,
};

use crate::button::title_bar_sized;
use crate::chrome::{inset_surface, title_bar, window_root};
use crate::ids;

/// A full window for one step of a guided tour.
///
/// `step` is zero-based and `steps` counts them all. Changing `step` replays the entrance, so
/// every step arrives the same way.
#[derive(IntoElement)]
pub struct OnboardingFrame {
    step: usize,
    steps: usize,
    brand: SharedString,
    progress_label: SharedString,
    hero: Option<AnyElement>,
    title: SharedString,
    description: Option<SharedString>,
    content: Option<AnyElement>,
    skip: Option<Button>,
    back: Option<Button>,
    next: Option<Button>,
}

impl OnboardingFrame {
    /// Step `step` (zero-based) of `steps`, headed by `title`.
    pub fn new(step: usize, steps: usize, title: impl Into<SharedString>) -> Self {
        Self {
            step,
            steps: steps.max(1),
            brand: SharedString::default(),
            progress_label: SharedString::default(),
            hero: None,
            title: title.into(),
            description: None,
            content: None,
            skip: None,
            back: None,
            next: None,
        }
    }

    /// The app's name, shown in the window's title bar.
    pub fn brand(mut self, brand: impl Into<SharedString>) -> Self {
        self.brand = brand.into();
        self
    }

    /// Where the tour is, in words, such as "Step 2 of 5": shown in the footer, and the name
    /// accessibility gives the progress bar.
    pub fn progress_label(mut self, label: impl Into<SharedString>) -> Self {
        self.progress_label = label.into();
        self
    }

    /// A picture above the title.
    pub fn hero(mut self, hero: impl IntoElement) -> Self {
        self.hero = Some(hero.into_any_element());
        self
    }

    /// Supporting text below the title.
    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// The step's own controls or illustration, below the description.
    pub fn content(mut self, content: impl IntoElement) -> Self {
        self.content = Some(content.into_any_element());
        self
    }

    /// Leaves the tour from any step; shown in the title bar.
    pub fn skip(mut self, skip: Button) -> Self {
        self.skip = Some(skip);
        self
    }

    /// Returns to the previous step; omit it on the first.
    pub fn back(mut self, back: Button) -> Self {
        self.back = Some(back);
        self
    }

    /// The step's primary action.
    pub fn next(mut self, next: Button) -> Self {
        self.next = Some(next);
        self
    }
}

impl RenderOnce for OnboardingFrame {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        let key = |part: usize| ids::onboarding_motion(self.step, part);
        let progress = progress(self.step, self.steps, self.progress_label.clone(), cx);
        let heading = heading(self.hero, self.title, self.description, cx);
        let footer = footer(self.back, self.progress_label, self.next, cx);
        let gap = unit(crate::scale::SPACE_LG);
        // The step's own part takes the height the footer doesn't, so the footer stays at
        // the bottom whatever the step holds.
        let middle = div()
            .flex_1()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(gap)
            .child(crate::Rise::new(key(0), heading))
            .children(self.content.map(|content| {
                crate::Rise::new(key(1), content).delay(cx.theme().motion.duration_fast)
            }));
        let column = div()
            .flex_1()
            .w_full()
            .max_w(unit(760.))
            .flex()
            .flex_col()
            .items_center()
            .gap(gap)
            .child(progress)
            .child(middle)
            .child(footer);

        window_root(cx)
            .child(title_bar_row(self.brand, self.skip, cx))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .px(unit(4.))
                    .pb(unit(4.))
                    .flex()
                    .child(
                        inset_surface(cx)
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .flex()
                            .flex_col()
                            .child(stage(column, cx)),
                    ),
            )
    }
}

/// One segment per step: done ones filled, the current one filled and wider. Accessibility
/// reads it as a progress indicator named by `label`.
fn progress(step: usize, steps: usize, label: SharedString, cx: &App) -> Stateful<Div> {
    let unit = crate::theme::units(cx);
    let colors = cx.theme().colors;
    div()
        .id(ids::ONBOARDING_PROGRESS)
        .role(Role::ProgressIndicator)
        .aria_label(label)
        .aria_min_numeric_value(1.)
        .aria_max_numeric_value(steps as f64)
        .aria_numeric_value((step + 1) as f64)
        .w_full()
        .max_w(unit(360.))
        .flex()
        .items_center()
        .gap(unit(6.))
        .children((0..steps).map(|index| {
            let current = index == step;
            div()
                .h(unit(4.))
                .rounded(unit(crate::scale::RADIUS_SM))
                .when(current, |bar| bar.flex_1().min_w(unit(48.)))
                .when(!current, |bar| bar.w(unit(24.)))
                .bg(if index <= step {
                    colors.primary
                } else {
                    colors.border
                })
        }))
}

/// The hero, then the title and its description, centered.
fn heading(
    hero: Option<AnyElement>,
    title: SharedString,
    description: Option<SharedString>,
    cx: &App,
) -> crate::PageIntro {
    let unit = crate::theme::units(cx);
    let intro = crate::PageIntro::headline(title)
        .centered()
        .max_w(unit(640.));
    let intro = match hero {
        Some(hero) => intro.context(div().pb(unit(crate::scale::SPACE_XXS)).child(hero)),
        None => intro,
    };
    match description {
        Some(description) => intro.description(description),
        None => intro,
    }
}

/// Back at the start, where the tour is in the middle, and the primary action at the end.
fn footer(
    back: Option<Button>,
    progress_label: SharedString,
    next: Option<Button>,
    cx: &App,
) -> Div {
    let unit = crate::theme::units(cx);
    div()
        .w_full()
        .flex()
        .items_center()
        .gap(unit(12.))
        .child(div().flex_1().flex().children(back))
        .child(
            div()
                .flex_none()
                .text_size(unit(crate::scale::TEXT_CAPTION))
                .text_color(cx.theme().colors.muted_foreground)
                .child(progress_label),
        )
        .child(div().flex_1().flex().justify_end().children(next))
}

/// `column` across the window's middle, at least its full height. Scrolls, so a short window
/// can still reach every control.
fn stage(column: Div, cx: &App) -> impl IntoElement {
    let unit = crate::theme::units(cx);
    div()
        .id(ids::ONBOARDING_STAGE_SCROLL)
        .flex_1()
        .min_h_0()
        .w_full()
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .items_center()
        .px(unit(crate::scale::SPACE_LG))
        .py(unit(32.))
        .child(column)
}

/// The title bar: the app's name, and the way out of the tour.
fn title_bar_row(brand: SharedString, skip: Option<Button>, cx: &App) -> impl IntoElement {
    let unit = crate::theme::units(cx);
    title_bar(cx).child(
        div()
            .h_full()
            .flex_1()
            .min_w_0()
            .px(unit(12.))
            .flex()
            .items_center()
            .gap(unit(8.))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .text_ellipsis()
                    .text_size(unit(crate::scale::TEXT_UI))
                    .font_weight(gpui_kit::FontWeight::MEDIUM)
                    .child(brand),
            )
            .children(skip.map(|skip| title_bar_sized(skip, cx))),
    )
}
