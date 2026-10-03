//! [`DiagramCanvas`]: a [`DiagramView`] to explore: drag or scroll to move around, hold Ctrl
//! (⌘ on macOS) and scroll to zoom where the pointer is, double-click to fit the whole
//! diagram, and a small toolbar that does the same. Once clicked it takes the keyboard too:
//! the arrow keys move, `+` and `-` zoom, `0` shows it at its natural size and `F` fits it.
//! It opens as large as fits the viewport's width, but never so small its words can't be
//! read; a tall diagram then scrolls down from its top.
//!
//! It sits on a dot grid that moves with the drawing, so a pan is felt even across empty
//! space, and says how to get around in a quiet caption until it is first clicked.
//!
//! It keeps no data of its own beyond the diagram and where the view is; the caller keeps
//! the entity for as long as the diagram is on screen, and gives the toolbar its words.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::assets::IconName;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{
    App, Bounds, Context, CursorStyle, Div, FocusHandle, InteractiveElement as _, IntoElement,
    KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement as _,
    Pixels, Point, Render, Role, ScrollWheelEvent, SharedString, Size,
    StatefulInteractiveElement as _, Styled as _, Window, canvas, div, point, px,
};
use study_diagram::Diagram;

use crate::DiagramView;
use crate::button::{button, icon_button};
use crate::ids;
use crate::theme::units;

/// The closest and farthest the view zooms, as multiples of the diagram's natural size.
const ZOOM: (f32, f32) = (0.2, 3.);
/// How much one toolbar step zooms.
const STEP: f32 = 1.25;
/// The smallest zoom a diagram opens at, so its 16px hand-drawn words stay at least 12px.
const READABLE: f32 = 0.75;
/// Room kept around a fitted diagram, in pixels at the current interface zoom.
const MARGIN: f32 = 24.;
/// How far one press of an arrow key moves, in pixels at the current interface zoom.
const NUDGE: f32 = 48.;
/// The arrow keys' names, as GPUI reports them.
const LEFT: &str = "left";
const RIGHT: &str = "right";
const UP: &str = "up";
const DOWN: &str = "down";

/// What the toolbar's buttons are called, and how it writes the zoom, in the reader's
/// language.
#[derive(Clone, Debug)]
pub struct DiagramLabels {
    pub zoom_in: SharedString,
    pub zoom_out: SharedString,
    pub fit: SharedString,
    pub actual_size: SharedString,
    /// How to move and zoom, shown in a corner until the canvas is first clicked.
    pub hint: SharedString,
    /// The zoom as a percentage, such as `125%`.
    pub percent: fn(u16) -> String,
}

/// The dot grid's spacing at 100%, in pixels.
const GRID: f32 = 24.;

/// A diagram in a viewport the reader can move and zoom.
pub struct DiagramCanvas {
    diagram: Diagram,
    labels: DiagramLabels,
    height: f32,
    zoom: f32,
    /// Where the diagram's top-left corner sits in the viewport.
    offset: Point<Pixels>,
    /// While dragging: where the pointer went down, and the offset then.
    drag: Option<(Point<Pixels>, Point<Pixels>)>,
    /// The viewport as last painted, so zooming and fitting know where it is.
    viewport: Rc<Cell<Option<Bounds<Pixels>>>>,
    /// The diagram's size at zoom 1, as last laid out.
    natural: Rc<Cell<Option<Size<Pixels>>>>,
    /// Set once the view has been fitted to its first viewport.
    fitted: bool,
    /// Set once the reader clicks in, so the hint has done its job.
    explored: bool,
    /// Takes the keyboard once the canvas is clicked.
    focus: FocusHandle,
}

