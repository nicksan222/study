//! Mermaid flowcharts: the text form of a [`Diagram`], and what a model writes when asked
//! for one. [`GUIDE`] tells it what to write, [`parse`] reads the answer, and
//! [`Parsed::feedback`] says what went wrong, to send back for another try. [`write()`]
//! turns a diagram back into text.
//!
//! Only flowcharts, and only what a diagram shows: boxes with a shape, and links with a
//! label, a line style and an arrowhead or not. A box's label is a card: its first line
//! (up to the first `<br>`) is the title, and every further line a row of detail; `[n]`
//! anywhere in it cites passage `n`. Parsing never fails: a statement it can't
//! read, or something a diagram has no place for (subgraphs, styles, classes, clicks), is
//! left out and reported as a [`Problem`], so a nearly right answer still draws.
//!
//! What it reads:
//!
//! | Mermaid | Becomes |
//! |---|---|
//! | `flowchart TD` / `TB`, `LR`, `BT`, `RL` (or `graph`) | [`Direction`] |
//! | `a[Text]`, `a[[Text]]`, `a[(Text)]`, `a>Text]`, `a[/Text/]` | [`NodeShape::Rectangle`] |
//! | `a(Text)`, `a([Text])` | [`NodeShape::Rounded`] |
//! | `a{Text}`, `a{{Text}}` | [`NodeShape::Diamond`] |
//! | `a((Text))`, `a(((Text)))` | [`NodeShape::Ellipse`] |
//! | `a --> b`, `a --- b`, `a -.-> b`, `a ==> b` (any length, `x` or `o` heads) | [`Edge`] |
//! | `a -->\|Text\| b`, `a -- Text --> b` | a labelled edge |
//! | `a --> b --> c`, `a & b --> c` | chains and groups |
//! | `;` between statements, `%%` comments, a ```` ``` ```` fence, `---` front matter | skipped |
//!
//! Labels may be quoted (`a["Text (with brackets)"]`). In a card, `a["Title<br>- a fact
//! [2]<br>another"]`, a leading `-`, `*` or `•` on a row is dropped, as are the `[n]`
//! markers once read into [`Node::cites`](crate::Node::cites).

use std::collections::HashSet;
use std::fmt::Write as _;

use crate::model::{Diagram, Direction, Edge, LineStyle, Node, NodeShape};

/// The most boxes [`GUIDE`] asks for; a test keeps the two in step.
pub const MAX_NODES: usize = 25;

/// Instructions for a model writing a diagram, to go with what it should draw.
pub const GUIDE: &str = "Draw the diagram as a Mermaid flowchart, and reply with the \
flowchart only. Start with `flowchart TD` to go top to bottom, or `flowchart LR` to go left \
to right. Declare each box once, as a small card: a short id, then in quotes its title and \
up to four short rows of detail, separated by <br>. For example \
`mito[\"Mitochondria<br>Make ATP by respiration [2]<br>Have their own DNA [3]\"]`. Rows \
are key facts, definitions, numbers or examples, a few words each; cite the passage a row \
rests on as [n] at its end. Shapes: `id[\"...\"]` for a card, `id([\"...\"])` for a \
start or end, `id{\"...\"}` for a decision (title only), `id((\"...\"))` for a central \
idea. Then join boxes by id: `a --> b` for an arrow, `a -->|causes| b` for a labelled \
arrow (label every arrow whose meaning isn't obvious), `a --- b` for a plain line, \
`a -.-> b` for a weak or optional link and `a ==> b` for a strong one. Use 6 to 25 boxes. \
Don't use subgraphs, styles, classes or click handlers.";

/// What [`parse`] read, and what it had to leave out.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Parsed {
    pub diagram: Diagram,
    pub problems: Vec<Problem>,
    /// The ids of boxes only ever named in a link, never declared with a label, so they
    /// show nothing but their id: often a mistyped id, which draws as a stray box.
    pub undeclared: Vec<String>,
}

/// A statement [`parse`] left out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Problem {
    /// Counted from 1.
    pub line: usize,
    /// The statement, as written.
    pub text: String,
    pub kind: ProblemKind,
}

/// Why a statement was left out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProblemKind {
    /// The text is another kind of Mermaid diagram, such as a sequence diagram; nothing
    /// after it was read.
    NotAFlowchart,
    /// The flowchart's direction isn't one of `TD`, `TB`, `LR`, `BT` or `RL`; it goes
    /// down.
    UnknownDirection,
    /// Something a diagram has no place for, such as a subgraph or a style.
    Unsupported,
    /// Not a node or a link as far as the parser can tell.
    Unreadable,
}

