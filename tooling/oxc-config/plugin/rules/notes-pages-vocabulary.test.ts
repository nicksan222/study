import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

const rule = 'notes-pages-vocabulary';

testStable('rejects retired public IDs, operations and note ownership names', async () => {
  const diagnostics = await lintRule(rule, {
    'src/features/notes/service/example.ts': `
      type SessionId = bigint;
      const sessionId = 1n;
      const requestDocumentTransform = () => {};
      const actions = { applyDocumentProposal() {}, ['keepDocumentProposal']() {} };
    `
  });

  expect(diagnostics).toHaveLength(5);
});

testStable(
  'recognizes imported Page types and schemas through aliases and namespaces',
  async () => {
    const diagnostics = await lintRule(rule, {
      'src/features/pages/example.ts': `
      import type { PageSummary as Summary } from '@study/contracts/pages/types';
      import type * as Pages from '@study/contracts/pages/types';
      import { pageIdSchema as ownerId } from '@study/contracts/ids';
      import { Schema } from 'effect';
      const document: Summary = value;
      function render(document: Pages.PageVersion) {}
      type Props = { documents: readonly Summary[] };
      const input = Schema.Struct({ documents: Schema.Array(ownerId) });
    `
    });

    expect(diagnostics).toHaveLength(4);
  }
);

testStable(
  'rejects authored Page copy, sidebar keys, cache names and export prefixes',
  async () => {
    const diagnostics = await lintRule(rule, {
      'src/features/pages/example.ts': `
      const prompt = 'Write a concise Document title';
      const result = { filename: \`document-\${id}.html\` };
      const key = ['document-restore-attempt', id];
      const label = 'SidebarTurnIntoDoc';
    `
    });

    expect(diagnostics).toHaveLength(4);
  }
);

testStable(
  'preserves source Documents, OAuth sessions, user text and durable protocol strings',
  async () => {
    const diagnostics = await lintRule(rule, {
      'src/features/pages/example.ts': `
      import type { Document } from '@study/contracts/sources/document';
      import type { PageVersion } from '@study/contracts/pages/types';
      import { documentSchema } from '@study/contracts/sources/schemas';
      const document: Document = body;
      const content: PageVersion['document'] = body;
      const historicalKeys = { noteId: 'sessionId', pageId: 'documentId' };
      const workflow = 'document-transform/v1';
      const subscription = 'session-deletion';
      const requestId = 'document/opaque';
      const scope = { kind: 'document' };
      const source = { document_id: snapshotId };
    `,
      'src/features/auth/example.ts': 'const session = currentAccount; const sessionId = token;',
      'src/features/pages/upgrade.test.ts':
        'const sessionId = oldRow.id; const body = "authored document";',
      'src/features/sources/example.ts': 'const prompt = "Document title"; const kind = "document";'
    });

    expect(diagnostics).toStrictEqual([]);
  }
);

testStable(
  'does not confuse unrelated local types with canonical imported Page entities',
  async () => {
    const diagnostics = await lintRule(rule, {
      'src/features/pages/example.ts': `
      type Page = { title: string };
      const document: Page = value;
      const documents = body.blocks;
    `
    });

    expect(diagnostics).toStrictEqual([]);
  }
);

testStable(
  'handles nullable Page types, generic collections and namespaced Page schemas',
  async () => {
    const diagnostics = await lintRule(rule, {
      'src/features/pages/example.ts': `
      import type { PageSummary } from '@study/contracts/pages/types';
      import * as Ids from '@study/contracts/ids';
      import { Schema } from 'effect';
      type Props = { document: PageSummary | null; documents: ReadonlyArray<PageSummary> };
      const input = Schema.Struct({ document: Schema.NullOr(Ids.pageIdSchema) });
    `
    });

    expect(diagnostics).toHaveLength(3);
  }
);

testStable(
  'preserves shadowed schema namespaces, canonical indexed types and mixed unions',
  async () => {
    const diagnostics = await lintRule(rule, {
      'src/features/pages/example.ts': `
      import type { PageVersion, PageSummary } from '@study/contracts/pages/types';
      import type { Document } from '@study/contracts/sources/document';
      import * as Ids from '@study/contracts/ids';
      function edit(document: PageVersion['document']) {}
      function mixed(document: PageSummary | Document) {}
      function unrelated(Ids: any) { return Schema.Struct({ document: Ids.pageIdSchema }); }
    `
    });

    expect(diagnostics).toStrictEqual([]);
  }
);

testStable('allows web authentication sessions and shadowed collection type names', async () => {
  const diagnostics = await lintRule(
    rule,
    {
      'apps/web/src/features/auth/provider.ts': 'const session = account; const sessionId = token;',
      'apps/web/src/features/pages/example.ts': `
      import type { PageId } from '@study/contracts/ids';
      type Array<T> = { content: string };
      const document: Array<PageId> = value;
    `
    },
    true
  );

  expect(diagnostics).toStrictEqual([]);
});

testStable('does not treat shadowed schema factories as Effect schemas', async () => {
  const diagnostics = await lintRule(rule, {
    'src/features/pages/example.ts': `
      import { pageIdSchema } from '@study/contracts/ids';
      import { Schema } from 'effect';
      function custom(Schema: any) {
        return { document: Schema.Array(pageIdSchema) };
      }
    `
  });

  expect(diagnostics).toStrictEqual([]);
});