impl DiagramCanvas {
    /// `diagram` in a viewport `height` units tall, its toolbar saying `labels`.
    pub fn new(
        diagram: Diagram,
        labels: DiagramLabels,
        height: f32,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            diagram,
            labels,
            height,
            zoom: 1.,
            offset: Point::default(),
            drag: None,
            viewport: Rc::default(),
            natural: Rc::default(),
            fitted: false,
            explored: false,
            focus: cx.focus_handle(),
        }
    }

    /// The viewport's size, the diagram's natural size and the margin, in pixels; `None`
    /// until both sizes are known, or while the viewport or the diagram has none.
    fn measure(&self, cx: &App) -> Option<(f32, f32, f32, f32, f32)> {
        let viewport = self
            .viewport
            .get()
            .filter(|viewport| !viewport.is_empty())?;
        let natural = self.natural.get()?;
        let (natural_width, natural_height) = (f32::from(natural.width), f32::from(natural.height));
        if natural_width <= 0. || natural_height <= 0. {
            return None;
        }
        Some((
            f32::from(viewport.size.width),
            f32::from(viewport.size.height),
            natural_width,
            natural_height,
            f32::from(units(cx)(MARGIN)),
        ))
    }

    /// The first view: as large as fits the width, never beyond its natural size nor below
    /// [`READABLE`]; centred across, and from the top when it's taller than the viewport.
    fn open(&mut self, cx: &mut Context<Self>) {
        let Some((width, height, natural_width, natural_height, margin)) = self.measure(cx) else {
            return;
        };
        let zoom = ((width - 2. * margin) / natural_width).clamp(READABLE, 1.);
        let top = if natural_height * zoom + 2. * margin <= height {
            (height - natural_height * zoom) / 2.
        } else {
            margin
        };
        self.zoom = zoom;
        self.offset = point(px((width - natural_width * zoom) / 2.), px(top));
        self.fitted = true;
        cx.notify();
    }

    /// Zooms to show the whole diagram, centred, never beyond its natural size.
    fn fit(&mut self, cx: &mut Context<Self>) {
        let Some((width, height, natural_width, natural_height, margin)) = self.measure(cx) else {
            return;
        };
        let zoom = ((width - 2. * margin) / natural_width)
            .min((height - 2. * margin) / natural_height)
            .clamp(ZOOM.0, 1.);
        self.zoom = zoom;
        self.offset = point(
            px((width - natural_width * zoom) / 2.),
            px((height - natural_height * zoom) / 2.),
        );
        self.fitted = true;
        cx.notify();
    }

    /// Zooms by `factor` keeping the point `at` (in viewport coordinates) where it is.
    fn zoom_by(&mut self, factor: f32, at: Point<Pixels>, cx: &mut Context<Self>) {
        let zoom = (self.zoom * factor).clamp(ZOOM.0, ZOOM.1);
        let ratio = zoom / self.zoom;
        self.offset = at - (at - self.offset) * ratio;
        self.zoom = zoom;
        cx.notify();
    }

    /// Zooms by `factor` around the middle of the viewport, as the toolbar and keys do.
    fn zoom_centred(&mut self, factor: f32, cx: &mut Context<Self>) {
        let middle = self.viewport.get().map_or(Point::default(), |viewport| {
            point(viewport.size.width / 2., viewport.size.height / 2.)
        });
        self.zoom_by(factor, middle, cx);
    }

    /// Shows the diagram at its natural size, around the middle of the viewport.
    fn actual_size(&mut self, cx: &mut Context<Self>) {
        self.zoom_centred(1. / self.zoom, cx);
    }

    fn key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        if crate::is_shortcut(event.keystroke.modifiers) {
            return;
        }
        let nudge = units(cx)(NUDGE);
        // An arrow moves the view, so the diagram slides the other way.
        let mut nudge_by = |x: Pixels, y: Pixels| {
            self.offset += point(x, y);
            cx.notify();
        };
        let key = event.keystroke.key.as_str();
        // A typed key is one character; the arrows have names.
        let mut chars = key.chars();
        let typed = chars.next().filter(|_| chars.next().is_none());
        match (key, typed) {
            (LEFT, _) => nudge_by(nudge, px(0.)),
            (RIGHT, _) => nudge_by(-nudge, px(0.)),
            (UP, _) => nudge_by(px(0.), nudge),
            (DOWN, _) => nudge_by(px(0.), -nudge),
            (_, Some('+' | '=')) => self.zoom_centred(STEP, cx),
            (_, Some('-' | '_')) => self.zoom_centred(1. / STEP, cx),
            (_, Some('0')) => self.actual_size(cx),
            (_, Some('f' | 'F')) => self.fit(cx),
            _ => return,
        }
        cx.stop_propagation();
    }

    fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus, cx);
        self.explored = true;
        if event.click_count >= 2 {
            self.fit(cx);
            return;
        }
        self.drag = Some((event.position, self.offset));
        cx.notify();
    }

    fn mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        let Some((start, from)) = self.drag else {
            return;
        };
        // The release can land outside the window and never arrive; a move without the
        // button down ends the drag instead.
        if event.pressed_button != Some(MouseButton::Left) {
            self.drag = None;
            cx.notify();
            return;
        }
        self.offset = from + (event.position - start);
        cx.notify();
    }

    fn mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.drag = None;
        cx.notify();
    }

    fn scroll(&mut self, event: &ScrollWheelEvent, _: &mut Window, cx: &mut Context<Self>) {
        // A wheel that scrolls by lines moves 20 pixels a line.
        let delta = event.delta.pixel_delta(px(20.));
        if event.modifiers.control || event.modifiers.platform {
            let origin = self.viewport.get().map_or(Point::default(), |v| v.origin);
            // Exponential, so scrolling back the same distance returns to the same zoom.
            let factor = (f32::from(delta.y) * 0.004).exp();
            self.zoom_by(factor, event.position - origin, cx);
        } else {
            self.offset += delta;
            cx.notify();
        }
        // The wheel is the diagram's while over it: the page around it stays put.
        cx.stop_propagation();
    }

    /// The floating zoom controls in the top-right corner. A press on them is theirs alone:
    /// it focuses the canvas but stops there, so it neither starts a drag nor, pressed twice
    /// quickly, fits the diagram before the button acts.
    /// `percent` is the zoom as its button shows it.
    fn toolbar(&self, percent: SharedString, cx: &mut Context<Self>) -> Div {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let labels = &self.labels;
        div()
            .absolute()
            .top(unit(10.))
            .right(unit(10.))
            .flex()
            .items_center()
            .gap(unit(2.))
            .p(unit(crate::scale::SPACE_XXS))
            .rounded(unit(crate::scale::RADIUS_LG))
            .border_1()
            .border_color(colors.border)
            .bg(crate::theme::palette(cx).raised)
            .shadow(crate::theme::float_shadow(cx))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    window.focus(&this.focus, cx);
                    cx.stop_propagation();
                }),
            )
            .child(
                icon_button(
                    ids::DIAGRAM_ZOOM_OUT,
                    labels.zoom_out.clone(),
                    IconName::ZoomOut,
                    cx,
                )
                .on_click(cx.listener(|this, _, _, cx| this.zoom_centred(1. / STEP, cx))),
            )
            .child(
                button(ids::DIAGRAM_ACTUAL_SIZE, percent, cx)
                    .tooltip(labels.actual_size.clone())
                    .on_click(cx.listener(|this, _, _, cx| this.actual_size(cx))),
            )
            .child(
                icon_button(
                    ids::DIAGRAM_ZOOM_IN,
                    labels.zoom_in.clone(),
                    IconName::ZoomIn,
                    cx,
                )
                .on_click(cx.listener(|this, _, _, cx| this.zoom_centred(STEP, cx))),
            )
            .child(
                icon_button(ids::DIAGRAM_FIT, labels.fit.clone(), IconName::Maximize, cx)
                    .on_click(cx.listener(|this, _, _, cx| this.fit(cx))),
            )
    }
}