impl ProblemKind {
    /// What went wrong, told to the model that wrote it.
    fn explain(self) -> &'static str {
        match self {
            Self::NotAFlowchart => "this is not a flowchart; start with `flowchart TD`",
            Self::UnknownDirection => "use TD, TB, LR, BT or RL as the direction",
            Self::Unsupported => "subgraphs, styles, classes and clicks aren't supported",
            Self::Unreadable => "not a box or a link",
        }
    }
}

impl Parsed {
    /// What to tell the model so it writes a better flowchart, or `None` when this one is
    /// fine.
    pub fn feedback(&self) -> Option<String> {
        let count = self.diagram.nodes().len();
        if self.flaws() == 0 && count > 0 && count <= MAX_NODES {
            return None;
        }
        let mut feedback = String::from("Your flowchart needs fixing:\n");
        if count == 0 {
            feedback.push_str("- It has no boxes.\n");
        }
        if count > MAX_NODES {
            let _ = writeln!(feedback, "- It has {count} boxes; use at most {MAX_NODES}.");
        }
        for problem in &self.problems {
            let _ = writeln!(
                feedback,
                "- Line {} `{}` was left out: {}.",
                problem.line,
                problem.text,
                problem.kind.explain()
            );
        }
        for id in &self.undeclared {
            let _ = writeln!(
                feedback,
                "- Box `{id}` is linked but never declared, so it shows only its id: declare \
                 it as a card, or link the box you meant."
            );
        }
        feedback.push_str("Reply with the whole flowchart again, fixed.");
        Some(feedback)
    }

    /// How many things [`Self::feedback`] asks to fix in what was read: the statements left
    /// out and the boxes never declared.
    pub fn flaws(&self) -> usize {
        self.problems.len() + self.undeclared.len()
    }
}

/// Reads a Mermaid flowchart, leaving out what it can't read.
pub fn parse(source: &str) -> Parsed {
    let mut parsed = Parsed::default();
    let mut declared = HashSet::new();
    let mut started = false;
    let mut front_matter = false;
    for (index, raw) in source.lines().enumerate() {
        let line = index + 1;
        let text = uncommented(raw).trim();
        // A `---` block before the header holds settings such as a title.
        if text == "---" && !started {
            front_matter = !front_matter;
            continue;
        }
        if front_matter || text.is_empty() || text.starts_with("```") {
            continue;
        }
        for statement in statements(text) {
            let problem = |kind| Problem {
                line,
                text: statement.to_owned(),
                kind,
            };
            if !started {
                started = true;
                match header(statement) {
                    Header::Flowchart(direction) => {
                        parsed.diagram.direction = direction.unwrap_or_default();
                        if direction.is_none() {
                            parsed.problems.push(problem(ProblemKind::UnknownDirection));
                        }
                        continue;
                    }
                    Header::Other => {
                        // Nothing was read before it, so no box is undeclared.
                        parsed.problems.push(problem(ProblemKind::NotAFlowchart));
                        return parsed;
                    }
                    // No header: read it as a statement.
                    Header::None => {}
                }
            }
            // A keyword starts an unsupported statement, unless it names a box that links on.
            let chain = chain(statement);
            let linked = chain.as_ref().is_some_and(|chain| !chain.rest.is_empty());
            let first_word = statement.split_whitespace().next().unwrap_or_default();
            if UNSUPPORTED.contains(&first_word) && !linked {
                parsed.problems.push(problem(ProblemKind::Unsupported));
                continue;
            }
            match chain {
                Some(chain) => apply(&mut parsed.diagram, &mut declared, chain),
                None => parsed.problems.push(problem(ProblemKind::Unreadable)),
            }
        }
    }
    parsed.undeclared = parsed
        .diagram
        .nodes()
        .iter()
        .filter(|node| !declared.contains(&node.id))
        .map(|node| node.id.clone())
        .collect();
    parsed
}

