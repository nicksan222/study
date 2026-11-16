import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use the native service.use callback instead of nesting Effect.flatMap around a service key.';

test.unit.stable(
  'service access uses native accessors across aliases and preserves unrelated effects',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'service-access',
      await lintRule({ assert }, 'service-access', {
        'src/bad.ts': String.raw`import { Effect as E, Context } from "effect";
import { Settings as Preferences } from "#server/features/settings/index";
import * as DB from "#server/platform/database/database";
const alias = Preferences;
E.flatMap(alias, read);
E.flatMap(DB.Database, read);
const Local = Context.Service("local");
E.flatMap(Local, read);`,
        'src/good.ts': String.raw`import { Effect } from "effect";
import { Settings } from "#server/features/settings/index";
Settings.use(read);
Effect.flatMap(work, read);
Effect.flatMap((value) => read(value));
function f(Settings: any) {
  return Effect.flatMap(Settings, read);
}`
      }),
      Array.from({ length: 3 }, (): [string, string] => ['src/bad.ts', message])
    );
  }
);
