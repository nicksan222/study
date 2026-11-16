import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'shared UI components reject local style props but native wrappers and type imports remain legal',
  async () => {
    const diagnostics = await lintRule(
      'shared-ui-variants',
      {
        'apps/client/src/example.tsx': `import { Button as Control } from "@study/ui";
import { Shell } from "@study/ui";
import * as UI from "@study/ui";
export const view = <div className="layout"><Control className="p-2" /><Shell.Header style={{ color: "red" }} /><UI.Button {...{ className: "p-2" }} /></div>;`
      },
      true
    );
    const violations = diagnostics.filter(({ code }) => code.includes('shared-ui-variants'));

    test.assert.strictEqual(violations.length, 3, JSON.stringify(diagnostics));
  }
);

test.stable('computed literal style props cannot bypass shared UI variants', async () => {
  const diagnostics = await lintRule(
    'shared-ui-variants',
    {
      'apps/client/src/example.tsx': `import { Button } from '@study/ui'; export const view = <Button {...{ ['style']: {} }} />;`
    },
    true
  );

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});
