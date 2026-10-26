import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkConventions } from "./conventions.ts";

test("production packages cannot depend on fixture bridge", () => {
  const root = mkdtempSync(join(tmpdir(), "study-conventions-"));
  try {
    mkdirSync(join(root, "apps/desktop/src-tauri"), { recursive: true });
    writeFileSync(
      join(root, "apps/desktop/src-tauri/Cargo.toml"),
      '[dependencies]\nstudy-web-bridge = { path = "../../../tooling/web-bridge" }\n',
    );
    assert.match(checkConventions(root).join("\n"), /fixture bridge/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("browser consumer tests cannot intercept or fulfill production RPC", () => {
  const root = mkdtempSync(join(tmpdir(), "study-conventions-"));
  try {
    mkdirSync(join(root, "tooling/e2e/tests"), { recursive: true });
    writeFileSync(
      join(root, "tooling/e2e/tests/example.spec.ts"),
      "await page.route('**/rpc/**', route => route.fulfill({json:[]}));\n",
    );
    assert.match(checkConventions(root).join("\n"), /mock transport/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("website references must have a real production capture scene", () => {
  const root = mkdtempSync(join(tmpdir(), "study-conventions-"));
  try {
    mkdirSync(join(root, "tooling/e2e/tests"), { recursive: true });
    mkdirSync(join(root, "apps/landing/src/content/docs/en"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "tooling/e2e/tests/captures.spec.ts"),
      "const scenes: Scene[] = [{ name: 'home', route: 'Home' }];\nconst root = '.';\n",
    );
    writeFileSync(
      join(root, "apps/landing/src/content/docs/en/test.mdx"),
      "---\nshot: missing-scene\n---\n",
    );
    assert.match(
      checkConventions(root).join("\n"),
      /missing-scene.*capture scene/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("different named still scenes cannot silently publish identical pixels", () => {
  const root = mkdtempSync(join(tmpdir(), "study-conventions-"));
  try {
    mkdirSync(join(root, "tooling/e2e/tests"), { recursive: true });
    mkdirSync(join(root, "apps/landing/src/content/docs/en"), {
      recursive: true,
    });
    mkdirSync(join(root, "apps/landing/src/assets/shots"), { recursive: true });
    writeFileSync(
      join(root, "tooling/e2e/tests/captures.spec.ts"),
      "const scenes: Scene[] = [{ name: 'home' }, {name:'library'}];\nconst root = '.';\n",
    );
    writeFileSync(
      join(root, "apps/landing/src/content/docs/en/test.mdx"),
      "shot: home\n![Library](shot:library)\n",
    );
    for (const name of ["home", "library"])
      writeFileSync(
        join(root, `apps/landing/src/assets/shots/${name}-en-light.webp`),
        "identical raster bytes",
      );
    assert.match(
      checkConventions(root).join("\n"),
      /identical.*home.*library|identical.*library.*home/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
