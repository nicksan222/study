//! Hand-drawn strokes, the way Excalidraw draws them: `roughr`, a port of rough.js (which
//! Excalidraw draws with), turns each shape into wobbly outlines, and this module turns
//! those into plain [`Stroke`]s any renderer can paint. Each shape has its own seed, so it
//! looks the same on every frame.

use roughr::core::{Drawable, FillStyle, OpSetType, OpType, Options, OptionsBuilder};
use roughr::generator::Generator;
use roughr::{PathSegment, Point2D, Srgba};

use crate::layout::{Point, Rect};
use crate::model::{LineStyle, NodeShape};

/// One step of a path.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Move(Point),
    Line(Point),
    /// A cubic Bézier curve through two control points.
    Curve {
        a: Point,
        b: Point,
        to: Point,
    },
}

/// How a path is painted.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Paint {
    Stroke {
        width: f32,
        /// For a dotted line: the length of each dash and of each gap after it.
        dash: Option<Dash>,
    },
    Fill,
}

/// A dotted line's rhythm, in diagram units like the path.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dash {
    pub on: f32,
    pub off: f32,
}

impl Dash {
    /// The dashes of a line `width` wide: short, so it reads as dotted at any thickness.
    fn for_width(width: f32) -> Self {
        Self {
            on: width * 4.,
            off: width * 3.,
        }
    }
}

/// What colour a path takes; a [`Palette`] says which colour that is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
    /// Outlines, arrows and text.
    Line,
    /// A box's fill, numbered by the box's rank so each rank can have its own colour.
    Tone(usize),
}

/// The colours a scene is drawn in, of whatever colour type the renderer paints with.
#[derive(Clone, Copy, Debug)]
pub struct Palette<'a, C> {
    /// Outlines, arrows and text.
    pub ink: C,
    /// The background.
    pub paper: C,
    /// Box fills, by rank and round again.
    pub tones: &'a [C],
}

impl<C: Copy> Palette<'_, C> {
    /// The colour of `ink`: a tone is the one for its rank, round again past the last, and
    /// with no tones at all a box is filled with paper.
    pub fn colour(&self, ink: Ink) -> C {
        match ink {
            Ink::Line => self.ink,
            Ink::Tone(rank) => rank
                .checked_rem(self.tones.len())
                .map_or(self.paper, |index| self.tones[index]),
        }
    }
}

/// One path to paint, in diagram coordinates.
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    pub paint: Paint,
    pub ink: Ink,
    pub path: Vec<Op>,
}

/// Turns shapes into strokes, all with one pen.
pub(crate) struct Pen {
    generator: Generator,
    width: f32,
}

impl Pen {
    pub fn new(width: f32) -> Self {
        Self {
            generator: Generator::default(),
            width,
        }
    }

    fn options(&self, seed: u64, width: f32, filled: bool) -> Option<Options> {
        let mut options = OptionsBuilder::default();
        options.seed(seed).stroke_width(width).roughness(1.);
        if filled {
            // `roughr` only fills when a fill colour is set; the renderer picks the real
            // one. Solid, not hachure, so labels stay readable on top.
            options
                .fill(Srgba::new(0., 0., 0., 1.))
                .fill_style(FillStyle::Solid);
        }
        // Never `None`: every `roughr` option has a builder default.
        options.build().ok()
    }

    /// A box of the given outline, filled with `tone`.
    pub fn node(
        &self,
        shape: NodeShape,
        rect: Rect,
        tone: usize,
        seed: u64,
        into: &mut Vec<Stroke>,
    ) {
        let options = self.options(seed, self.width, true);
        let Rect { x, y, w, h } = rect;
        let drawable = match shape {
            NodeShape::Rectangle => self.generator.rectangle(x, y, w, h, &options),
            NodeShape::Rounded => self.generator.path_from_segments(rounded(rect), &options),
            NodeShape::Diamond => {
                let (cx, cy) = rect.center();
                let points = [
                    Point2D::new(cx, y),
                    Point2D::new(x + w, cy),
                    Point2D::new(cx, y + h),
                    Point2D::new(x, cy),
                ];
                self.generator.polygon(&points, &options)
            }
            NodeShape::Ellipse => {
                let (cx, cy) = rect.center();
                self.generator.ellipse(cx, cy, w, h, &options)
            }
        };
        self.collect(drawable, Ink::Tone(tone), None, into);
    }

