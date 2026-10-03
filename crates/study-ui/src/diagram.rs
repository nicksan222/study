//! [`DiagramView`]: paints a `study_diagram` [`Diagram`] in Excalifont, Excalidraw's
//! handwriting: its boxes as cards with a title and rows of detail. `study_diagram` does the
//! layout and sketching; this measures the text for it, picks the colours and paints the
//! [`Scene`]. [`diagram_svg`] draws the same diagram as an SVG image.

use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{
    App, ElementId, FillOptions, FillRule, Hsla, IntoElement, PathBuilder, PathStyle, Pixels,
    RenderOnce, ShapedLine, Size, Styled as _, TextAlign, TextRun, Window, canvas, font, point, px,
    rgb, size,
};
use std::cell::RefCell;
use std::rc::Rc;
use study_diagram::{Diagram, Metrics, Op, Paint, Palette, Scene, TextStyle};

/// The handwriting every label is written in, bundled by `configure_theme`.
const FONT: &str = "Excalifont";

/// The font size a diagram is laid out at before any scaling.
const NATURAL_FONT_SIZE: f32 = 20.;

/// Excalidraw's background colours, one per rank and round again: its light shades for the
/// light theme, and deep ones of the same hues for the dark theme, so the ink reads on
/// both.
const TONES: [(u32, u32); 5] = [
    (0xa5d8ff, 0x1c3d5a),
    (0xb2f2bb, 0x1f4a2c),
    (0xffec99, 0x4d4216),
    (0xffc9c9, 0x5a2626),
    (0xd0bfff, 0x3b2d66),
];

/// `diagram` as an SVG image, laid out as the app draws it at its natural size, with the
/// light theme's colours so it reads on any page.
pub fn diagram_svg(diagram: &Diagram, window: &mut Window) -> String {
    let metrics = Metrics::for_font_size(NATURAL_FONT_SIZE);
    let shape = shaper(window, metrics, gpui_kit::black());
    let scene = study_diagram::scene(diagram, metrics, |text, style| {
        f32::from(shape(text, style, 1.).width)
    });
    let tones: Vec<u32> = TONES.iter().map(|(light, _)| *light).collect();
    study_diagram::svg(
        &scene,
        Palette {
            ink: 0x1e1e1e,
            paper: 0xffffff,
            tones: &tones,
        },
    )
}

/// Shapes a label in the handwriting and `color`, at its style's size times a scale.
fn shaper(
    window: &Window,
    metrics: Metrics,
    color: Hsla,
) -> impl Fn(&str, TextStyle, f32) -> ShapedLine + 'static {
    let text_system = window.text_system().clone();
    move |text, style, scale| {
        let run = TextRun {
            len: text.len(),
            font: font(FONT),
            color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let size = px(metrics.size(style) * scale);
        text_system.shape_line(text.to_owned().into(), size, &[run], None)
    }
}

/// A hand-drawn diagram, sized to fit its content.
#[derive(IntoElement)]
pub struct DiagramView {
    diagram: Diagram,
    scale: f32,
    laid_out: Option<Box<dyn Fn(Size<Pixels>)>>,
    id: Option<ElementId>,
}

/// A layout kept across frames: for which font size and diagram, and the scene.
type Kept = Rc<RefCell<Option<(f32, Diagram, Rc<Scene>)>>>;

impl DiagramView {
    pub fn new(diagram: Diagram) -> Self {
        Self {
            diagram,
            scale: 1.,
            laid_out: None,
            id: None,
        }
    }

    /// Keeps its layout under `id` while it is drawn frame after frame, laying the diagram
    /// out again only when it or the font size changes. Without an id every frame lays it
    /// out, which suits a diagram drawn once.
    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Calls `laid_out` with the size the diagram takes, each time it is laid out.
    pub fn on_laid_out(mut self, laid_out: impl Fn(Size<Pixels>) + 'static) -> Self {
        self.laid_out = Some(Box::new(laid_out));
        self
    }

    /// Drawn `scale` times its natural size. The diagram is laid out once at its natural
    /// size and scaled as it is painted, so zooming never lays it out again.
    pub fn scale(mut self, scale: f32) -> Self {
        self.scale = scale;
        self
    }
}