/// Writes a diagram as a Mermaid flowchart that [`parse`] reads back the same, except in a
/// title or row: a line break reads back as a new row, a leading `-`, `*` or `•` bullet is
/// dropped, and an `[n]` reads back as a citation.
pub fn write(diagram: &Diagram) -> String {
    let direction = match diagram.direction {
        Direction::Down => "TD",
        Direction::Right => "LR",
        Direction::Up => "BT",
        Direction::Left => "RL",
    };
    let mut text = format!("flowchart {direction}\n");
    let ids = unique_ids(diagram);
    for (node, id) in diagram.nodes().iter().zip(&ids) {
        let (open, close) = match node.shape {
            NodeShape::Rectangle => ("[", "]"),
            NodeShape::Rounded => ("(", ")"),
            NodeShape::Diamond => ("{", "}"),
            NodeShape::Ellipse => ("((", "))"),
        };
        let label = card_label(node).replace('"', "#quot;");
        let _ = writeln!(text, "    {id}{open}\"{label}\"{close}");
    }
    for edge in diagram.edges() {
        let arrow = match (edge.style, edge.head) {
            (LineStyle::Solid, true) => "-->",
            (LineStyle::Solid, false) => "---",
            (LineStyle::Dotted, true) => "-.->",
            (LineStyle::Dotted, false) => "-.-",
            (LineStyle::Thick, true) => "==>",
            (LineStyle::Thick, false) => "===",
        };
        let label = if edge.label.is_empty() {
            String::new()
        } else {
            // Encoded so the label stays on one line and its `|` can't end it early.
            let label = edge
                .label
                .replace('"', "#quot;")
                .replace('|', "#124;")
                .replace('\n', "<br>");
            format!("|\"{label}\"|")
        };
        let _ = writeln!(
            text,
            "    {} {arrow}{label} {}",
            ids[edge.from], ids[edge.to]
        );
    }
    text
}

/// Each node's id as [`write()`] writes it: its own when it reads back, since ids are
/// unique; otherwise the first `n{index}` that no node written before it took, and no later
/// node keeps.
fn unique_ids(diagram: &Diagram) -> Vec<String> {
    let nodes = diagram.nodes();
    let mut ids: Vec<String> = Vec::with_capacity(nodes.len());
    for (index, node) in nodes.iter().enumerate() {
        if is_id(&node.id) {
            ids.push(node.id.clone());
            continue;
        }
        let taken = |id: &str| {
            ids.iter().any(|written| written == id)
                || nodes[index + 1..]
                    .iter()
                    .any(|n| n.id == id && is_id(&n.id))
        };
        let mut n = index;
        let id = loop {
            let candidate = format!("n{n}");
            if !taken(&candidate) {
                break candidate;
            }
            n += 1;
        };
        ids.push(id);
    }
    ids
}

/// Statement keywords a diagram has no place for.
const UNSUPPORTED: [&str; 11] = [
    "subgraph",
    "end",
    "direction",
    "classDef",
    "class",
    "style",
    "linkStyle",
    "click",
    "accTitle",
    "accDescr",
    "title",
];

/// Mermaid diagram kinds other than flowcharts.
const OTHER_DIAGRAMS: [&str; 14] = [
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "stateDiagram-v2",
    "erDiagram",
    "gantt",
    "pie",
    "journey",
    "mindmap",
    "timeline",
    "gitGraph",
    "quadrantChart",
    "requirementDiagram",
    "C4Context",
];

/// Box outlines as `(open, close, shape)`, longest first so `((` wins over `(`.
const SHAPES: [(&str, &str, NodeShape); 14] = [
    ("(((", ")))", NodeShape::Ellipse),
    ("((", "))", NodeShape::Ellipse),
    ("([", "])", NodeShape::Rounded),
    ("[(", ")]", NodeShape::Rectangle),
    ("[[", "]]", NodeShape::Rectangle),
    ("{{", "}}", NodeShape::Diamond),
    ("[/", "/]", NodeShape::Rectangle),
    ("[/", "\\]", NodeShape::Rectangle),
    ("[\\", "\\]", NodeShape::Rectangle),
    ("[\\", "/]", NodeShape::Rectangle),
    ("(", ")", NodeShape::Rounded),
    ("[", "]", NodeShape::Rectangle),
    ("{", "}", NodeShape::Diamond),
    (">", "]", NodeShape::Rectangle),
];

/// What a diagram's first statement says it is.
enum Header {
    /// A flowchart, and its direction if it's one we know.
    Flowchart(Option<Direction>),
    /// Another kind of Mermaid diagram.
    Other,
    /// No header: the statement is part of the flowchart.
    None,
}

