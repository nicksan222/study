//! [`Diagram`]: the one shape of a diagram. Boxes (nodes) are small cards: a title, a few
//! rows of detail, the passages they rest on and an outline. Arrows (edges) join them,
//! flowing in one direction. Every edge joins two nodes that exist; [`Diagram::add_edge`]
//! refuses any other.

/// Which way the diagram flows, from the first boxes to the ones they lead to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Direction {
    /// Top to bottom.
    #[default]
    Down,
    /// Left to right.
    Right,
    /// Bottom to top.
    Up,
    /// Right to left.
    Left,
}

/// A box's outline.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NodeShape {
    Rectangle,
    /// A rectangle with rounded corners, the usual box.
    #[default]
    Rounded,
    /// A decision.
    Diamond,
    /// A circle or ellipse.
    Ellipse,
}

/// How an edge's line is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum LineStyle {
    #[default]
    Solid,
    /// A weak or optional link.
    Dotted,
    /// A strong link.
    Thick,
}

/// One box: a card with a title and rows of detail.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    /// The name its edges use in the text form; unique within a diagram.
    pub id: String,
    /// What the box is about, in a few words.
    pub title: String,
    /// Short facts under the title, one a row; none for a plain box.
    pub rows: Vec<String>,
    /// The numbers of the passages it rests on, as its label cites them with `[n]`.
    pub cites: Vec<u32>,
    pub shape: NodeShape,
}

impl Node {
    /// A plain rounded box.
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            rows: Vec::new(),
            cites: Vec::new(),
            shape: NodeShape::default(),
        }
    }

    /// Draws it as `shape`.
    pub fn shape(mut self, shape: NodeShape) -> Self {
        self.shape = shape;
        self
    }

    /// Adds a row of detail.
    pub fn row(mut self, row: impl Into<String>) -> Self {
        self.rows.push(row.into());
        self
    }

    /// The passages it rests on, by citation marker.
    pub fn cites(mut self, cites: impl IntoIterator<Item = u32>) -> Self {
        self.cites = cites.into_iter().collect();
        self
    }
}

/// A line from one box to another, by their index in [`Diagram::nodes`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Edge {
    pub from: usize,
    pub to: usize,
    /// Written on the line; empty for none.
    pub label: String,
    pub style: LineStyle,
    /// Whether it ends in an arrowhead.
    pub head: bool,
}

impl Edge {
    /// A solid, unlabelled arrow.
    pub fn new(from: usize, to: usize) -> Self {
        Self {
            from,
            to,
            label: String::new(),
            style: LineStyle::Solid,
            head: true,
        }
    }

    /// Writes `label` on the line.
    pub fn label(mut self, label: impl Into<String>) -> Self {
        self.label = label.into();
        self
    }

    /// Draws the line as `style`.
    pub fn style(mut self, style: LineStyle) -> Self {
        self.style = style;
        self
    }

    /// Makes it a plain line, without an arrowhead.
    pub fn without_head(mut self) -> Self {
        self.head = false;
        self
    }
}

/// Boxes joined by edges.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Diagram {
    pub direction: Direction,
    nodes: Vec<Node>,
    edges: Vec<Edge>,
}

impl Diagram {
    /// An empty diagram laid out in `direction`.
    pub fn new(direction: Direction) -> Self {
        Self {
            direction,
            ..Self::default()
        }
    }

    /// The boxes, in the order edges index them.
    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    /// The lines between boxes.
    pub fn edges(&self) -> &[Edge] {
        &self.edges
    }

    /// Whether it has no boxes to draw.
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// The index of the node called `id`.
    pub fn find(&self, id: &str) -> Option<usize> {
        self.nodes.iter().position(|node| node.id == id)
    }

    /// Adds a box, or replaces the one with the same id in place, and returns its index.
    pub fn add_node(&mut self, node: Node) -> usize {
        if let Some(index) = self.find(&node.id) {
            self.nodes[index] = node;
            return index;
        }
        self.nodes.push(node);
        self.nodes.len() - 1
    }

    /// Adds an edge, unless it names a node that doesn't exist; returns whether it did.
    pub fn add_edge(&mut self, edge: Edge) -> bool {
        let count = self.nodes.len();
        if edge.from >= count || edge.to >= count {
            return false;
        }
        self.edges.push(edge);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_a_node_again_replaces_it_in_place() {
        let mut diagram = Diagram::default();
        let first = diagram.add_node(Node::new("a", "A"));
        diagram.add_node(Node::new("b", "B"));
        let again = diagram.add_node(Node::new("a", "Apple").shape(NodeShape::Diamond).row("red"));
        assert_eq!(first, again);
        assert_eq!(diagram.nodes().len(), 2);
        assert_eq!(diagram.nodes()[0].title, "Apple");
        assert_eq!(diagram.nodes()[0].rows, ["red"]);
        assert_eq!(diagram.nodes()[0].shape, NodeShape::Diamond);
    }

    #[test]
    fn an_edge_to_a_missing_node_is_refused() {
        let mut diagram = Diagram::default();
        diagram.add_node(Node::new("a", "A"));
        assert!(!diagram.add_edge(Edge::new(0, 1)));
        assert!(diagram.add_edge(Edge::new(0, 0)));
        assert_eq!(diagram.edges().len(), 1);
    }
}
