//! Study's theme: bundled fonts, the light and dark color ramps, the type, radius and spacing
//! scales, and zoom. `DESIGN.md` at the repository root is the design system these values
//! implement. Every component sizes itself through [`unit()`] (re-exported as `scaled_px`),
//! or [`units()`] for many sizes at once, so one zoom setting scales typography, radii,
//! layout and hitboxes together; the lengths it takes come from [`scale`].

use std::borrow::Cow;
use std::time::Duration;

use gpui_kit::component::{Theme, ThemeMode};
use gpui_kit::{App, BoxShadow, Hsla, Pixels, hsla, point, px, rgb};

/// The body font size at 100% zoom; the current zoom is the theme font size divided by this.
pub(crate) const BASE_FONT_SIZE: f32 = scale::TEXT_BODY;

/// The smallest and largest zoom [`set_zoom`] allows, so the app's zoom steps stay inside it.
pub const ZOOM_RANGE: (f32, f32) = (0.75, 2.);

/// Install Study's fonts (Inter, and Excalifont for diagrams) and apply the saved appearance
/// before opening windows.
pub fn configure_theme(cx: &mut App, appearance: ThemeMode) {
    cx.text_system()
        .add_fonts(vec![
            Cow::Borrowed(include_bytes!("../assets/fonts/Inter-Regular.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/Inter-Medium.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/Inter-SemiBold.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/Excalifont-Regular.ttf")),
        ])
        .expect("failed to load bundled fonts");

    set_appearance(cx, appearance);
    set_zoom(cx, 1.);
}

/// The design system's sizes at 100% zoom, in design pixels: pass them to [`unit()`]. Every
/// text size, corner radius and gap in the app is one of these.
pub mod scale {
    /// Timestamps, sizes, counts, section labels, chips.
    pub const TEXT_CAPTION: f32 = 12.;
    /// Secondary lines in rows, help text, folded work lines.
    pub const TEXT_SMALL: f32 = 13.;
    /// Controls, list and sidebar rows, buttons, menu items, fields.
    pub const TEXT_UI: f32 = 14.;
    /// Anything read rather than scanned: notes, answers, transcripts.
    pub const TEXT_BODY: f32 = 15.;
    /// Page and session titles, section headings, dialog titles.
    pub const TEXT_TITLE: f32 = 17.;
    /// The one greeting or empty-state headline on a page.
    pub const TEXT_DISPLAY: f32 = 26.;

    /// Chips, citation marks, inline code, small bars.
    pub const RADIUS_SM: f32 = 6.;
    /// Buttons, rows, menu items, fields.
    pub const RADIUS_MD: f32 = 8.;
    /// Menus, popovers, dialogs, previews, media tiles.
    pub const RADIUS_LG: f32 = 12.;
    /// The composer.
    pub const RADIUS_XL: f32 = 20.;
    /// Circles and pills.
    pub const RADIUS_FULL: f32 = 999.;

    /// The 4-point spacing scale: inside rows 8 to 12, between related items 4 to 8, between
    /// groups 24 to 32, between page sections 48.
    pub const SPACE_XXS: f32 = 4.;
    pub const SPACE_XS: f32 = 8.;
    pub const SPACE_SM: f32 = 12.;
    pub const SPACE_MD: f32 = 16.;
    pub const SPACE_LG: f32 = 24.;
    pub const SPACE_XL: f32 = 32.;
    pub const SPACE_XXL: f32 = 48.;

    /// The reading column: the notebook and anything read.
    pub const COLUMN_READ: f32 = 680.;
    /// The page column: lists, settings, Home.
    pub const COLUMN_PAGE: f32 = 960.;
}

/// Study's colors for the current appearance, for the few the theme's tokens don't carry: the
/// highlighter, the faint third ink and the raised surface. Read the rest as
/// `cx.theme().colors.<token>`.
pub fn palette(cx: &App) -> Palette {
    Palette::of(Theme::global(cx).mode)
}

/// The one shadow, for what floats above the page (the composer, menus, popovers, dialogs):
/// deep and soft in dark, faint in light. Pair it with a hairline border.
pub fn float_shadow(cx: &App) -> Vec<BoxShadow> {
    let dark = Theme::global(cx).mode == ThemeMode::Dark;
    vec![BoxShadow {
        color: hsla(0., 0., 0., if dark { 0.45 } else { 0.08 }),
        offset: point(px(0.), unit(cx, 8.)),
        blur_radius: unit(cx, 24.),
        spread_radius: px(0.),
        inset: false,
    }]
}

