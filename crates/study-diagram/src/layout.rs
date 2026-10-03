//! Where a diagram's boxes go and how its arrows run between them, from measured box
//! sizes. Pure geometry: `rust-sugiyama` orders the boxes into rows with few crossings,
//! and this module turns its answer into rectangles and arrow paths.
//!
//! The layout is worked out flowing down, then turned for the diagram's [`Direction`].
//! Arrows are straight, as in Excalidraw, except one that skips rows: it bends around any
//! box in the rows it passes, so it never runs through one. Each arrow starts and ends just
//! outside the outline of its boxes, whatever their shape.

use rust_sugiyama::configure::Config;

use crate::model::{Direction, NodeShape};

/// A point in the diagram, in pixels from its top left corner.
pub type Point = (f32, f32);

/// A box's bounds, from its top left corner.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    /// The middle of the box.
    pub fn center(&self) -> Point {
        (self.x + self.w / 2., self.y + self.h / 2.)
    }

    /// Whether this rectangle, grown by `margin` on every side, holds the point.
    pub(crate) fn holds(&self, (x, y): Point, margin: f32) -> bool {
        x > self.x - margin
            && x < self.x + self.w + margin
            && y > self.y - margin
            && y < self.y + self.h + margin
    }

    /// Where the line from this box's center toward `toward` crosses its outline, grown
    /// by `margin`.
    fn exit(&self, shape: NodeShape, toward: Point, margin: f32) -> Point {
        let (cx, cy) = self.center();
        let (dx, dy) = (toward.0 - cx, toward.1 - cy);
        let (rx, ry) = (self.w / 2. + margin, self.h / 2. + margin);
        // How far along (dx, dy) the outline is: the rectangle's edge, the ellipse, or the
        // diamond |x|/rx + |y|/ry = 1.
        let t = match shape {
            NodeShape::Rectangle | NodeShape::Rounded => {
                let reach = |half: f32, delta: f32| {
                    if delta == 0. {
                        f32::INFINITY
                    } else {
                        half / delta.abs()
                    }
                };
                reach(rx, dx).min(reach(ry, dy))
            }
            NodeShape::Ellipse => 1. / ((dx / rx).powi(2) + (dy / ry).powi(2)).sqrt(),
            NodeShape::Diamond => 1. / (dx.abs() / rx + dy.abs() / ry),
        };
        if t.is_finite() {
            (cx + dx * t, cy + dy * t)
        } else {
            (cx, cy)
        }
    }

    /// Swaps x and y.
    fn transposed(self) -> Self {
        Self {
            x: self.y,
            y: self.x,
            w: self.h,
            h: self.w,
        }
    }
}

/// A laid out diagram.
#[derive(Debug)]
pub struct Placement {
    /// One rectangle per box, in the order the sizes were given.
    pub boxes: Vec<Rect>,
    /// Each box's rank: how far along the flow it is, from 0.
    pub ranks: Vec<usize>,
    /// One path per link, in the order given: its first point is on the source's outline,
    /// its last on the target's. Empty for a link that can't be drawn (to itself, or to a
    /// box that doesn't exist).
    pub arrows: Vec<Vec<Point>>,
    pub width: f32,
    pub height: f32,
}

/// Lays out boxes of the given `(width, height)` and outline, joined by `(from, to)`
/// links, flowing in `direction`, keeping `gap` between neighbouring boxes and twice that
/// between ranks.
pub fn place(
    boxes: &[((f32, f32), NodeShape)],
    links: &[(usize, usize)],
    direction: Direction,
    gap: f32,
) -> Placement {
    let across = matches!(direction, Direction::Right | Direction::Left);
    // Flowing sideways is flowing down with x and y swapped.
    let sizes: Vec<(f32, f32)> = boxes
        .iter()
        .map(|&((w, h), _)| if across { (h, w) } else { (w, h) })
        .collect();
    let mut placement = flow_down(&sizes, links, gap);

    if across {
        for rect in &mut placement.boxes {
            *rect = rect.transposed();
        }
        for path in &mut placement.arrows {
            for point in path {
                *point = (point.1, point.0);
            }
        }
        std::mem::swap(&mut placement.width, &mut placement.height);
    }
    match direction {
        Direction::Down | Direction::Right => {}
        Direction::Up => mirror(
            &mut placement,
            |rect, height, _| rect.y = height - rect.y - rect.h,
            |point, height, _| point.1 = height - point.1,
        ),
        Direction::Left => mirror(
            &mut placement,
            |rect, _, width| rect.x = width - rect.x - rect.w,
            |point, _, width| point.0 = width - point.0,
        ),
    }

    let margin = gap / 4.;
    for (path, &(from, to)) in placement.arrows.iter_mut().zip(links) {
        if path.len() < 2 {
            continue;
        }
        path[0] = placement.boxes[from].exit(boxes[from].1, path[1], margin);
        let last = path.len() - 1;
        path[last] = placement.boxes[to].exit(boxes[to].1, path[last - 1], margin);
    }
    placement
}