    /// An arrow along `path`, drawn in `style`, with an open head at its last point if
    /// `head`.
    pub fn arrow(
        &self,
        path: &[Point],
        style: LineStyle,
        head: bool,
        seed: u64,
        into: &mut Vec<Stroke>,
    ) {
        let [.., before, tip] = path else {
            return;
        };
        let width = match style {
            LineStyle::Thick => self.width * 2.,
            LineStyle::Solid | LineStyle::Dotted => self.width,
        };
        let dash = (style == LineStyle::Dotted).then(|| Dash::for_width(width));
        let options = self.options(seed, width, false);
        let shaft = if path.len() > 2 {
            let points: Vec<Point2D<f32>> = path.iter().map(|&(x, y)| Point2D::new(x, y)).collect();
            self.generator.curve(&points, &options)
        } else {
            self.generator
                .line(before.0, before.1, tip.0, tip.1, &options)
        };
        self.collect(shaft, Ink::Line, dash, into);
        if !head {
            return;
        }
        let angle = (tip.1 - before.1).atan2(tip.0 - before.0);
        let length = self.width * 8. + width * 2.;
        // Two barbs, about 26° either side of the shaft.
        for (side, spread) in [(1, 0.45f32), (2, -0.45)] {
            let back = angle + std::f32::consts::PI + spread;
            let end = (tip.0 + length * back.cos(), tip.1 + length * back.sin());
            let options = self.options(seed.wrapping_add(side), width, false);
            let barb = self.generator.line(tip.0, tip.1, end.0, end.1, &options);
            self.collect(barb, Ink::Line, None, into);
        }
    }

    /// A thin rule from `from` to `to`, as under a card's title.
    pub fn rule(&self, from: Point, to: Point, seed: u64, into: &mut Vec<Stroke>) {
        let width = self.width * 0.6;
        let mut options = self.options(seed, width, false);
        if let Some(options) = &mut options {
            // One pass and a little bow: a quick pen stroke, lighter than an outline.
            options.disable_multi_stroke = Some(true);
            options.roughness = Some(0.6);
        }
        let line = self.generator.line(from.0, from.1, to.0, to.1, &options);
        self.collect(line, Ink::Line, None, into);
    }

    fn collect(
        &self,
        drawable: Drawable<f32>,
        fill: Ink,
        dash: Option<Dash>,
        into: &mut Vec<Stroke>,
    ) {
        let width = drawable.options.stroke_width.unwrap_or(self.width);
        for set in drawable.sets {
            let (paint, ink) = match set.op_set_type {
                OpSetType::Path => (Paint::Stroke { width, dash }, Ink::Line),
                OpSetType::FillSketch => (
                    Paint::Stroke {
                        width: width / 2.,
                        dash: None,
                    },
                    fill,
                ),
                OpSetType::FillPath => (Paint::Fill, fill),
            };
            let path = set
                .ops
                .iter()
                .filter_map(|op| match (&op.op, op.data.as_slice()) {
                    (OpType::Move, &[x, y, ..]) => Some(Op::Move((x, y))),
                    (OpType::LineTo, &[x, y, ..]) => Some(Op::Line((x, y))),
                    (OpType::BCurveTo, &[ax, ay, bx, by, x, y, ..]) => Some(Op::Curve {
                        a: (ax, ay),
                        b: (bx, by),
                        to: (x, y),
                    }),
                    _ => None,
                })
                .collect();
            into.push(Stroke { paint, ink, path });
        }
    }
}