/// Switch appearance without losing Study's typography override.
///
/// Colors are GPUI Kit's theme tokens, filled from Study's [`Palette`]. To change or add one,
/// give its dark and light value in `Palette::of` and assign it below, then read it in
/// components as `cx.theme().colors.<token>`, or through [`palette()`] when no token fits.
pub fn set_appearance(cx: &mut App, appearance: ThemeMode) {
    let zoom = zoom(cx);
    Theme::change(appearance, None, cx);
    Theme::update(cx, |theme| {
        // Use the actual Apple UI font on macOS; bundle a close, portable face elsewhere.
        #[cfg(target_os = "macos")]
        {
            theme.font_family = ".SystemUIFont".into();
        }
        #[cfg(not(target_os = "macos"))]
        {
            theme.font_family = "Inter".into();
        }
        apply_zoom(theme, zoom);
        theme.motion.duration_fast = Duration::from_millis(100);
        theme.motion.duration_normal = Duration::from_millis(160);
        theme.shadow = false;

        // Neutral ramps keep controls and native semantic tokens in sync through
        // Theme::update, including hover, focus, scrollbars and resize handles.
        let Palette {
            background,
            sidebar,
            title_bar,
            surface,
            raised,
            hover,
            active,
            fill,
            foreground,
            muted,
            faint,
            border,
            primary,
            primary_hover,
            primary_active,
            on_primary,
            highlighter,
            on_highlighter,
            highlighter_ink,
            danger,
            ..
        } = Palette::of(appearance);
        let c = &mut theme.colors;
        c.background = background;
        c.foreground = foreground;
        c.border = border;
        c.input = border;
        c.muted = fill;
        c.muted_foreground = muted;
        c.accent = hover;
        c.accent_foreground = foreground;
        c.primary = primary;
        c.primary_hover = primary_hover;
        c.primary_active = primary_active;
        c.primary_foreground = on_primary;
        c.secondary = surface;
        c.secondary_hover = hover;
        c.secondary_active = active;
        c.secondary_foreground = foreground;
        c.button = surface;
        c.button_hover = hover;
        c.button_active = active;
        c.button_foreground = foreground;
        c.button_primary = primary;
        c.button_primary_hover = primary_hover;
        c.button_primary_active = primary_active;
        c.button_primary_foreground = on_primary;
        c.button_secondary = surface;
        c.button_secondary_hover = hover;
        c.button_secondary_active = active;
        c.button_secondary_foreground = foreground;
        c.sidebar = sidebar;
        c.sidebar_foreground = foreground;
        c.sidebar_border = border;
        c.sidebar_accent = hover;
        c.sidebar_accent_foreground = foreground;
        c.sidebar_primary = surface;
        c.sidebar_primary_foreground = foreground;
        c.caret = foreground;
        c.selection = active;
        c.scrollbar = background;
        c.scrollbar_thumb = active;
        c.scrollbar_thumb_hover = muted;
        c.drag_border = muted;
        c.title_bar = title_bar;
        c.title_bar_border = border;
        c.window_border = border;
        c.popover = raised;
        c.popover_foreground = foreground;
        c.list = background;
        c.list_hover = hover;
        c.list_active = active;
        c.list_active_border = border;
        // State colors follow DESIGN.md: only failure is colored. Done is quiet, and the
        // warning tone is the highlighter, which marks learning moments such as an exam.
        c.danger = danger;
        c.danger_foreground = on_primary;
        c.success = faint;
        c.warning = highlighter_ink;
        // The warning button is the highlighter button: the one learning action.
        c.button_warning = highlighter;
        c.button_warning_hover = highlighter.opacity(0.9);
        c.button_warning_active = highlighter.opacity(0.8);
        c.button_warning_foreground = on_highlighter;
        c.info = muted;
        c.ring = highlighter_ink;
    });
}

/// Study's color ramp for one appearance: the one place its shades are written, read by
/// [`set_appearance`] for the theme tokens, by [`palette()`] and by the miniature windows in
/// `preview.rs`. `DESIGN.md` names each one.
#[derive(Clone, Copy)]
pub struct Palette {
    /// The canvas: the main reading surface.
    pub background: Hsla,
    /// The sidebar, and the title bar in the same tone.
    pub sidebar: Hsla,
    pub title_bar: Hsla,
    /// Quiet control fills.
    pub surface: Hsla,
    /// What floats: composer, menus, popovers, dialogs, an opened fold.
    pub raised: Hsla,
    pub hover: Hsla,
    pub active: Hsla,
    /// The quiet fill behind muted content (the theme's `muted` token).
    pub fill: Hsla,
    /// Primary text.
    pub foreground: Hsla,
    /// Secondary text and icons.
    pub muted: Hsla,
    /// Metadata, timestamps, section labels, folded work lines, and finished states.
    pub faint: Hsla,
    /// The rare hairline.
    pub border: Hsla,
    pub primary: Hsla,
    pub primary_hover: Hsla,
    pub primary_active: Hsla,
    pub on_primary: Hsla,
    /// The highlighter as a solid fill: the one learning action on a screen, the due count.
    pub highlighter: Hsla,
    /// Text on [`Palette::highlighter`].
    pub on_highlighter: Hsla,
    /// The highlighter as text, icon or line: exam countdowns, focus, the active question.
    pub highlighter_ink: Hsla,
    /// The highlighter as a wash behind ink: cited passages, matches, the `@study` chip.
    pub highlighter_wash: Hsla,
    /// What failed and needs the learner: the only state color.
    pub danger: Hsla,
}