/// Flips a placement with the given changes to each box and arrow point.
fn mirror(
    placement: &mut Placement,
    flip_box: impl Fn(&mut Rect, f32, f32),
    flip_point: impl Fn(&mut Point, f32, f32),
) {
    let (height, width) = (placement.height, placement.width);
    for rect in &mut placement.boxes {
        flip_box(rect, height, width);
    }
    for path in &mut placement.arrows {
        for point in path {
            flip_point(point, height, width);
        }
    }
}

/// Lays boxes out flowing down; arrows run from center to center, bending around boxes
/// in the ranks they skip.
fn flow_down(sizes: &[(f32, f32)], links: &[(usize, usize)], gap: f32) -> Placement {
    let count = sizes.len();
    let drawable = |&(from, to): &(usize, usize)| from != to && from < count && to < count;
    let edges: Vec<(u32, u32)> = links
        .iter()
        .filter(|link| drawable(link))
        .map(|&(from, to)| (from as u32, to as u32))
        .collect();
    let (center_x, ranks, width) = arrange(sizes, &edges, gap);
    let rows = Rows::new(sizes, &ranks, gap);

    let boxes: Vec<Rect> = (0..count)
        .map(|index| {
            let (w, h) = sizes[index];
            let rank = ranks[index];
            Rect {
                x: center_x[index] - w / 2.,
                y: rows.top[rank] + (rows.height[rank] - h) / 2.,
                w,
                h,
            }
        })
        .collect();
    let arrows = links
        .iter()
        .map(|link| {
            if drawable(link) {
                arrow(link.0, link.1, &boxes, &ranks, &rows, gap)
            } else {
                Vec::new()
            }
        })
        .collect();

    Placement {
        boxes,
        ranks,
        arrows,
        width,
        height: rows.total,
    }
}

/// Each box's center across the diagram and its rank, as `rust-sugiyama` orders them,
/// and the diagram's width. Each connected group comes back on its own, centred on x and
/// with ranks as y values; the groups are set side by side, and each y value becomes a
/// rank number.
fn arrange(sizes: &[(f32, f32)], edges: &[(u32, u32)], gap: f32) -> (Vec<f32>, Vec<usize>, f32) {
    let count = sizes.len();
    let vertices: Vec<(u32, (f64, f64))> = sizes
        .iter()
        .enumerate()
        .map(|(index, &(w, h))| (index as u32, (f64::from(w), f64::from(h))))
        .collect();
    let config = Config {
        vertex_spacing: f64::from(gap),
        ..Config::default()
    };

    let mut center_x = vec![0f32; count];
    let mut ranks = vec![0usize; count];
    let mut cursor = 0f32;
    for (coordinates, _, _) in rust_sugiyama::from_vertices_and_edges(&vertices, edges, &config) {
        let coordinates: Vec<(usize, (f64, f64))> = coordinates
            .into_iter()
            .filter(|(index, _)| *index < count)
            .collect();
        if coordinates.is_empty() {
            continue;
        }
        let mut levels: Vec<f64> = coordinates.iter().map(|(_, (_, y))| *y).collect();
        levels.sort_by(f64::total_cmp);
        // Float y values within half a unit of each other are one rank.
        levels.dedup_by(|a, b| (*a - *b).abs() < 0.5);
        let half = |index: usize| sizes[index].0 / 2.;
        let left = coordinates
            .iter()
            .map(|&(index, (x, _))| x as f32 - half(index))
            .fold(f32::INFINITY, f32::min);
        let right = coordinates
            .iter()
            .map(|&(index, (x, _))| x as f32 + half(index))
            .fold(f32::NEG_INFINITY, f32::max);
        for (index, (x, y)) in coordinates {
            center_x[index] = cursor + x as f32 - left;
            ranks[index] = levels
                .iter()
                .position(|level| (level - y).abs() < 0.5)
                .unwrap_or(0);
        }
        cursor += right - left + gap * 2.;
    }
    (center_x, ranks, (cursor - gap * 2.).max(0.))
}

/// Where each rank runs down the diagram: as tall as its tallest box, with twice the gap
/// between ranks.
struct Rows {
    top: Vec<f32>,
    height: Vec<f32>,
    /// The height of every rank together.
    total: f32,
}

