//! [`scene`]: a [`Diagram`] made ready to paint. Labels are wrapped and measured, boxes
//! sized to fit them and laid out, and everything turned into [`Stroke`]s and positioned
//! [`Text`]; a renderer only has to paint what it's given.
//!
//! A box with rows is drawn as a card: its title centred at the top, a rule under it, and
//! the rows below, each after a bullet, in the smaller [`TextStyle::Row`]. A diamond or an
//! ellipse centres its rows under the title, without the rule.
//!
//! Text is measured by the renderer, which knows the font, through the `measure` function
//! [`scene`] takes. Every length in [`Metrics`] comes from the font size, so zooming is
//! just a bigger font.

use std::f32::consts::SQRT_2;

use crate::layout::{self, Point, Rect};
use crate::model::{Diagram, Node, NodeShape};
use crate::sketch::{Pen, Stroke};

/// Which kind of text a line is, and so its size.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextStyle {
    /// A box's title.
    Title,
    /// A row of detail in a card, smaller than a title.
    Row,
    /// Written on an arrow, which breaks around it.
    EdgeLabel,
}

/// The sizes a scene is drawn at, in pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metrics {
    /// Of titles and edge labels.
    pub font_size: f32,
    pub line_height: f32,
    pub row_font_size: f32,
    pub row_line_height: f32,
    /// Space between a box's text and its edge, across and down.
    pub padding: (f32, f32),
    /// Space above and below the rule under a card's title.
    pub rule_gap: f32,
    /// Space between neighbouring boxes; ranks are twice this apart.
    pub gap: f32,
    /// How wide a box's text may get before wrapping.
    pub label_width: f32,
    /// The narrowest a box gets.
    pub min_width: f32,
    pub stroke_width: f32,
    /// How far an arrow stays clear of the text written on it.
    pub label_gap: f32,
}

impl Metrics {
    /// Proportions that look like Excalidraw at any size.
    pub fn for_font_size(font_size: f32) -> Self {
        let row_font_size = font_size * 0.8;
        Self {
            font_size,
            line_height: font_size * 1.25,
            row_font_size,
            row_line_height: row_font_size * 1.35,
            padding: (font_size * 1.1, font_size * 0.7),
            rule_gap: font_size * 0.4,
            gap: font_size * 2.,
            label_width: font_size * 11.,
            min_width: font_size * 4.,
            stroke_width: font_size / 10.,
            label_gap: font_size * 0.2,
        }
    }

    /// The font size of text in `style`.
    pub fn size(&self, style: TextStyle) -> f32 {
        match style {
            TextStyle::Title | TextStyle::EdgeLabel => self.font_size,
            TextStyle::Row => self.row_font_size,
        }
    }

    /// The line height of text in `style`.
    pub fn line_height(&self, style: TextStyle) -> f32 {
        match style {
            TextStyle::Title | TextStyle::EdgeLabel => self.line_height,
            TextStyle::Row => self.row_line_height,
        }
    }
}

/// One line of text, placed.
#[derive(Clone, Debug, PartialEq)]
pub struct Text {
    pub text: String,
    pub style: TextStyle,
    /// The top left corner of the line.
    pub origin: Point,
    /// As `measure` measured it.
    pub width: f32,
}

/// A diagram ready to paint, in pixels from its top left corner.
#[derive(Clone, Debug, PartialEq)]
pub struct Scene {
    pub width: f32,
    pub height: f32,
    /// In painting order: boxes, then arrows.
    pub strokes: Vec<Stroke>,
    /// Painted after the strokes.
    pub texts: Vec<Text>,
    pub metrics: Metrics,
}

/// Seeds set aside for each box; its outline and the rule under its title use the first
/// two, and the rest are spare.
const SEEDS_PER_BOX: u64 = 3;

/// The first arrow's seed, clear of the boxes' seeds for up to 3,333 boxes.
const FIRST_ARROW_SEED: u64 = 10_000;

