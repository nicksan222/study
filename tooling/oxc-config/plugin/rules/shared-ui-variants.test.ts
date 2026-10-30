import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

test('shared UI components reject local style props but native wrappers and type imports remain legal', () => {
  const diagnostics = lintRule(
    'shared-ui-variants',
    {
      'apps/web/src/example.tsx': `import { Button as Control } from "@study/ui/button";
import { Shell } from "@study/ui/shell";
import * as UI from "@study/ui/button";
export const view = <div className="layout"><Control className="p-2" /><Shell.Header style={{ color: "red" }} /><UI.Button {...{ className: "p-2" }} /></div>;`
    },
    true
  );
  const violations = diagnostics.filter(({ code }) => code.includes('shared-ui-variants'));

  assert.equal(violations.length, 3, JSON.stringify(diagnostics));
});

test('computed literal style props cannot bypass shared UI variants', () => {
  const diagnostics = lintRule(
    'shared-ui-variants',
    {
      'apps/web/src/example.tsx': `import { Button } from '@study/ui/button'; export const view = <Button {...{ ['style']: {} }} />;`
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
