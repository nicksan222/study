import { test } from '@study/testing';

import { lintRulePaths } from '../test/utils.ts';

test.stable(
  'icon library bindings require explicit purpose aliases',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const prefix = 'packages/icons/src/';
    const invalid = {
      'export.ts': "export { FileText } from 'lucide-react';",
      'import.ts': "import { FileText } from 'lucide-react';",
      'mixed.ts': "export { FileText as NoteIcon, ArrowUp } from 'lucide-react';",
      'star.ts': "export * from 'lucide-react';",
      'namespace-export.ts': "export * as icons from 'lucide-react';",
      'namespace.ts': "import * as icons from 'lucide-react';",
      'default.ts': "import icons from 'lucide-react';",
      'side-effect.ts': "import 'lucide-react';",
      'dynamic.ts': "const icons = import('lucide-react');",
      'require.ts': "const icons = require('lucide-react');",
      'deep.ts': "export { default } from 'lucide-react/dist/esm/icons/file-text';",
      'type.ts': "export type { LucideIcon } from 'lucide-react';"
    };
    const valid = {
      'export.ts': "export { FileText as NoteIcon, ArrowUp as SendIcon } from 'lucide-react';",
      'import.ts': "import { FileText as NoteIcon } from 'lucide-react'; export { NoteIcon };",
      'same-import.ts': "import { Menu as Menu } from 'lucide-react';",
      'same.ts': "export { Menu as Menu } from 'lucide-react';",
      'type.ts': "export type { LucideIcon as IconComponent } from 'lucide-react';",
      'comment.ts': "export { FileText /* purpose */ as NoteIcon } from 'lucide-react';",
      'unrelated.ts': "export { FileText } from 'other-library';"
    };
    const files = Object.fromEntries([
      ...Object.entries(invalid).map(([file, source]) => [prefix + 'invalid/' + file, source]),
      ...Object.entries(valid).map(([file, source]) => [prefix + 'valid/' + file, source]),
      ['apps/client/src/example.ts', "import { NoteIcon } from '@study/icons';"]
    ]);

    expect(await lintRulePaths({ assert }, 'icon-aliases', files)).toStrictEqual(
      Object.keys(invalid)
        .map((file) => prefix + 'invalid/' + file)
        .sort()
    );
  }
);
