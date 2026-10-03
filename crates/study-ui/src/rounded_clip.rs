//! A rounded visual clip for content that may paint square backgrounds.
//!
//! GPUI's overflow content mask is rectangular in the pinned GPUI version, so
//! `overflow_hidden` does not clip descendants to a parent's corner radii. This
//! component paints the four outside-of-the-arc corner crescents over its child.

use gpui_kit::{
    AnyElement, App, Bounds, Hsla, IntoElement, ParentElement as _, PathBuilder, Pixels,
    RenderOnce, Styled as _, Window, canvas, div, point, px,
};

/// How far along each edge a cubic Bézier's control points sit, as a share of the radius,
/// for the curve to trace a quarter circle: 4/3 × (√2 − 1).
const CUBIC_QUARTER_CIRCLE: f32 = 0.552_284_8;

/// Paints a child inside a rounded visual boundary.
///
/// The child remains a normal GPUI subtree, including resizable panels and
/// their hitboxes. The overlay only paints pixels and does not intercept input.
#[derive(IntoElement)]
pub struct RoundedClip {
    radius: Pixels,
    surround: Hsla,
    content: AnyElement,
}

impl RoundedClip {
    /// Creates a rounded clip whose corner crescents use `surround`.
    pub fn new(radius: Pixels, surround: Hsla, content: impl IntoElement) -> Self {
        Self {
            radius,
            surround,
            content: content.into_any_element(),
        }
    }
}

impl RenderOnce for RoundedClip {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let radius = self.radius;
        let surround = self.surround;

        div()
            .relative()
            .size_full()
            .overflow_hidden()
            .child(self.content)
            .child(
                canvas(
                    |_bounds, _window, _cx| (),
                    move |bounds, (), window, _cx| {
                        if radius <= px(0.)
                            || bounds.size.width <= px(0.)
                            || bounds.size.height <= px(0.)
                        {
                            return;
                        }
                        for corner in Corner::ALL {
                            let path = corner_crescent(bounds, radius, corner);
                            window.paint_path(path, surround);
                        }
                    },
                )
                .absolute()
                .inset_0(),
            )
    }
}

#[derive(Clone, Copy)]
enum Corner {
    TopLeft,
    TopRight,
    BottomRight,
    BottomLeft,
}

impl Corner {
    const ALL: [Self; 4] = [
        Self::TopLeft,
        Self::TopRight,
        Self::BottomRight,
        Self::BottomLeft,
    ];
}

fn corner_crescent(
    bounds: Bounds<Pixels>,
    radius: Pixels,
    corner: Corner,
) -> gpui_kit::Path<Pixels> {
    let radius = radius
        .max(px(0.))
        .min(bounds.size.width / 2.)
        .min(bounds.size.height / 2.);
    let k = px(CUBIC_QUARTER_CIRCLE * f32::from(radius));
    let x0 = bounds.origin.x;
    let y0 = bounds.origin.y;
    let x1 = bounds.bottom_right().x;
    let y1 = bounds.bottom_right().y;

    let (outer, edge_a, edge_b, control_a, control_b) = match corner {
        Corner::TopLeft => (
            point(x0, y0),
            point(x0 + radius, y0),
            point(x0, y0 + radius),
            point(x0 + radius - k, y0),
            point(x0, y0 + radius - k),
        ),
        Corner::TopRight => (
            point(x1, y0),
            point(x1 - radius, y0),
            point(x1, y0 + radius),
            point(x1 - radius + k, y0),
            point(x1, y0 + radius - k),
        ),
        Corner::BottomRight => (
            point(x1, y1),
            point(x1, y1 - radius),
            point(x1 - radius, y1),
            point(x1, y1 - radius + k),
            point(x1 - radius + k, y1),
        ),
        Corner::BottomLeft => (
            point(x0, y1),
            point(x0 + radius, y1),
            point(x0, y1 - radius),
            point(x0 + radius - k, y1),
            point(x0, y1 - radius + k),
        ),
    };

    let mut builder = PathBuilder::fill();
    builder.move_to(outer);
    builder.line_to(edge_a);
    builder.cubic_bezier_to(edge_b, control_a, control_b);
    builder.close();
    builder
        .build()
        .expect("rounded clip corner path should tessellate")
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::size;

    fn bounds() -> Bounds<Pixels> {
        Bounds::new(point(px(10.), px(20.)), size(px(200.), px(100.)))
    }

    /// A corner crescent still tessellates at a radius of 0.01px.
    #[test]
    fn every_corner_builds_at_a_tiny_radius() {
        for corner in Corner::ALL {
            corner_crescent(bounds(), px(0.01), corner);
        }
    }

    /// A corner crescent still tessellates at a radius larger than half the bounds.
    #[test]
    fn every_corner_builds_at_a_radius_beyond_half_the_bounds() {
        for corner in Corner::ALL {
            corner_crescent(bounds(), px(500.), corner);
        }
    }
}