/// Seeds set aside for each arrow; its shaft and its two barbs use the first three, the
/// shaft before its label the fourth, and the rest are spare.
const SEEDS_PER_ARROW: u64 = 5;

/// What goes before a row.
const BULLET: &str = "• ";

/// A line of text and its measured width.
type Line = (String, f32);

/// A box's text, wrapped and measured, before it is placed.
struct Card {
    title: Vec<Line>,
    /// Each row's lines; the first carries the bullet, and the rest are indented past it.
    rows: Vec<Vec<Line>>,
    bullet: f32,
    /// The width and height of the text block.
    text: (f32, f32),
}

impl Card {
    fn new(node: &Node, metrics: &Metrics, measure: &impl Fn(&str, TextStyle) -> f32) -> Self {
        // Words fit a diamond's middle only, so its lines are shorter.
        let width = match node.shape {
            NodeShape::Diamond => metrics.label_width * 0.6,
            _ => metrics.label_width,
        };
        let wrapped = |text: &str, width: f32, style| -> Vec<Line> {
            wrap(text, width, &|line| measure(line, style))
                .into_iter()
                .map(|line| {
                    let width = measure(&line, style);
                    (line, width)
                })
                .collect()
        };
        let title = wrapped(&node.title, width, TextStyle::Title);
        let bullet = measure(BULLET, TextStyle::Row);
        let rows: Vec<Vec<Line>> = node
            .rows
            .iter()
            .map(|row| wrapped(row, width - bullet, TextStyle::Row))
            .filter(|lines| !lines.is_empty())
            .collect();
        let widest =
            |lines: &[Line], indent: f32| lines.iter().map(|(_, w)| indent + w).fold(0., f32::max);
        let row_lines: usize = rows.iter().map(Vec::len).sum();
        let text_w = rows
            .iter()
            .map(|lines| widest(lines, bullet))
            .fold(widest(&title, 0.), f32::max);
        let mut text_h = title.len().max(1) as f32 * metrics.line_height;
        if row_lines > 0 {
            text_h += metrics.rule_gap * 2. + row_lines as f32 * metrics.row_line_height;
        }
        Self {
            title,
            rows,
            bullet,
            text: (text_w, text_h),
        }
    }

    /// The box's size: big enough that the text block fits inside the outline.
    fn size(&self, shape: NodeShape, metrics: &Metrics) -> (f32, f32) {
        let (w, h) = self.text;
        // The smallest ellipse around a rectangle is about √2 times its size; a diamond's is
        // twice.
        let (w, h) = match shape {
            NodeShape::Rectangle | NodeShape::Rounded => (w, h),
            NodeShape::Ellipse => (w * SQRT_2, h * SQRT_2),
            NodeShape::Diamond => (w * 2., h * 2.),
        };
        let (pad_x, pad_y) = metrics.padding;
        ((w + pad_x * 2.).max(metrics.min_width), h + pad_y * 2.)
    }

    /// Places the text in `rect`, drawing a rule under the title of a card with rows.
    fn place(self, shape: NodeShape, rect: Rect, metrics: &Metrics, out: &mut Output<'_>) {
        let (cx, cy) = rect.center();
        let boxed = matches!(shape, NodeShape::Rectangle | NodeShape::Rounded);
        let mut y = cy - self.text.1 / 2.;
        for (line, width) in self.title {
            out.texts.push(Text {
                text: line,
                style: TextStyle::Title,
                origin: (cx - width / 2., y),
                width,
            });
            y += metrics.line_height;
        }
        if self.rows.is_empty() {
            return;
        }
        y += metrics.rule_gap;
        if boxed {
            let inset = metrics.padding.0 / 2.;
            let (from, to) = ((rect.x + inset, y), (rect.x + rect.w - inset, y));
            out.pen.rule(from, to, out.seed, out.strokes);
        }
        y += metrics.rule_gap;
        // Rows start at the left of the text block in a card, and are centred otherwise.
        let left = cx - self.text.0 / 2.;
        for lines in self.rows {
            for (index, (line, width)) in lines.into_iter().enumerate() {
                let (text, x, width) = match (boxed, index) {
                    (true, 0) => (format!("{BULLET}{line}"), left, width + self.bullet),
                    (true, _) => (line, left + self.bullet, width),
                    (false, _) => (line, cx - width / 2., width),
                };
                out.texts.push(Text {
                    text,
                    style: TextStyle::Row,
                    origin: (x, y),
                    width,
                });
                y += metrics.row_line_height;
            }
        }
    }
}