fn header(statement: &str) -> Header {
    let mut words = statement.split_whitespace();
    let first = words.next().unwrap_or_default();
    if first == "flowchart" || first == "graph" {
        let direction = match words.next() {
            None | Some("TD" | "TB") => Some(Direction::Down),
            Some("LR") => Some(Direction::Right),
            Some("BT") => Some(Direction::Up),
            Some("RL") => Some(Direction::Left),
            Some(_) => None,
        };
        Header::Flowchart(direction)
    } else if OTHER_DIAGRAMS.contains(&first) {
        Header::Other
    } else {
        Header::None
    }
}

/// `line` without its `%%` comment, which starts outside quotes.
fn uncommented(line: &str) -> &str {
    let mut quoted = false;
    for (index, c) in line.char_indices() {
        match c {
            '"' => quoted = !quoted,
            '%' if !quoted && line[index..].starts_with("%%") => return &line[..index],
            _ => {}
        }
    }
    line
}

/// Splits a line at the `;`s outside quotes and brackets.
fn statements(line: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut depth, mut quoted, mut start) = (0i32, false, 0);
    for (index, c) in line.char_indices() {
        match c {
            '"' => quoted = !quoted,
            '[' | '(' | '{' if !quoted => depth += 1,
            ']' | ')' | '}' if !quoted => depth -= 1,
            ';' if !quoted && depth <= 0 => {
                parts.push(line[start..index].trim());
                start = index + 1;
            }
            _ => {}
        }
    }
    parts.push(line[start..].trim());
    parts.retain(|part| !part.is_empty());
    parts
}

/// A node as a statement mentions it, with its outline and label if it declares them.
struct Mention {
    id: String,
    declared: Option<(NodeShape, String)>,
}

/// How a link is drawn.
struct Link {
    label: String,
    style: LineStyle,
    head: bool,
}

/// A statement: groups of nodes, each joined to the next by a link.
struct Chain {
    first: Vec<Mention>,
    rest: Vec<(Link, Vec<Mention>)>,
}

/// Reads a statement as a chain, or `None` when some part of it isn't a node or a link.
fn chain(statement: &str) -> Option<Chain> {
    let (first, mut rest) = group(statement)?;
    let mut links = Vec::new();
    loop {
        rest = rest.trim_start();
        if rest.is_empty() {
            return Some(Chain { first, rest: links });
        }
        let (link, after) = link(rest)?;
        let (mentions, after) = group(after)?;
        links.push((link, mentions));
        rest = after;
    }
}

/// Nodes joined by `&`.
fn group(text: &str) -> Option<(Vec<Mention>, &str)> {
    let (first, mut rest) = mention(text)?;
    let mut mentions = vec![first];
    while let Some(after) = rest.trim_start().strip_prefix('&') {
        let (next, after) = mention(after)?;
        mentions.push(next);
        rest = after;
    }
    Some((mentions, rest))
}

fn is_id_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn is_id(text: &str) -> bool {
    !text.is_empty() && text.chars().all(is_id_char)
}

/// A node's id at the start of `text`, with its outline and label if it declares them, and
/// the text after it. A declared label left empty is the id.
fn mention(text: &str) -> Option<(Mention, &str)> {
    let text = text.trim_start();
    let end = text.find(|c| !is_id_char(c)).unwrap_or(text.len());
    if end == 0 {
        return None;
    }
    let (id, rest) = text.split_at(end);
    let id = id.to_owned();
    let declared = SHAPES.iter().find_map(|&(open, close, shape)| {
        let (label, after) = enclosed(rest.strip_prefix(open)?, close)?;
        Some((shape, clean(label), after))
    });
    let Some((shape, label, after)) = declared else {
        return Some((Mention { id, declared: None }, rest));
    };
    let label = if label.is_empty() { id.clone() } else { label };
    let declared = Some((shape, label));
    Some((Mention { id, declared }, after))
}

/// The text up to `close`, skipping over a quoted label, and what follows `close`.
fn enclosed<'a>(text: &'a str, close: &str) -> Option<(&'a str, &'a str)> {
    if let Some(quoted) = text.strip_prefix('"') {
        let end = quoted.find('"')?;
        let after = quoted[end + 1..].trim_start().strip_prefix(close)?;
        return Some((&quoted[..end], after));
    }
    let end = text.find(close)?;
    Some((&text[..end], &text[end + close.len()..]))
}

