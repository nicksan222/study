import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (["target", "node_modules", "dist", ".git"].includes(entry.name))
      return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** Cross-boundary guarantees that compiler/type checks cannot express. */
export function checkConventions(root: string): string[] {
  const errors: string[] = [];
  for (const file of [
    ...files(join(root, "apps")),
    ...files(join(root, "crates")),
  ].filter((path) => path.endsWith("Cargo.toml"))) {
    if (/^study-web-bridge\s*=/m.test(readFileSync(file, "utf8")))
      errors.push(`${file}: production cannot depend on the fixture bridge`);
  }
  for (const file of files(join(root, "tooling/e2e/tests")).filter((path) =>
    /\.[cm]?[jt]sx?$/.test(path),
  )) {
    const source = readFileSync(file, "utf8");
    if (
      /\.(?:route|routeFromHAR|fulfill)\s*\(/.test(source) ||
      /\b(?:msw|mockServiceWorker)\b/.test(source)
    )
      errors.push(`${file}: browser consumer tests must not mock transport`);
  }
  const captures = join(root, "tooling/e2e/tests/captures.spec.ts");
  if (existsSync(captures)) {
    const source = readFileSync(captures, "utf8");
    const sceneBlock = source.slice(
      source.indexOf("const scenes"),
      source.indexOf("const root"),
    );
    const scenes = new Set(
      [...sceneBlock.matchAll(/name:\s*['"]([a-z][a-z0-9-]*)['"]/g)].map(
        (match) => match[1],
      ),
    );
    const referenced = new Set<string>();
    const documents = [
      ...files(join(root, "apps/landing/src/content/docs")),
      ...files(join(root, "apps/landing/src/components")),
    ];
    for (const file of documents.filter((path) =>
      /\.(md|mdx|astro)$/.test(path),
    )) {
      const text = readFileSync(file, "utf8");
      const names = [
        ...text.matchAll(/\b(?:shot|clip):\s*([a-z][a-z0-9-]*)/g),
        ...text.matchAll(/<(?:Shot|Clip)\s+name=['"]([a-z][a-z0-9-]*)['"]/g),
      ];
      for (const match of names) {
        const name = match[1];
        referenced.add(name);
        if (!scenes.has(name))
          errors.push(`${file}: ${name} has no production capture scene`);
      }
    }
    for (const name of scenes)
      if (!referenced.has(name))
        errors.push(`${captures}: unused capture scene ${name}`);
  }
  for (const variant of ["en-light", "en-dark", "it-light", "it-dark"]) {
    const hashes = new Map<string, string[]>();
    for (const file of files(
      join(root, "apps/landing/src/assets/shots"),
    ).filter((path) => path.endsWith(`-${variant}.webp`))) {
      const hash = createHash("sha256")
        .update(readFileSync(file))
        .digest("hex");
      const names = hashes.get(hash) ?? [];
      names.push(basename(file).replace(`-${variant}.webp`, ""));
      hashes.set(hash, names);
    }
    for (const names of hashes.values())
      if (names.length > 1)
        errors.push(`identical ${variant} capture stills: ${names.join(", ")}`);
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const errors = checkConventions(
    fileURLToPath(new URL("../..", import.meta.url)),
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