/// Where a card's text and rule go.
struct Output<'a> {
    pen: &'a Pen,
    seed: u64,
    strokes: &'a mut Vec<Stroke>,
    texts: &'a mut Vec<Text>,
}

/// Lays out and sketches `diagram` at `metrics`, measuring text with `measure`, which
/// gives a line's width in pixels in a style.
pub fn scene(
    diagram: &Diagram,
    metrics: Metrics,
    measure: impl Fn(&str, TextStyle) -> f32,
) -> Scene {
    let cards: Vec<Card> = diagram
        .nodes()
        .iter()
        .map(|node| Card::new(node, &metrics, &measure))
        .collect();
    let boxes: Vec<((f32, f32), NodeShape)> = diagram
        .nodes()
        .iter()
        .zip(&cards)
        .map(|(node, card)| (card.size(node.shape, &metrics), node.shape))
        .collect();
    let links: Vec<(usize, usize)> = diagram.edges().iter().map(|e| (e.from, e.to)).collect();
    let placement = layout::place(&boxes, &links, diagram.direction, metrics.gap);

    // A margin all round, so strokes that wobble past a box stay inside the scene.
    let margin = metrics.gap / 2.;
    let shift = |(x, y): Point| (x + margin, y + margin);
    let pen = Pen::new(metrics.stroke_width);
    let mut strokes = Vec::new();
    let mut texts = Vec::new();
    for (index, (node, card)) in diagram.nodes().iter().zip(cards).enumerate() {
        let mut rect = placement.boxes[index];
        (rect.x, rect.y) = shift((rect.x, rect.y));
        let seed = index as u64 * SEEDS_PER_BOX + 1;
        pen.node(node.shape, rect, placement.ranks[index], seed, &mut strokes);
        let mut out = Output {
            pen: &pen,
            seed: seed + 1,
            strokes: &mut strokes,
            texts: &mut texts,
        };
        card.place(node.shape, rect, &metrics, &mut out);
    }
    for (index, (edge, path)) in diagram.edges().iter().zip(&placement.arrows).enumerate() {
        let path: Vec<Point> = path.iter().copied().map(shift).collect();
        if path.is_empty() {
            continue;
        }
        let label = edge_label(&edge.label, middle(&path), &metrics, &measure);
        let seed = FIRST_ARROW_SEED + index as u64 * SEEDS_PER_ARROW;
        match around(&path, &label, &metrics) {
            Some((before, after)) => {
                pen.arrow(&before, edge.style, false, seed + 3, &mut strokes);
                pen.arrow(&after, edge.style, edge.head, seed, &mut strokes);
            }
            None => pen.arrow(&path, edge.style, edge.head, seed, &mut strokes),
        }
        texts.extend(label);
    }

    Scene {
        width: placement.width + margin * 2.,
        height: placement.height + margin * 2.,
        strokes,
        texts,
        metrics,
    }
}

/// The lines of an arrow's `label`, centred on the point halfway along the arrow; none
/// for no label.
fn edge_label(
    label: &str,
    (x, y): Point,
    metrics: &Metrics,
    measure: &impl Fn(&str, TextStyle) -> f32,
) -> Vec<Text> {
    let lines: Vec<&str> = label.lines().collect();
    let top = y - lines.len() as f32 * metrics.line_height / 2.;
    lines
        .into_iter()
        .enumerate()
        .map(|(row, line)| {
            let width = measure(line, TextStyle::EdgeLabel);
            Text {
                text: line.to_owned(),
                style: TextStyle::EdgeLabel,
                origin: (x - width / 2., top + row as f32 * metrics.line_height),
                width,
            }
        })
        .collect()
}