/// A rounded rectangle's outline, with corners like Excalidraw's.
fn rounded(rect: Rect) -> Vec<PathSegment> {
    let (x, y, w, h) = (
        f64::from(rect.x),
        f64::from(rect.y),
        f64::from(rect.w),
        f64::from(rect.h),
    );
    let r = (w.min(h) * 0.25).min(16.);
    let line = |x, y| PathSegment::LineTo { abs: true, x, y };
    let corner = |x1, y1, x, y| PathSegment::Quadratic {
        abs: true,
        x1,
        y1,
        x,
        y,
    };
    vec![
        PathSegment::MoveTo {
            abs: true,
            x: x + r,
            y,
        },
        line(x + w - r, y),
        corner(x + w, y, x + w, y + r),
        line(x + w, y + h - r),
        corner(x + w, y + h, x + w - r, y + h),
        line(x + r, y + h),
        corner(x, y + h, x, y + h - r),
        line(x, y + r),
        corner(x, y, x + r, y),
        PathSegment::ClosePath { abs: true },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECT: Rect = Rect {
        x: 10.,
        y: 20.,
        w: 100.,
        h: 50.,
    };

    fn points(strokes: &[Stroke]) -> impl Iterator<Item = Point> + '_ {
        strokes.iter().flat_map(|s| &s.path).map(|op| match *op {
            Op::Move(p) | Op::Line(p) | Op::Curve { to: p, .. } => p,
        })
    }

    #[test]
    fn every_shape_is_filled_and_outlined_near_its_bounds() {
        let pen = Pen::new(2.);
        for shape in [
            NodeShape::Rectangle,
            NodeShape::Rounded,
            NodeShape::Diamond,
            NodeShape::Ellipse,
        ] {
            let mut strokes = Vec::new();
            pen.node(shape, RECT, 3, 1, &mut strokes);
            assert!(
                strokes
                    .iter()
                    .any(|s| s.paint == Paint::Fill && s.ink == Ink::Tone(3)),
                "{shape:?}"
            );
            assert!(strokes.iter().any(|s| s.ink == Ink::Line), "{shape:?}");
            for (x, y) in points(&strokes) {
                assert!(
                    RECT.holds((x, y), 8.),
                    "{shape:?}: ({x}, {y}) strays too far"
                );
            }
        }
    }

    #[test]
    fn the_same_seed_draws_the_same_strokes() {
        let pen = Pen::new(2.);
        let draw = |seed| {
            let mut strokes = Vec::new();
            pen.node(NodeShape::Rounded, RECT, 0, seed, &mut strokes);
            strokes
        };
        assert_eq!(draw(7), draw(7));
        assert_ne!(draw(7), draw(8));
    }

    #[test]
    fn a_rule_is_one_thin_stroke() {
        let mut strokes = Vec::new();
        Pen::new(2.).rule((0., 10.), (100., 10.), 1, &mut strokes);
        assert_eq!(strokes.len(), 1);
        assert!(matches!(strokes[0].paint, Paint::Stroke { width, .. } if width < 2.));
    }

    #[test]
    fn arrows_have_heads_only_when_asked_and_dots_when_dotted() {
        let pen = Pen::new(2.);
        let path = [(0., 0.), (0., 100.)];
        let mut plain = Vec::new();
        pen.arrow(&path, LineStyle::Solid, false, 1, &mut plain);
        let mut headed = Vec::new();
        pen.arrow(&path, LineStyle::Dotted, true, 1, &mut headed);
        assert!(headed.len() > plain.len());
        assert!(
            headed
                .iter()
                .any(|s| matches!(s.paint, Paint::Stroke { dash: Some(_), .. }))
        );
        assert!(
            plain
                .iter()
                .all(|s| matches!(s.paint, Paint::Stroke { dash: None, .. }))
        );
    }

    #[test]
    fn a_palette_colours_tones_by_rank_and_falls_back_to_paper() {
        let palette = Palette {
            ink: 'i',
            paper: 'p',
            tones: &['a', 'b'],
        };
        assert_eq!(palette.colour(Ink::Line), 'i');
        assert_eq!(palette.colour(Ink::Tone(1)), 'b');
        assert_eq!(palette.colour(Ink::Tone(2)), 'a', "round again");
        let bare = Palette {
            tones: &[],
            ..palette
        };
        assert_eq!(bare.colour(Ink::Tone(0)), 'p');
    }
}
