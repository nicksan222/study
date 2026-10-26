import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { localizationOutputs } from "./localization.mjs";
const root = resolve(import.meta.dirname, "../..");
const temporary = mkdtempSync(join(tmpdir(), "study-codegen-"));
const check = process.argv.includes("--check");
try {
  execFileSync(
    "protoc",
    [
      "-I",
      `${root}/crates/study-rpc/proto`,
      `--plugin=protoc-gen-es=${root}/node_modules/.bin/protoc-gen-es`,
      `--es_out=${temporary}`,
      "--es_opt=target=ts,import_extension=none",
      "study/v1/study.proto",
    ],
    { stdio: "inherit" },
  );
  const outputs = [
    [
      "apps/desktop/src/generated/study_pb.ts",
      readFileSync(`${temporary}/study/v1/study_pb.ts`, "utf8"),
    ],
    ["apps/desktop/src/generated/catalog.ts", localizationOutputs(root)],
  ];
  for (const [path, source] of outputs) {
    const destination = join(root, path);
    if (check) {
      if (readFileSync(destination, "utf8") !== source)
        throw new Error(
          `Stale generated file: ${path}; run bun run gen:protocol`,
        );
    } else {
      mkdirSync(resolve(destination, ".."), { recursive: true });
      writeFileSync(destination, source);
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
