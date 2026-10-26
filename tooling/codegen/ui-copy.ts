import { parse } from "@babel/parser";
import type { Node } from "@babel/types";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const canonicalKeys = new Set(
  [
    ...readFileSync(
      join(root, "crates/study-localization/src/message.rs"),
      "utf8",
    ).matchAll(/^    ([A-Z]\w*),$/gm),
  ].map((match) => match[1]),
);
const keyAttrs = new Set(["label", "description", "empty", "hint", "title"]);
const visibleAttrs = new Set([
  ...keyAttrs,
  "placeholder",
  "aria-label",
  "alt",
  "closeLabel",
]);
const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof value.type === "string";

export function visibleCopyErrors(
  source: string,
  filename = "component.tsx",
): string[] {
  const syntax = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const errors: string[] = [];
  const report = (node: Node, text: string) => {
    errors.push(
      `${filename}:${node.loc?.start.line ?? 1}: literal user-visible copy ${JSON.stringify(text)}`,
    );
  };
  const copyExpression = (
    node: Node | null | undefined,
    allowKeys = false,
  ): void => {
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
    if (node.type === "TemplateLiteral") {
      for (const fragment of node.quasis)
        if (/\p{L}/u.test(fragment.value.raw))
          report(fragment, fragment.value.raw);
    }
  };
  const visit = (node: Node, parent?: Node): void => {
    if (node.type === "JSXText" && /\p{L}/u.test(node.value))
      report(node, node.value.trim());
    if (node.type === "JSXAttribute" && node.name.type === "JSXIdentifier") {
      const name = node.name.name;
      const value = node.value;
      if (visibleAttrs.has(name) && value) {
        const allowKeys = keyAttrs.has(name);
        if (
          value.type === "StringLiteral" &&
          /\p{L}/u.test(value.value) &&
          !(allowKeys && canonicalKeys.has(value.value))
        )
          report(value, value.value);
        if (value.type === "JSXExpressionContainer")
          copyExpression(value.expression, allowKeys);
      }
    }
    if (
      node.type === "JSXExpressionContainer" &&
      parent?.type !== "JSXAttribute"
    )
      copyExpression(node.expression);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, node);
      } else if (isNode(value)) visit(value, node);
    }
  };
  visit(syntax);
  return errors;
}

function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(path, entry.name))
      : [join(path, entry.name)],
  );
}

export function checkUiCopy(): string[] {
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
