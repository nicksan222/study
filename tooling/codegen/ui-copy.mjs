import { parse } from "@babel/parser";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
export function visibleCopyErrors(source, filename = "component.tsx") {
  const syntax = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const errors = [];
  const report = (node, text) =>
    errors.push(
      `${filename}:${node.loc.start.line}: literal user-visible copy ${JSON.stringify(text)}`,
    );
  const visibleAttrs = [
    "placeholder",
    "aria-label",
    "title",
    "alt",
    "label",
    "description",
    "empty",
    "hint",
    "closeLabel",
  ];
  const copyExpression = (node, allowKeys = false) => {
    if (!node) return;
    if (
      node.type === "StringLiteral" &&
      /\p{L}/u.test(node.value) &&
      !(allowKeys && canonicalKeys.has(node.value))
    )
      report(node, node.value);
    if (node.type === "ConditionalExpression") {
      copyExpression(node.consequent, allowKeys);
      copyExpression(node.alternate, allowKeys);
    }
    if (node.type === "TemplateLiteral")
      for (const q of node.quasis)
        if (/\p{L}/u.test(q.value.raw)) report(q, q.value.raw);
  };
  const visit = (node, parent) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText" && /\p{L}/u.test(node.value))
      report(node, node.value.trim());
    if (node.type === "JSXAttribute" && visibleAttrs.includes(node.name.name)) {
      const value = node.value;
      if (value?.type === "StringLiteral" && /\p{L}/u.test(value.value)) {
        if (
          !["label", "description", "empty", "hint", "title"].includes(
            node.name.name,
          ) ||
          !canonicalKeys.has(value.value)
        )
          report(node, value.value);
      }
      if (value?.type === "JSXExpressionContainer")
        copyExpression(
          value.expression,
          ["label", "description", "empty", "hint", "title"].includes(
            node.name.name,
          ),
        );
    }
    if (
      node.type === "JSXExpressionContainer" &&
      parent?.type !== "JSXAttribute"
    )
      copyExpression(node.expression);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "comments", "extra"].includes(key)) continue;
      if (Array.isArray(value)) for (const item of value) visit(item, node);
      else if (value && typeof value === "object") visit(value, node);
    }
  };
  visit(syntax);
  return errors;
}
const root = resolve(import.meta.dirname, "../..");
const canonicalKeys = new Set(
  [
    ...readFileSync(
      join(root, "crates/study-localization/src/message.rs"),
      "utf8",
    ).matchAll(/^    ([A-Z]\w*),$/gm),
  ].map((m) => m[1]),
);
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)],
  );
}
export function checkUiCopy() {
  return ["apps/desktop/src", "packages/ui/src"]
    .flatMap((directory) => files(join(root, directory)))
    .filter((path) => path.endsWith(".tsx") && !path.includes(".test."))
    .flatMap((path) => visibleCopyErrors(readFileSync(path, "utf8"), path));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const errors = checkUiCopy();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