/// A label as it should read: unquoted, with `<br>` as a newline and Mermaid's entities
/// and Markdown backticks undone.
fn clean(label: &str) -> String {
    let label = label.trim();
    let label = label
        .strip_prefix('"')
        .and_then(|l| l.strip_suffix('"'))
        .unwrap_or(label);
    let label = label
        .strip_prefix('`')
        .and_then(|l| l.strip_suffix('`'))
        .unwrap_or(label);
    let mut label = label.replace("#quot;", "\"").replace("#124;", "|");
    for br in ["<br/>", "<br />", "<br>"] {
        label = label.replace(br, "\n");
    }
    label.lines().map(str::trim).collect::<Vec<_>>().join("\n")
}

/// A complete arrow at the start of `text` (`-->`, `---`, `-.->`, `==>`, …), and how many
/// bytes it takes; `None` for text that isn't one, such as the opening `--` of `-- label
/// -->`.
fn arrow(text: &str) -> Option<(LineStyle, bool, usize)> {
    let start = usize::from(text.starts_with('<'));
    let run = text[start..]
        .find(|c| !matches!(c, '-' | '=' | '.'))
        .unwrap_or(text.len() - start);
    let body = &text[start..start + run];
    if body.len() < 2 {
        return None;
    }
    let after = &text[start + run..];
    let head = match after.chars().next() {
        Some('>') => Some(1),
        Some('x' | 'o') if after[1..].starts_with(char::is_whitespace) => Some(1),
        _ => None,
    };
    if head.is_none() && body.len() < 3 {
        return None;
    }
    let style = if body.contains('=') {
        LineStyle::Thick
    } else if body.contains('.') {
        LineStyle::Dotted
    } else {
        LineStyle::Solid
    };
    Some((style, head.is_some(), start + run + head.unwrap_or(0)))
}

/// A link at the start of `text`, with its label, and the text after it.
fn link(text: &str) -> Option<(Link, &str)> {
    let text = text.trim_start();
    let (style, head, rest, mut label) = match arrow(text) {
        Some((style, head, length)) => (style, head, &text[length..], String::new()),
        None => {
            // `-- label -->`: an opening pair, the label, then an arrow.
            let opening = ["--", "-.", "=="].iter().find(|o| text.starts_with(**o))?;
            let inside = &text[opening.len()..];
            let (at, (style, head, length)) = inside
                .char_indices()
                .filter(|&(_, c)| matches!(c, '-' | '=' | '.' | '<'))
                .find_map(|(index, _)| Some((index, arrow(&inside[index..])?)))?;
            (style, head, &inside[at + length..], clean(&inside[..at]))
        }
    };
    let mut rest = rest;
    if let Some(inside) = rest.trim_start().strip_prefix('|') {
        let end = inside.find('|')?;
        label = clean(&inside[..end]);
        rest = &inside[end + 1..];
    }
    Some((Link { label, style, head }, rest))
}

/// Adds a chain's nodes to `diagram`, declaring or relabelling those it declares (and
/// adding their ids to `declared`), and an edge from every node of each group to every
/// node of the next.
fn apply(diagram: &mut Diagram, declared: &mut HashSet<String>, chain: Chain) {
    let mut add = |diagram: &mut Diagram, mentions: Vec<Mention>| -> Vec<usize> {
        mentions
            .into_iter()
            .map(|mention| match mention.declared {
                Some((shape, label)) => {
                    declared.insert(mention.id.clone());
                    diagram.add_node(card(mention.id, &label, shape))
                }
                None => diagram.find(&mention.id).unwrap_or_else(|| {
                    let title = mention.id.clone();
                    diagram.add_node(Node::new(mention.id, title))
                }),
            })
            .collect()
    };
    let mut previous = add(diagram, chain.first);
    for (link, mentions) in chain.rest {
        let next = add(diagram, mentions);
        for &from in &previous {
            for &to in &next {
                diagram.add_edge(Edge {
                    from,
                    to,
                    label: link.label.clone(),
                    style: link.style,
                    head: link.head,
                });
            }
        }
        previous = next;
    }
}

/// The card a cleaned label describes: its first line the title, the rest rows, and every
/// `[n]` a citation.
fn card(id: String, label: &str, shape: NodeShape) -> Node {
    let mut cites = Vec::new();
    let mut lines = label.lines().filter_map(|line| {
        let (line, found) = take_cites(line);
        cites.extend(found);
        let line = strip_bullet(&line).to_owned();
        (!line.is_empty()).then_some(line)
    });
    let title = lines.next().unwrap_or_else(|| id.clone());
    let rows = lines.collect();
    cites.sort_unstable();
    cites.dedup();
    Node {
        id,
        title,
        rows,
        cites,
        shape,
    }
}

