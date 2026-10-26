import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Catalog arms deliberately contain only Rust string literals. Fail closed if that
// changes, so a Rust expression can never silently become a missing translation.
export function localizationOutputs(root: string): string {
  const read = (path: string): string =>
    readFileSync(`${root}/crates/study-localization/src/${path}`, "utf8");
  const keys = [...read("message.rs").matchAll(/^    ([A-Z]\w*),$/gm)].map(
    (match) => match[1],
  );
  const catalogs: Record<string, Record<string, string>> = {};
  for (const language of ["english", "italian"] as const) {
    const source = read(`catalog/${language}.rs`);
    const arms = [
      ...source.matchAll(
        /Message::(\w+)\s*=>\s*(?:\{\s*)?("(?:[^"\\]|\\.)*")/gs,
      ),
    ];
    const values: Record<string, string> = Object.fromEntries(
      arms.map(([, key, literal]) => [key, JSON.parse(literal) as string]),
    );
    if (keys.length !== arms.length || keys.some((key) => !(key in values))) {
      throw new Error(
        `Catalog ${language} is not an exhaustive literal catalog; extend the exporter.`,
      );
    }
    catalogs[language] = values;
  }
  return `// Generated from study-localization. Run bun run gen:protocol.\nexport const catalogs = ${JSON.stringify(catalogs, null, 2)} as const;\nexport type MessageKey = keyof typeof catalogs.english;\nexport type Locale = keyof typeof catalogs;\n`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.stdout.write(localizationOutputs(`${import.meta.dirname}/../..`));
}