impl Rows {
    fn new(sizes: &[(f32, f32)], ranks: &[usize], gap: f32) -> Self {
        let rank_count = ranks.iter().max().map_or(0, |last| last + 1);
        let mut height = vec![0f32; rank_count];
        for (index, &rank) in ranks.iter().enumerate() {
            height[rank] = height[rank].max(sizes[index].1);
        }
        let mut top = Vec::with_capacity(rank_count);
        let mut total = 0f32;
        for (rank, h) in height.iter().enumerate() {
            if rank > 0 {
                total += gap * 2.;
            }
            top.push(total);
            total += h;
        }
        Self { top, height, total }
    }
}

/// The arrow from box `from` to box `to`, center to center, with a bend in every rank it
/// passes, clear of the boxes there.
fn arrow(
    from: usize,
    to: usize,
    boxes: &[Rect],
    ranks: &[usize],
    rows: &Rows,
    gap: f32,
) -> Vec<Point> {
    let start = boxes[from].center();
    let end = boxes[to].center();
    let mut path = vec![start];
    // Ranks strictly between the two, in the direction of travel.
    let passed: Vec<usize> = if ranks[from] < ranks[to] {
        (ranks[from] + 1..ranks[to]).collect()
    } else {
        (ranks[to] + 1..ranks[from]).rev().collect()
    };
    for rank in passed {
        let y = rows.top[rank] + rows.height[rank] / 2.;
        let t = (y - start.1) / (end.1 - start.1);
        let mut x = start.0 + t * (end.0 - start.0);
        // Step a full gap aside from each box in the way, as the curve through this point
        // cuts inside it; stepping may land in a neighbour, so look again.
        for _ in 0..3 {
            for (index, rect) in boxes.iter().enumerate() {
                if ranks[index] == rank && rect.holds((x, y), gap) {
                    x = if x < rect.center().0 {
                        rect.x - gap
                    } else {
                        rect.x + rect.w + gap
                    };
                }
            }
        }
        path.push((x, y));
    }
    path.push(end);
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAP: f32 = 40.;

    fn rounded(sizes: &[(f32, f32)]) -> Vec<((f32, f32), NodeShape)> {
        sizes
            .iter()
            .map(|&size| (size, NodeShape::Rounded))
            .collect()
    }

    fn down(sizes: &[(f32, f32)], links: &[(usize, usize)]) -> Placement {
        place(&rounded(sizes), links, Direction::Down, GAP)
    }

    fn overlap(a: &Rect, b: &Rect) -> bool {
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    }

    /// The branching graph the tests share: 0 → 3 skips the rank where 1 and 2 sit.
    const BRANCHES: [(usize, usize); 5] = [(0, 1), (0, 2), (1, 3), (2, 3), (0, 3)];

    #[test]
    fn a_chain_runs_down_one_rank_per_box() {
        let placement = down(&[(80., 40.); 3], &[(0, 1), (1, 2)]);
        assert_eq!(placement.ranks, [0, 1, 2]);
        assert!(placement.boxes[0].y < placement.boxes[1].y);
        assert!(placement.boxes[1].y < placement.boxes[2].y);
    }

    #[test]
    fn every_direction_flows_its_way() {
        let sizes = rounded(&[(120., 40.); 2]);
        let first_then_second = |direction| {
            let placement = place(&sizes, &[(0, 1)], direction, GAP);
            let (a, b) = (placement.boxes[0].center(), placement.boxes[1].center());
            (b.0 - a.0, b.1 - a.1)
        };
        let (dx, dy) = first_then_second(Direction::Down);
        assert!(dy > 0. && dx.abs() < 1.);
        let (dx, dy) = first_then_second(Direction::Up);
        assert!(dy < 0. && dx.abs() < 1.);
        let (dx, dy) = first_then_second(Direction::Right);
        assert!(dx > 0. && dy.abs() < 1.);
        let (dx, dy) = first_then_second(Direction::Left);
        assert!(dx < 0. && dy.abs() < 1.);
    }

    #[test]
    fn boxes_never_overlap_and_fit_the_diagram() {
        let sizes = [(100., 40.), (200., 40.), (60., 40.), (80., 60.)];
        for direction in [
            Direction::Down,
            Direction::Right,
            Direction::Up,
            Direction::Left,
        ] {
            let placement = place(&rounded(&sizes), &BRANCHES, direction, GAP);
            for (i, a) in placement.boxes.iter().enumerate() {
                assert!(a.x >= -0.5 && a.y >= -0.5, "{direction:?} {a:?}");
                assert!(a.x + a.w <= placement.width + 0.5, "{direction:?} {a:?}");
                assert!(a.y + a.h <= placement.height + 0.5, "{direction:?} {a:?}");
                for b in &placement.boxes[i + 1..] {
                    assert!(!overlap(a, b), "{direction:?}: {a:?} overlaps {b:?}");
                }
            }
        }
    }

    #[test]
    fn an_arrow_that_skips_a_rank_bends_around_the_boxes_in_it() {
        let placement = down(
            &[(100., 40.), (200., 40.), (60., 40.), (80., 40.)],
            &BRANCHES,
        );
        let long = &placement.arrows[4];
        assert_eq!(long.len(), 3, "one bend per skipped rank: {long:?}");
        for rect in &placement.boxes {
            assert!(
                !rect.holds(long[1], 0.),
                "{:?} runs through {rect:?}",
                long[1]
            );
        }
    }

    #[test]
    fn arrows_start_and_end_outside_their_boxes() {
        let placement = down(&[(80., 40.); 2], &[(0, 1)]);
        let arrow = &placement.arrows[0];
        assert!(!placement.boxes[0].holds(arrow[0], 0.));
        assert!(!placement.boxes[1].holds(arrow[1], 0.));
        assert!(arrow[0].1 < arrow[1].1, "points down: {arrow:?}");
    }

    #[test]
    fn arrows_meet_a_diamond_or_ellipse_at_its_outline() {
        let rect = Rect {
            x: 0.,
            y: 0.,
            w: 100.,
            h: 60.,
        };
        // Toward a corner: a rectangle's edge is at the corner, a diamond's much nearer.
        let corner = (200., 120.);
        let (x, y) = rect.exit(NodeShape::Diamond, corner, 0.);
        assert!(((x - 50.) / 50. + (y - 30.) / 30. - 1.).abs() < 1e-4);
        let (x, y) = rect.exit(NodeShape::Ellipse, corner, 0.);
        assert!((((x - 50.) / 50.).powi(2) + ((y - 30.) / 30.).powi(2) - 1.).abs() < 1e-4);
        assert_eq!(rect.exit(NodeShape::Rectangle, corner, 0.), (100., 60.));
    }

    #[test]
    fn links_that_cannot_be_drawn_get_no_arrow() {
        let placement = down(&[(80., 40.); 2], &[(0, 0), (0, 7), (0, 1)]);
        assert!(placement.arrows[0].is_empty());
        assert!(placement.arrows[1].is_empty());
        assert!(!placement.arrows[2].is_empty());
    }

    #[test]
    fn separate_groups_sit_side_by_side() {
        let placement = down(&[(80., 40.); 4], &[(0, 1), (2, 3)]);
        let [a, b, c, d] = placement.boxes[..] else {
            unreachable!()
        };
        for (x, y) in [(a, c), (a, d), (b, c), (b, d)] {
            assert!(!overlap(&x, &y), "{x:?} overlaps {y:?}");
        }
    }

    fn assert_apart(boxes: &[Rect]) {
        for (i, a) in boxes.iter().enumerate() {
            for b in &boxes[i + 1..] {
                assert!(!overlap(a, b), "{a:?} overlaps {b:?}");
            }
        }
    }

    #[test]
    fn a_cycle_is_drawn_without_overlaps() {
        let placement = down(&[(80., 40.); 3], &[(0, 1), (1, 2), (2, 0)]);
        for arrow in &placement.arrows {
            assert!(arrow.len() >= 2, "{arrow:?}");
        }
        assert_apart(&placement.boxes);
        // One link runs back up to break the cycle; which one is the layout's choice.
        let mut ranks = placement.ranks.clone();
        ranks.sort_unstable();
        assert_eq!(ranks, [0, 1, 2]);
    }

    #[test]
    fn the_same_link_twice_gets_two_arrows() {
        let placement = down(&[(80., 40.); 2], &[(0, 1), (0, 1)]);
        assert_eq!(placement.arrows.len(), 2);
        assert!(placement.arrows.iter().all(|arrow| arrow.len() >= 2));
    }

    #[test]
    fn a_tall_and_a_short_box_share_a_rank_and_fit_its_row() {
        let placement = down(&[(80., 40.), (80., 120.), (80., 30.)], &[(0, 1), (0, 2)]);
        assert_eq!(placement.ranks[1], placement.ranks[2]);
        assert_apart(&placement.boxes);
        let [_, tall, short] = placement.boxes[..] else {
            unreachable!()
        };
        // The row is as tall as its tallest box, and the short one sits inside it.
        assert!(short.y >= tall.y && short.y + short.h <= tall.y + tall.h);
        assert!(tall.y + tall.h <= placement.height + 0.5);
    }

    #[test]
    fn nothing_to_place_is_empty() {
        let placement = down(&[], &[]);
        assert!(placement.boxes.is_empty());
        assert_eq!((placement.width, placement.height), (0., 0.));
    }
}
