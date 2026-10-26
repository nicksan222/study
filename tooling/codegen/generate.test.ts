import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { localizationOutputs } from "./localization.ts";
import { checkUiCopy, visibleCopyErrors } from "./ui-copy.ts";

const root = resolve(import.meta.dirname, "../..");

test("frontend catalogs are exactly the canonical bilingual Rust literals", () => {
  assert.equal(
    localizationOutputs(root),
    readFileSync(`${root}/apps/desktop/src/generated/catalog.ts`, "utf8"),
  );
  const source = localizationOutputs(root);
  assert.ok(source.includes("Libreria"));
  assert.ok(source.includes("Library"));
});

test("all frontend visible JSX and accessible labels use canonical catalog identities", () =>
  assert.deepEqual(checkUiCopy(), []));

test("copy guard catches visible literals and accessible labels while allowing catalog references", () => {
  for (const value of [
    "<p>Hello</p>",
    '<Input placeholder="Search here"/>',
    '<button aria-label="Delete">x</button>',
    '<span>{true?"Yes":"No"}</span>',
  ])
    assert.ok(visibleCopyErrors(value).length, value);
  assert.deepEqual(
    visibleCopyErrors('<Button aria-label={t("Close")}>{t("Close")}</Button>'),
    [],
  );
  assert.deepEqual(
    visibleCopyErrors('<Empty label={error?"ActionError":"NoMediaYet"}/>'),
    [],
  );
});