impl Render for DiagramCanvas {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let palette = crate::theme::palette(cx);
        // Open the view once a frame has found the viewport with room in it.
        if !self.fitted && self.viewport.get().is_some() && self.natural.get().is_some() {
            self.open(cx);
        }
        let viewport = self.viewport.clone();
        let natural = self.natural.clone();
        let zoom = self.zoom;
        let first_frame = !self.fitted;
        let (offset, dot) = (self.offset, palette.faint.opacity(0.35));
        let tracker = canvas(
            move |bounds, window, _| {
                let had_room = viewport.get().is_some_and(|viewport| !viewport.is_empty());
                viewport.set(Some(bounds));
                // Too late in this frame to open the view, so the next one does.
                if first_frame && !had_room && !bounds.is_empty() {
                    window.request_animation_frame();
                }
            },
            // The dot grid, shifted with the drawing and spaced with its zoom.
            move |bounds, _, window, _| {
                let spacing = (GRID * zoom).clamp(GRID / 2., GRID * 2.);
                let size = px(2.);
                let start = |origin: Pixels, shift: Pixels| {
                    origin + px(f32::from(shift).rem_euclid(spacing)) - size / 2.
                };
                let mut y = start(bounds.origin.y, offset.y);
                while y < bounds.bottom() {
                    let mut x = start(bounds.origin.x, offset.x);
                    while x < bounds.right() {
                        window.paint_quad(gpui_kit::fill(
                            Bounds::new(point(x, y), gpui_kit::size(size, size)),
                            dot,
                        ));
                        x += px(spacing);
                    }
                    y += px(spacing);
                }
            },
        )
        .absolute()
        .size_full();
        let drawing = DiagramView::new(self.diagram.clone())
            .id(ids::DIAGRAM_DRAWING)
            .scale(zoom)
            .on_laid_out(move |size| natural.set(Some(size / zoom)));
        let percent = SharedString::from((self.labels.percent)((zoom * 100.).round() as u16));
        let toolbar = self.toolbar(percent.clone(), cx);
        div()
            .id(ids::DIAGRAM_CANVAS)
            // Found by tests and agents, its zoom as its value.
            .test_support()
            .role(Role::Group)
            .aria_value(percent)
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::key_down))
            .relative()
            .w_full()
            .h(unit(self.height))
            .overflow_hidden()
            .rounded(unit(crate::scale::RADIUS_LG))
            // A raised tile; a ring only once it has the keyboard.
            .border_1()
            .border_color(if self.focus.is_focused(window) {
                colors.ring
            } else {
                gpui_kit::transparent_black()
            })
            .bg(palette.fill)
            .cursor(if self.drag.is_some() {
                CursorStyle::ClosedHand
            } else {
                CursorStyle::OpenHand
            })
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_move(cx.listener(Self::mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_scroll_wheel(cx.listener(Self::scroll))
            .child(tracker)
            .child(
                div()
                    .absolute()
                    .left(self.offset.x)
                    .top(self.offset.y)
                    .child(drawing),
            )
            .child(toolbar)
            .when(!self.explored, |canvas| {
                canvas.child(
                    div()
                        .absolute()
                        .left(unit(crate::scale::SPACE_SM))
                        .bottom(unit(crate::scale::SPACE_SM))
                        .max_w(unit(420.))
                        .px(unit(crate::scale::SPACE_XS))
                        .py(unit(crate::scale::SPACE_XXS))
                        .rounded(unit(crate::scale::RADIUS_SM))
                        .bg(palette.fill.opacity(0.85))
                        .text_size(unit(crate::scale::TEXT_CAPTION))
                        .text_color(palette.faint)
                        .whitespace_normal()
                        .child(self.labels.hint.clone()),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::component::ThemeMode;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AnyWindowHandle, AppContext as _, Entity, TestAppContext, WindowOptions, size};

    fn labels() -> DiagramLabels {
        DiagramLabels {
            zoom_in: "in".into(),
            zoom_out: "out".into(),
            fit: "fit".into(),
            actual_size: "100%".into(),
            hint: "drag to move".into(),
            percent: |percent| format!("{percent}%"),
        }
    }

    /// Starts the UI toolkit and the theme for a test.
    fn init(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(|cx| crate::configure_theme(cx, ThemeMode::Light));
    }

    /// A canvas that has never been painted, so a test can set its viewport and size itself.
    fn unpainted(cx: &mut TestAppContext) -> Entity<DiagramCanvas> {
        init(cx);
        let diagram = study_diagram::mermaid::parse("flowchart LR\na[Cell] --> b[Energy]").diagram;
        cx.new(|cx| DiagramCanvas::new(diagram, labels(), 400., cx))
    }

    fn sized(width: f32, height: f32) -> Size<Pixels> {
        size(px(width), px(height))
    }

    /// A diagram far wider than its viewport opens at the readable zoom, not fitted smaller.
    #[gpui_kit::test]
    fn a_wide_diagram_opens_no_smaller_than_readable(cx: &mut TestAppContext) {
        let canvas = unpainted(cx);
        let zoom = canvas.update(cx, |canvas, cx| {
            canvas
                .viewport
                .set(Some(Bounds::new(Point::default(), sized(400., 300.))));
            canvas.natural.set(Some(sized(4000., 200.)));
            canvas.open(cx);
            canvas.zoom
        });
        assert_eq!(zoom, READABLE);
    }

    /// Opening or fitting before the viewport is known, in a viewport with no room, or with a
    /// diagram of no size, leaves the view where it was.
    #[gpui_kit::test]
    fn opening_and_fitting_without_sizes_leave_the_view(cx: &mut TestAppContext) {
        let canvas = unpainted(cx);
        let viewport = Bounds::new(Point::default(), sized(400., 300.));
        let unchanged = canvas.update(cx, |canvas, cx| {
            canvas.zoom = 2.;
            canvas.offset = point(px(7.), px(9.));
            let mut unchanged = Vec::new();
            for (viewport, natural) in [
                (None, Some(sized(300., 200.))),
                (
                    Some(Bounds::new(Point::default(), sized(400., 0.))),
                    Some(sized(300., 200.)),
                ),
                (Some(viewport), Some(sized(0., 200.))),
                (Some(viewport), Some(sized(300., 0.))),
            ] {
                canvas.viewport.set(viewport);
                canvas.natural.set(natural);
                canvas.open(cx);
                canvas.fit(cx);
                unchanged.push((canvas.zoom, canvas.offset, canvas.fitted));
            }
            unchanged
        });
        for state in unchanged {
            assert_eq!(state, (2., point(px(7.), px(9.)), false));
        }
    }

    /// A canvas `height` units tall, in a window of its own that has drawn its first frame.
    fn painted(height: f32, cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<DiagramCanvas>) {
        let diagram = study_diagram::mermaid::parse("flowchart LR\na[Cell] --> b[Energy]").diagram;
        let painted = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                cx.new(|cx| DiagramCanvas::new(diagram, labels(), height, cx))
            })
            .unwrap()
        });
        cx.run_until_parked();
        painted
    }

    /// Delivers the next frame, drawing whatever asked for it.
    fn next_frame(window: AnyWindowHandle, cx: &mut TestAppContext) {
        cx.update_window(window, |_, window, cx| window.simulate_next_frame(cx))
            .unwrap();
        cx.run_until_parked();
    }

    fn view(canvas: &Entity<DiagramCanvas>, cx: &mut TestAppContext) -> (bool, f32, Point<Pixels>) {
        cx.update(|cx| {
            let canvas = canvas.read(cx);
            (canvas.fitted, canvas.zoom, canvas.offset)
        })
    }

    /// The first frame tells the canvas where its viewport is, and it opens the view on the
    /// next by itself.
    #[gpui_kit::test]
    fn a_canvas_opens_by_itself_after_its_first_frame(cx: &mut TestAppContext) {
        init(cx);
        let (window, canvas) = painted(400., cx);
        next_frame(window, cx);
        assert!(view(&canvas, cx).0);
    }

    /// A canvas first painted with no room, as in a parent not yet laid out, waits; once it
    /// has room it opens by itself, just as one painted at that size from the start.
    #[gpui_kit::test]
    fn a_canvas_painted_without_room_opens_once_it_has_room(cx: &mut TestAppContext) {
        init(cx);
        let (window, canvas) = painted(0., cx);
        next_frame(window, cx);
        assert!(!view(&canvas, cx).0);
        canvas.update(cx, |canvas, cx| {
            canvas.height = 400.;
            cx.notify();
        });
        next_frame(window, cx);
        let (straight_window, straight) = painted(400., cx);
        next_frame(straight_window, cx);
        assert_eq!(view(&canvas, cx), view(&straight, cx));
    }

    /// Zooming in or out again and again stops at the closest and farthest zoom.
    #[gpui_kit::test]
    fn zooming_stops_at_its_bounds(cx: &mut TestAppContext) {
        let canvas = unpainted(cx);
        let (closest, farthest) = canvas.update(cx, |canvas, cx| {
            for _ in 0..20 {
                canvas.zoom_by(STEP, Point::default(), cx);
            }
            let closest = canvas.zoom;
            for _ in 0..40 {
                canvas.zoom_by(1. / STEP, Point::default(), cx);
            }
            (closest, canvas.zoom)
        });
        assert_eq!((closest, farthest), (ZOOM.1, ZOOM.0));
    }

    /// Once clicked, the canvas zooms with + and -, shows its natural size with 0 and moves
    /// with the arrow keys.
    #[gpui_kit::test]
    fn the_keyboard_zooms_and_moves_a_focused_canvas(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(|cx| crate::configure_theme(cx, ThemeMode::Light));
        let diagram = study_diagram::mermaid::parse("flowchart LR\na[Cell] --> b[Energy]").diagram;
        let (window, canvas) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                cx.new(|cx| DiagramCanvas::new(diagram, labels(), 400., cx))
            })
            .unwrap()
        });
        let render = |cx: &mut TestAppContext| {
            cx.update_window(window, |_, window, cx| window.render_frame(cx))
                .unwrap();
        };
        render(cx);
        render(cx);
        cx.update_window(window, |_, window, cx| {
            let focus = canvas.read(cx).focus.clone();
            window.focus(&focus, cx);
        })
        .unwrap();
        render(cx);
        let state = |cx: &mut TestAppContext| {
            cx.update(|cx| {
                let canvas = canvas.read(cx);
                (canvas.zoom, canvas.offset)
            })
        };

        cx.simulate_keystrokes(window, "0");
        assert_eq!(state(cx).0, 1.);
        cx.simulate_keystrokes(window, "+");
        assert!((state(cx).0 - STEP).abs() < 1e-4);
        cx.simulate_keystrokes(window, "- -");
        assert!((state(cx).0 - 1. / STEP).abs() < 1e-4);
        let before = state(cx).1;
        cx.simulate_keystrokes(window, "left up");
        let after = state(cx).1;
        assert!(
            after.x > before.x && after.y > before.y,
            "{before:?} {after:?}"
        );
    }

    /// A quick double press on a toolbar button runs the button twice; the canvas under it
    /// neither fits the diagram nor starts a drag.
    #[gpui_kit::test]
    fn toolbar_presses_stay_on_the_toolbar(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(|cx| crate::configure_theme(cx, ThemeMode::Light));
        let diagram = study_diagram::mermaid::parse("flowchart LR\na[Cell] --> b[Energy]").diagram;
        let (window, canvas) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                cx.new(|cx| DiagramCanvas::new(diagram, labels(), 400., cx))
            })
            .unwrap()
        });
        for _ in 0..2 {
            cx.update_window(window, |_, window, cx| window.render_frame(cx))
                .unwrap();
        }
        cx.update(|cx| canvas.update(cx, |canvas, cx| canvas.actual_size(cx)));
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            window.double_click(ids::DIAGRAM_ZOOM_IN, cx);
        })
        .unwrap();
        let (zoom, dragging) = cx.update(|cx| {
            let canvas = canvas.read(cx);
            (canvas.zoom, canvas.drag.is_some())
        });
        assert!((zoom - STEP * STEP).abs() < 1e-4, "{zoom}");
        assert!(!dragging);
    }
}