/// `line` without one leading list bullet. Only a bullet followed by a space counts, so a
/// minus sign (`-273.15`) or bold (`**ATP**`) is kept whole.
fn strip_bullet(line: &str) -> &str {
    let line = line.trim();
    for bullet in ['-', '*', '•'] {
        if let Some(rest) = line.strip_prefix(bullet)
            && (rest.is_empty() || rest.starts_with(char::is_whitespace))
        {
            return rest.trim_start();
        }
    }
    line
}

/// `line` without its `[n]` and `[n, m]` markers, and the numbers they held.
fn take_cites(line: &str) -> (String, Vec<u32>) {
    let mut kept = String::new();
    let mut cites = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find('[') {
        let inside = &rest[start + 1..];
        let numbers = inside.find(']').and_then(|end| {
            let found: Option<Vec<u32>> = inside[..end]
                .split(',')
                .map(|number| number.trim().parse().ok())
                .collect();
            found.map(|found| (found, end))
        });
        match numbers {
            Some((found, end)) => {
                kept.push_str(&rest[..start]);
                cites.extend(found);
                rest = &inside[end + 1..];
            }
            None => {
                kept.push_str(&rest[..=start]);
                rest = inside;
            }
        }
    }
    kept.push_str(rest);
    let kept = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    (kept, cites)
}