/// The scene for `diagram`: the one in `kept` if it was laid out for the same diagram and
/// font size, else a fresh layout, which `kept` then keeps.
fn scene_for(
    diagram: &Diagram,
    metrics: Metrics,
    kept: Option<&Kept>,
    measure: impl Fn(&str, TextStyle) -> f32,
) -> Rc<Scene> {
    let font_size = metrics.size(TextStyle::Title);
    let cached = kept.and_then(|kept| {
        kept.borrow()
            .as_ref()
            .filter(|(size, kept_diagram, _)| *size == font_size && kept_diagram == diagram)
            .map(|(_, _, scene)| scene.clone())
    });
    if let Some(scene) = cached {
        return scene;
    }
    let scene = Rc::new(study_diagram::scene(diagram, metrics, measure));
    if let Some(kept) = kept {
        *kept.borrow_mut() = Some((font_size, diagram.clone(), scene.clone()));
    }
    scene
}

impl RenderOnce for DiagramView {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let metrics = Metrics::for_font_size(f32::from(crate::theme::unit(cx, NATURAL_FONT_SIZE)));
        let scale = self.scale;
        let ink = cx.theme().foreground;
        let paper = cx.theme().background;
        let dark = cx.theme().is_dark();
        let tones: [Hsla; TONES.len()] =
            TONES.map(|(light, deep)| rgb(if dark { deep } else { light }).into());
        let shape = shaper(window, metrics, ink);
        let kept = self.id.map(|id| {
            window
                .use_keyed_state(id, cx, |_, _| Kept::default())
                .read(cx)
                .clone()
        });
        let scene = scene_for(&self.diagram, metrics, kept.as_ref(), |text, style| {
            f32::from(shape(text, style, 1.).width)
        });
        let lines: Vec<_> = scene
            .texts
            .iter()
            .map(|text| shape(&text.text, text.style, scale))
            .collect();
        let (width, height) = (scene.width * scale, scene.height * scale);
        if let Some(laid_out) = &self.laid_out {
            laid_out(size(px(width), px(height)));
        }

        canvas(
            |_, _, _| {},
            move |bounds, (), window, cx| {
                let palette = Palette {
                    ink,
                    paper,
                    tones: &tones,
                };
                let at = |(x, y): (f32, f32)| bounds.origin + point(px(x * scale), px(y * scale));
                for stroke in &scene.strokes {
                    let mut path = match stroke.paint {
                        Paint::Stroke { width, dash } => {
                            let path = PathBuilder::stroke(px(width * scale));
                            match dash {
                                Some(dash) => {
                                    path.dash_array(&[px(dash.on * scale), px(dash.off * scale)])
                                }
                                None => path,
                            }
                        }
                        // Non-zero, as in SVG: rough fills loop round more than once,
                        // and even-odd would cancel the overlap out.
                        Paint::Fill => PathBuilder::fill().with_style(PathStyle::Fill(
                            FillOptions::default().with_fill_rule(FillRule::NonZero),
                        )),
                    };
                    for op in &stroke.path {
                        match *op {
                            Op::Move(p) => path.move_to(at(p)),
                            Op::Line(p) => path.line_to(at(p)),
                            Op::Curve { a, b, to } => path.cubic_bezier_to(at(to), at(a), at(b)),
                        }
                    }
                    if let Ok(path) = path.build() {
                        window.paint_path(path, palette.colour(stroke.ink));
                    }
                }
                for (text, line) in scene.texts.iter().zip(&lines) {
                    let origin = at(text.origin);
                    let line_height = px(metrics.line_height(text.style) * scale);
                    let _ = line.paint(origin, line_height, TextAlign::Left, None, window, cx);
                }
            },
        )
        .w(px(width))
        .h(px(height))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::component::ThemeMode;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{
        AppContext as _, Context, ParentElement as _, Render, TestAppContext, WindowOptions, div,
    };

    struct Host(Diagram);

    impl Render for Host {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().child(DiagramView::new(self.0.clone()))
        }
    }

    /// Every shape, a card with rows, and each kind of line, painted in both themes with
    /// the bundled handwriting.
    #[gpui_kit::test]
    fn a_diagram_of_cards_paints_in_both_themes(cx: &mut TestAppContext) {
        let diagram = study_diagram::mermaid::parse(
            "flowchart LR\n\
             a[\"Cell<br>Has a membrane [1]<br>Holds the cytoplasm\"] -->|makes| b([Energy])\n\
             b -.-> c{Enough?}\n\
             c ==>|yes| d((Growth))\n\
             d --- a",
        )
        .diagram;
        cx.update(gpui_kit::init);
        for mode in [ThemeMode::Light, ThemeMode::Dark] {
            cx.update(|cx| crate::configure_theme(cx, mode));
            let diagram = diagram.clone();
            let window = cx.update(|cx| {
                gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                    cx.new(|_| Host(diagram))
                })
                .unwrap()
                .0
            });
            cx.update_window(window, |_, window, cx| window.render_frame(cx))
                .unwrap();
        }
    }
}