impl Palette {
    pub(crate) fn of(appearance: ThemeMode) -> Self {
        let dark = appearance == ThemeMode::Dark;
        let pick = |dark_value: u32, light_value: u32| -> Hsla {
            rgb(if dark { dark_value } else { light_value }).into()
        };
        Self {
            background: pick(0x1a1a1a, 0xffffff),
            sidebar: pick(0x0e0e0e, 0xf3f3f3),
            title_bar: pick(0x0e0e0e, 0xf3f3f3),
            surface: pick(0x262626, 0xededed),
            raised: pick(0x222222, 0xffffff),
            hover: pick(0x262626, 0xededed),
            active: pick(0x2e2e2e, 0xe7e7e7),
            fill: pick(0x222222, 0xf3f3f3),
            foreground: pick(0xececec, 0x111111),
            muted: pick(0xababab, 0x4f4f4f),
            faint: pick(0x858585, 0x686868),
            border: pick(0x2c2c2c, 0xe4e4e4),
            primary: pick(0xececec, 0x111111),
            primary_hover: pick(0xffffff, 0x2a2a2a),
            primary_active: pick(0xcfcfcf, 0x000000),
            on_primary: pick(0x1a1a1a, 0xffffff),
            highlighter: rgb(0xf2d24b).into(),
            on_highlighter: rgb(0x1a1600).into(),
            highlighter_ink: pick(0xf2d24b, 0x806200),
            highlighter_wash: pick(0x3b3416, 0xfff0a1),
            danger: pick(0xf07a72, 0xc4302b),
        }
    }
}

/// Apply one scale to native typography and every shared layout dimension.
pub fn set_zoom(cx: &mut App, factor: f32) {
    let factor = if factor.is_finite() {
        factor.clamp(ZOOM_RANGE.0, ZOOM_RANGE.1)
    } else {
        1.0
    };
    Theme::update(cx, |theme| apply_zoom(theme, factor));
    cx.refresh_windows();
}

/// A design pixel at 100%; using the theme scale also scales actual hitboxes.
pub fn unit(cx: &App, value: f32) -> Pixels {
    px(value) * zoom(cx)
}

/// [`unit()`] at the current zoom as a function of its own, for code that sizes many things:
/// `let unit = units(cx);` then `unit(12.)`. It keeps no borrow of `cx`, so it can be
/// moved into closures and used while `cx` is borrowed mutably.
pub fn units(cx: &App) -> impl Fn(f32) -> Pixels + Copy + 'static {
    let zoom = zoom(cx);
    move |value| px(value) * zoom
}

/// The current zoom factor, read back from the theme's font size.
fn zoom(cx: &App) -> f32 {
    Theme::global(cx).font_size / px(BASE_FONT_SIZE)
}

/// Scales the theme's own sizes (text and corner radii) to `factor`.
fn apply_zoom(theme: &mut Theme, factor: f32) {
    theme.font_size = px(BASE_FONT_SIZE) * factor;
    theme.radius = px(scale::RADIUS_MD) * factor;
    theme.radius_lg = px(scale::RADIUS_LG) * factor;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// WCAG relative luminance of `color`.
    fn luminance(color: Hsla) -> f32 {
        let color = color.to_rgb();
        let linear = |channel: f32| {
            if channel <= 0.03928 {
                channel / 12.92
            } else {
                ((channel + 0.055) / 1.055).powf(2.4)
            }
        };
        0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
    }

    fn contrast(a: Hsla, b: Hsla) -> f32 {
        let (a, b) = (luminance(a), luminance(b));
        (a.max(b) + 0.05) / (a.min(b) + 0.05)
    }

    /// The quiet inks small text is set in (a page's meta line, an out-of-date line) and the
    /// failure ink stay legible on the canvas in both appearances.
    #[test]
    fn the_small_text_inks_pass_aa_on_the_canvas() {
        for mode in [ThemeMode::Light, ThemeMode::Dark] {
            let palette = Palette::of(mode);
            for (name, ink) in [
                ("muted", palette.muted),
                ("faint", palette.faint),
                ("danger", palette.danger),
            ] {
                let ratio = contrast(ink, palette.background);
                assert!(ratio >= 4.5, "{name} on the canvas, {mode:?}: {ratio:.2}:1");
            }
        }
    }
}