/// A card as a label that [`card`] reads back: the title with its citations, then the
/// rows.
fn card_label(node: &Node) -> String {
    let mut label = node.title.replace('\n', "<br>");
    for cite in &node.cites {
        let _ = write!(label, " [{cite}]");
    }
    for row in &node.rows {
        label.push_str("<br>");
        label.push_str(&row.replace('\n', "<br>"));
    }
    label
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(parsed: &Parsed) -> Vec<&str> {
        parsed
            .diagram
            .nodes()
            .iter()
            .map(|node| node.title.as_str())
            .collect()
    }

    fn edges(parsed: &Parsed) -> Vec<(usize, usize, &str, LineStyle, bool)> {
        parsed
            .diagram
            .edges()
            .iter()
            .map(|e| (e.from, e.to, e.label.as_str(), e.style, e.head))
            .collect()
    }

    #[test]
    fn reads_a_typical_answer() {
        let parsed = parse(
            "```mermaid\n\
             flowchart LR\n\
             %% the cycle\n\
             cycle[\"Cell cycle\"] --> inter([\"Interphase\"])\n\
             cycle --> mitosis((Mitosis))\n\
             inter -->|then| mitosis\n\
             mitosis --> ok{Two cells?}\n\
             ```",
        );
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.diagram.direction, Direction::Right);
        assert_eq!(
            labels(&parsed),
            ["Cell cycle", "Interphase", "Mitosis", "Two cells?"]
        );
        let shapes: Vec<_> = parsed.diagram.nodes().iter().map(|n| n.shape).collect();
        assert_eq!(
            shapes,
            [
                NodeShape::Rectangle,
                NodeShape::Rounded,
                NodeShape::Ellipse,
                NodeShape::Diamond
            ]
        );
        assert_eq!(edges(&parsed)[2], (1, 2, "then", LineStyle::Solid, true));
        assert_eq!(parsed.feedback(), None);
    }

    #[test]
    fn reads_every_kind_of_link() {
        let parsed = parse(
            "graph TD\n\
             a --- b\n\
             a -.-> c\n\
             a ==> d\n\
             a -- because --> e\n\
             a -. maybe .-> f\n\
             a ---->|long| g\n\
             a --x h",
        );
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        let got: Vec<_> = edges(&parsed)
            .into_iter()
            .map(|(_, _, label, style, head)| (label, style, head))
            .collect();
        assert_eq!(
            got,
            [
                ("", LineStyle::Solid, false),
                ("", LineStyle::Dotted, true),
                ("", LineStyle::Thick, true),
                ("because", LineStyle::Solid, true),
                ("maybe", LineStyle::Dotted, true),
                ("long", LineStyle::Solid, true),
                ("", LineStyle::Solid, true),
            ]
        );
    }

    #[test]
    fn reads_chains_groups_and_semicolons() {
        let parsed = parse("flowchart TD; a --> b --> c; a & b --> d");
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        let pairs: Vec<_> = edges(&parsed).iter().map(|e| (e.0, e.1)).collect();
        assert_eq!(pairs, [(0, 1), (1, 2), (0, 3), (1, 3)]);
    }

    #[test]
    fn links_without_spaces_and_labels_with_brackets() {
        let parsed = parse("flowchart TD\nA[\"Mitosis (M)\"]-->B[Next step]");
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(labels(&parsed), ["Mitosis (M)", "Next step"]);
    }

    #[test]
    fn a_later_declaration_relabels_a_node() {
        let parsed = parse("flowchart TD\na --> b\nb[Bee]");
        assert_eq!(labels(&parsed), ["a", "Bee"]);
        assert_eq!(parsed.diagram.edges().len(), 1);
    }

    #[test]
    fn a_label_with_line_breaks_is_a_card() {
        let parsed = parse(
            "flowchart TD\n\
             mito[\"Mitochondria [1]<br>- Make ATP [2]<br>• Own #quot;DNA#quot; [2, 3]<br> \"]",
        );
        let node = &parsed.diagram.nodes()[0];
        assert_eq!(node.title, "Mitochondria");
        assert_eq!(node.rows, ["Make ATP", "Own \"DNA\""]);
        assert_eq!(node.cites, [1, 2, 3]);
    }

    #[test]
    fn a_minus_sign_and_bold_are_not_bullets() {
        let parsed = parse(
            "flowchart TD\n\
             zero[\"-273.15 °C is absolute zero<br>**ATP** stores energy<br>* -5 is negative\"]",
        );
        let node = &parsed.diagram.nodes()[0];
        assert_eq!(node.title, "-273.15 °C is absolute zero");
        assert_eq!(node.rows, ["**ATP** stores energy", "-5 is negative"]);
    }

    #[test]
    fn brackets_that_are_not_citations_stay() {
        assert_eq!(
            take_cites("x[i] in [0, n) [4]"),
            ("x[i] in [0, n)".to_owned(), vec![4])
        );
    }

    #[test]
    fn unsupported_statements_are_reported_and_the_rest_kept() {
        let parsed = parse(
            "flowchart TD\n\
             subgraph Cells\n\
             a --> b\n\
             end\n\
             style a fill:#f9f\n\
             a --> ???",
        );
        assert_eq!(labels(&parsed), ["a", "b"]);
        let kinds: Vec<_> = parsed.problems.iter().map(|p| (p.line, p.kind)).collect();
        assert_eq!(
            kinds,
            [
                (2, ProblemKind::Unsupported),
                (4, ProblemKind::Unsupported),
                (5, ProblemKind::Unsupported),
                (6, ProblemKind::Unreadable),
            ]
        );
        let feedback = parsed.feedback().unwrap();
        assert!(feedback.contains("Line 6 `a --> ???`"), "{feedback}");
    }

    #[test]
    fn a_chain_from_a_box_named_like_a_keyword_is_read() {
        let parsed = parse("flowchart TD\nclass --> b\nend --> x\ntitle --> y");
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(labels(&parsed), ["class", "b", "end", "x", "title", "y"]);
        assert_eq!(parsed.diagram.edges().len(), 3);
    }

    #[test]
    fn a_keyword_statement_without_a_link_is_unsupported() {
        let parsed = parse("flowchart TD\nend\nsubgraph X\nstyle a fill:#f9f\nclass a foo");
        assert!(parsed.diagram.is_empty());
        let kinds: Vec<_> = parsed.problems.iter().map(|p| p.kind).collect();
        assert_eq!(kinds, [ProblemKind::Unsupported; 4]);
    }

    #[test]
    fn percent_signs_in_quotes_are_not_a_comment() {
        let parsed = parse("flowchart TD\na[\"50%% off\"] --> b %% a sale");
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(labels(&parsed), ["50%% off", "b"]);
    }

    #[test]
    fn a_statement_it_cannot_read_adds_nothing() {
        let parsed = parse("flowchart TD\na --> b[unclosed");
        assert!(parsed.diagram.is_empty());
        assert_eq!(parsed.problems[0].kind, ProblemKind::Unreadable);
    }

    #[test]
    fn another_kind_of_diagram_is_not_read() {
        let parsed = parse("sequenceDiagram\nAlice->>Bob: Hi");
        assert!(parsed.diagram.is_empty());
        assert_eq!(parsed.problems.len(), 1);
        assert_eq!(parsed.problems[0].kind, ProblemKind::NotAFlowchart);
        assert!(parsed.feedback().unwrap().contains("no boxes"));
    }

    #[test]
    fn an_unknown_direction_goes_down() {
        let parsed = parse("flowchart XY\na --> b");
        assert_eq!(parsed.diagram.direction, Direction::Down);
        assert_eq!(parsed.problems[0].kind, ProblemKind::UnknownDirection);
    }

    #[test]
    fn front_matter_is_skipped() {
        let parsed = parse("---\ntitle: Cells\n---\nflowchart LR\na --> b");
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.diagram.direction, Direction::Right);
    }

    #[test]
    fn a_missing_header_is_fine() {
        let parsed = parse("a --> b");
        assert!(parsed.problems.is_empty());
        assert_eq!(parsed.diagram.edges().len(), 1);
    }

    #[test]
    fn a_box_only_ever_linked_is_asked_to_be_declared() {
        let parsed =
            parse("flowchart TD\nmito[\"Mitochondria\"] --> atp\nmitoo --> atp\natp[\"ATP\"]");
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.undeclared, ["mitoo"]);
        assert_eq!(parsed.flaws(), 1);
        let feedback = parsed.feedback().unwrap();
        assert!(
            feedback.contains("Box `mitoo` is linked but never declared"),
            "{feedback}"
        );
        // What `write` stores declares every box, so it reads back without flaws.
        assert_eq!(parse(&write(&parsed.diagram)).flaws(), 0);
    }

    #[test]
    fn too_many_boxes_asks_for_fewer() {
        let source: String = (0..=MAX_NODES).map(|i| format!("n{i}\n")).collect();
        let parsed = parse(&source);
        assert!(parsed.feedback().unwrap().contains("at most"));
    }

    #[test]
    fn the_guide_asks_for_no_more_boxes_than_feedback_allows() {
        assert!(GUIDE.contains(&format!(" to {MAX_NODES} boxes")));
    }

    #[test]
    fn what_it_writes_reads_back_the_same() {
        let mut diagram = Diagram::new(Direction::Left);
        let shapes = [
            NodeShape::Rectangle,
            NodeShape::Rounded,
            NodeShape::Diamond,
            NodeShape::Ellipse,
        ];
        for (index, shape) in shapes.into_iter().enumerate() {
            diagram.add_node(
                Node::new(format!("n{index}"), format!("Box \"{index}\" (x)")).shape(shape),
            );
        }
        diagram.add_node(
            Node::new("x", "Card")
                .row("first fact")
                .row("second, with (brackets)")
                .cites([2, 5]),
        );
        diagram.add_edge(Edge::new(0, 1).label("so"));
        diagram.add_edge(Edge::new(0, 2).label("makes\nATP"));
        diagram.add_edge(Edge::new(0, 3).label("either | or"));
        diagram.add_edge(Edge::new(1, 2).style(LineStyle::Dotted));
        diagram.add_edge(Edge::new(2, 3).style(LineStyle::Thick).without_head());
        diagram.add_edge(Edge::new(3, 4).without_head());
        let parsed = parse(&write(&diagram));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(parsed.diagram, diagram);
    }

    #[test]
    fn a_line_break_in_a_title_or_row_reads_back_as_a_new_row() {
        let mut diagram = Diagram::default();
        diagram.add_node(Node::new("a", "A\nB").row("c\nd"));
        diagram.add_node(Node::new("b", "Next"));
        diagram.add_edge(Edge::new(0, 1));
        let parsed = parse(&write(&diagram));
        assert!(parsed.problems.is_empty(), "{:?}", parsed.problems);
        assert_eq!(labels(&parsed), ["A", "Next"]);
        assert_eq!(parsed.diagram.nodes()[0].rows, ["B", "c", "d"]);
        assert_eq!(edges(&parsed), [(0, 1, "", LineStyle::Solid, true)]);
    }

    #[test]
    fn writing_replaces_ids_that_would_not_read_back() {
        let mut diagram = Diagram::default();
        diagram.add_node(Node::new("has space", "A"));
        diagram.add_node(Node::new("b", "B"));
        diagram.add_edge(Edge::new(0, 1));
        let text = write(&diagram);
        assert!(text.contains("n0(\"A\")"), "{text}");
        assert_eq!(parse(&text).diagram.edges().len(), 1);
    }

    #[test]
    fn a_replaced_id_never_takes_another_node_s() {
        let mut diagram = Diagram::default();
        diagram.add_node(Node::new("has space", "A"));
        diagram.add_node(Node::new("n0", "B"));
        diagram.add_edge(Edge::new(0, 1));
        let parsed = parse(&write(&diagram));
        assert_eq!(labels(&parsed), ["A", "B"]);
        assert_eq!(parsed.diagram.edges().len(), 1);
    }
}
