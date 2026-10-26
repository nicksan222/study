import type { Citation } from "./generated/study_pb";
// Transform prose text nodes only: never code, existing links, or image labels.
interface Node {
  type: string;
  value?: string;
  children?: Node[];
  url?: string;
  title?: string;
}
export function inlineCitations(citations: Citation[]) {
  const known = new Map(
    citations.filter((c) => c.sourceId).map((c) => [c.marker, c]),
  );
  return () => (tree: unknown) => {
    const visit = (parent: Node) => {
      if (
        ["code", "inlineCode", "link", "image"].includes(parent.type) ||
        !parent.children
      )
        return;
      parent.children = parent.children.flatMap((node) => {
        if (node.type !== "text" || !node.value) {
          visit(node);
          return [node];
        }
        const result: Node[] = [];
        let start = 0;
        for (const match of node.value.matchAll(/\[(\d+)\]/g)) {
          const citation = known.get(Number(match[1]));
          if (!citation) continue;
          if (match.index > start)
            result.push({
              type: "text",
              value: node.value.slice(start, match.index),
            });
          result.push({
            type: "link",
            url: `#study-citation-${citation.marker}`,
            title: citation.sourceName,
            children: [{ type: "text", value: match[0] }],
          });
          start = match.index + match[0].length;
        }
        if (!result.length) return [node];
        if (start < node.value.length)
          result.push({ type: "text", value: node.value.slice(start) });
        return result;
      });
    };
    visit(tree as Node);
  };
}