/// `path` split where it runs under `label`, so the arrow breaks around the text: the
/// part before, empty when the label covers the start, and the part after. None when
/// there is no label, or it covers the tip.
fn around(path: &[Point], label: &[Text], metrics: &Metrics) -> Option<(Vec<Point>, Vec<Point>)> {
    let (first, last) = (label.first()?, label.last()?);
    let gap = metrics.label_gap;
    let left = label
        .iter()
        .map(|t| t.origin.0)
        .fold(f32::INFINITY, f32::min);
    let right = label
        .iter()
        .map(|t| t.origin.0 + t.width)
        .fold(f32::NEG_INFINITY, f32::max);
    let min = (left - gap, first.origin.1 - gap);
    let max = (right + gap, last.origin.1 + metrics.line_height + gap);

    // Where the path is inside the label's box, as distances along it.
    let mut inside = Vec::new();
    let mut walked = 0.;
    for pair in path.windows(2) {
        let part = distance(pair[0], pair[1]);
        if let Some((from, to)) = clip(pair[0], pair[1], min, max) {
            inside.push((walked + from * part, walked + to * part));
        }
        walked += part;
    }
    // The label sits halfway along; grow from there over the stretches that meet.
    const TOUCH: f32 = 1e-3;
    let (mut from, mut to) = (walked / 2., walked / 2.);
    let mut grew = true;
    while grew {
        grew = false;
        for &(start, end) in &inside {
            if start <= to + TOUCH && end >= from - TOUCH && (start < from || end > to) {
                (from, to) = (from.min(start), to.max(end));
                grew = true;
            }
        }
    }
    if from >= to || to >= walked - TOUCH {
        return None;
    }
    let before = if from > TOUCH {
        slice(path, 0., from)
    } else {
        Vec::new()
    };
    Some((before, slice(path, to, walked)))
}

/// The part of the segment from `a` to `b` inside the box from `min` to `max`, as how far
/// along the segment it starts and ends, from 0 to 1; none if it misses the box.
fn clip(a: Point, b: Point, min: Point, max: Point) -> Option<(f32, f32)> {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let (mut from, mut to) = (0f32, 1f32);
    // Liang–Barsky: each side of the box limits how far in or out the segment reaches.
    for (towards, room) in [
        (-dx, a.0 - min.0),
        (dx, max.0 - a.0),
        (-dy, a.1 - min.1),
        (dy, max.1 - a.1),
    ] {
        if towards.abs() < f32::EPSILON {
            if room < 0. {
                return None;
            }
        } else if towards < 0. {
            from = from.max(room / towards);
        } else {
            to = to.min(room / towards);
        }
    }
    (from <= to).then_some((from, to))
}

/// The stretch of `path` from `from` to `to` along it.
fn slice(path: &[Point], from: f32, to: f32) -> Vec<Point> {
    let mut points = vec![along(path, from)];
    let mut walked = 0.;
    for pair in path.windows(2) {
        walked += distance(pair[0], pair[1]);
        if walked > from && walked < to {
            points.push(pair[1]);
        }
    }
    points.push(along(path, to));
    points
}

fn distance(a: Point, b: Point) -> f32 {
    (b.0 - a.0).hypot(b.1 - a.1)
}

/// Halfway along a path, by length.
fn middle(path: &[Point]) -> Point {
    let total: f32 = path.windows(2).map(|pair| distance(pair[0], pair[1])).sum();
    along(path, total / 2.)
}

/// The point `left` along a non-empty path, by length; its end for a `left` past it.
fn along(path: &[Point], mut left: f32) -> Point {
    for pair in path.windows(2) {
        let part = distance(pair[0], pair[1]);
        if part >= left && part > 0. {
            let t = left / part;
            return (
                pair[0].0 + (pair[1].0 - pair[0].0) * t,
                pair[0].1 + (pair[1].1 - pair[0].1) * t,
            );
        }
        left -= part;
    }
    path[path.len() - 1]
}

/// Splits `text` into lines no wider than `max` where it can, breaking between words; a
/// newline always starts a new line, and a word wider than `max` gets a line of its own.
fn wrap(text: &str, max: f32, measure: &impl Fn(&str) -> f32) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in text.lines() {
        let mut current = String::new();
        for word in paragraph.split_whitespace() {
            if current.is_empty() {
                current = word.to_owned();
                continue;
            }
            let candidate = format!("{current} {word}");
            if measure(&candidate) > max {
                lines.push(std::mem::replace(&mut current, word.to_owned()));
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Edge;
    use crate::sketch::{Ink, Paint};

    /// Ten pixels a character for titles and edge labels, eight for rows.
    fn measure(text: &str, style: TextStyle) -> f32 {
        let per = match style {
            TextStyle::Row => 8.,
            TextStyle::Title | TextStyle::EdgeLabel => 10.,
        };
        text.chars().count() as f32 * per
    }

    fn by_characters(text: &str) -> f32 {
        measure(text, TextStyle::Title)
    }

    fn metrics() -> Metrics {
        Metrics::for_font_size(20.)
    }

    #[test]
    fn wrap_breaks_between_words_to_fit() {
        assert_eq!(
            wrap("the cell cycle has four phases", 120., &by_characters),
            ["the cell", "cycle has", "four phases"]
        );
    }

    #[test]
    fn wrap_keeps_newlines_and_gives_a_long_word_its_own_line() {
        assert_eq!(
            wrap("a photosynthesis b\nc", 50., &by_characters),
            ["a", "photosynthesis", "b", "c"]
        );
        assert!(wrap("  ", 50., &by_characters).is_empty());
    }

    #[test]
    fn middle_is_halfway_along_the_whole_path() {
        assert_eq!(middle(&[(0., 0.), (10., 0.), (10., 30.)]), (10., 10.));
    }

    #[test]
    fn an_arrow_breaks_around_its_label() {
        let path = [(0., 0.), (0., 100.), (0., 200.)];
        let label = edge_label("yes", middle(&path), &metrics(), &measure);
        let (before, after) = around(&path, &label, &metrics()).expect("a break");
        let gap = metrics().label_gap;
        let top = label[0].origin.1 - gap;
        let bottom = label[0].origin.1 + metrics().line_height + gap;
        assert_eq!(before.first(), Some(&(0., 0.)));
        assert!((before.last().unwrap().1 - top).abs() < 1e-3, "{before:?}");
        assert!((after[0].1 - bottom).abs() < 1e-3, "{after:?}");
        assert_eq!(after.last(), Some(&(0., 200.)));

        let strokes = |edge: Edge| {
            let mut diagram = Diagram::default();
            diagram.add_node(Node::new("a", "Cell"));
            diagram.add_node(Node::new("b", "Divide"));
            diagram.add_edge(edge);
            scene(&diagram, metrics(), measure).strokes.len()
        };
        assert!(
            strokes(Edge::new(0, 1).label("then")) > strokes(Edge::new(0, 1)),
            "the shaft is drawn in two parts"
        );
    }

    #[test]
    fn an_arrow_without_room_past_its_label_stays_whole() {
        let path = [(0., 0.), (0., 10.)];
        let label = edge_label("a long label", middle(&path), &metrics(), &measure);
        assert_eq!(around(&path, &label, &metrics()), None);
        assert_eq!(around(&path, &[], &metrics()), None);
    }

    #[test]
    fn an_edge_label_is_centred_line_by_line_on_its_point() {
        let lines = edge_label("so\nthen", (100., 50.), &metrics(), &measure);
        let line_height = metrics().line_height;
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].origin, (90., 50. - line_height));
        assert_eq!(lines[1].origin, (80., 50.));
        assert!(lines.iter().all(|line| line.style == TextStyle::EdgeLabel));
        assert!(edge_label("", (0., 0.), &metrics(), &measure).is_empty());
    }

    fn sample() -> Diagram {
        let mut diagram = Diagram::default();
        diagram.add_node(
            Node::new("a", "Cell cycle")
                .row("Growth, then division")
                .row("About a day in human cells"),
        );
        diagram.add_node(Node::new("b", "Is it big enough?").shape(NodeShape::Diamond));
        diagram.add_node(Node::new("c", "Divide").shape(NodeShape::Ellipse));
        diagram.add_edge(Edge::new(0, 1));
        diagram.add_edge(Edge::new(1, 2).label("yes"));
        diagram
    }

    fn texts(scene: &Scene, style: TextStyle) -> Vec<&Text> {
        scene.texts.iter().filter(|t| t.style == style).collect()
    }

    #[test]
    fn every_text_sits_inside_the_scene() {
        let scene = scene(&sample(), metrics(), measure);
        let titles: Vec<_> = texts(&scene, TextStyle::Title)
            .iter()
            .map(|t| t.text.as_str())
            .collect();
        assert_eq!(titles, ["Cell cycle", "Is it big", "enough?", "Divide"]);
        assert_eq!(texts(&scene, TextStyle::EdgeLabel)[0].text, "yes");
        for text in &scene.texts {
            let (x, y) = text.origin;
            let height = scene.metrics.line_height(text.style);
            assert!(x >= 0. && x + text.width <= scene.width, "{text:?}");
            assert!(y >= 0. && y + height <= scene.height, "{text:?}");
        }
    }

    #[test]
    fn a_card_lists_its_rows_left_aligned_under_a_rule() {
        let scene = scene(&sample(), metrics(), measure);
        let rows: Vec<_> = texts(&scene, TextStyle::Row)
            .into_iter()
            .filter(|row| row.text.starts_with(BULLET))
            .collect();
        assert_eq!(rows.len(), 2, "one bullet a row");
        assert_eq!(rows[0].origin.0, rows[1].origin.0, "left aligned");
        let title = texts(&scene, TextStyle::Title)[0];
        assert!(rows[0].origin.1 > title.origin.1 + scene.metrics.line_height);
        // One thin rule: a single stroke narrower than the outlines.
        let thin = |stroke: &&Stroke| matches!(stroke.paint, Paint::Stroke { width, .. } if width < scene.metrics.stroke_width);
        assert_eq!(scene.strokes.iter().filter(thin).count(), 1);
    }

    #[test]
    fn rows_make_a_box_taller_and_long_rows_wrap_under_their_bullet() {
        let plain = Node::new("a", "Cell");
        let long = "a row long enough that it cannot fit on one line of a card at all";
        let card = Node::new("a", "Cell").row(long);
        let plain_card = Card::new(&plain, &metrics(), &measure);
        let full_card = Card::new(&card, &metrics(), &measure);
        let (_, plain_h) = plain_card.size(NodeShape::Rounded, &metrics());
        let (_, card_h) = full_card.size(NodeShape::Rounded, &metrics());
        assert!(card_h > plain_h);
        assert!(full_card.rows[0].len() > 1, "the row wraps");

        let mut diagram = Diagram::default();
        diagram.add_node(card);
        let scene = scene(&diagram, metrics(), measure);
        let rows = texts(&scene, TextStyle::Row);
        assert!(rows[0].text.starts_with(BULLET));
        assert!(!rows[1].text.starts_with(BULLET));
        assert!(
            rows[1].origin.0 > rows[0].origin.0,
            "indented past the bullet"
        );
    }

    #[test]
    fn each_rank_gets_its_own_tone() {
        let scene = scene(&sample(), metrics(), measure);
        let tones: Vec<usize> = scene
            .strokes
            .iter()
            .filter_map(|s| match s.ink {
                Ink::Tone(tone) => Some(tone),
                Ink::Line => None,
            })
            .collect();
        for rank in 0..3 {
            assert!(tones.contains(&rank), "{tones:?}");
        }
    }

    #[test]
    fn an_empty_diagram_is_an_empty_scene() {
        let scene = scene(&Diagram::default(), metrics(), measure);
        assert!(scene.strokes.is_empty() && scene.texts.is_empty());
    }
}
