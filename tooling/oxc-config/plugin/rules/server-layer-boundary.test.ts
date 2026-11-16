import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'RPC adapters delegate subscriptions instead of owning database capabilities',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/workflows/rpc.ts': `
      import { Database } from '#server/platform/database/database';
      import type { ServerContext } from '../../platform/database/context';
      import { Workflows } from './service';
    `,
      'src/features/workflows/service.ts': `
      import { databaseChanges } from '#server/platform/database/database';
    `
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'store network calls follow global fetch aliases without matching shadows',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/jobs/jobs.store.ts': `const request = globalThis.fetch;
 const run = request;
 run('https://example.com');
 function f(fetch: () => void) { const request = fetch;
 request();
 }`
    });

    test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.stable(
  'real SQLite tests can inspect persistence and runtime while production adapters cannot',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/projects/rpc/create.test.ts':
        "import '@study/db'; import '#server/runtime/service'; import '#server/features/projects/store';",
      'src/features/projects/rpc/create.ts': "import '@study/db';"
    });

    test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics[0].filename.endsWith('/rpc/create.ts'));
  }
);

test.stable('feature roles enforce private stores and public cross-feature services', async () => {
  const diagnostics = await lintRule('server-layer-boundary', {
    'src/features/source/source.service.ts': `import '#server/features/project';
 import '#server/features/project/project.service';
 import './source.workflow';
`,
    'src/features/source/source.workflow.ts':
      "import './source.service'; import './source.store'; import '@study/db';",
    'src/features/source/source.rpc.ts':
      "import './source.service'; import './source.store'; import '@study/db';",
    'src/features/source/source.store.ts':
      "import './source.service'; const request = globalThis.fetch; request('/');",
    'src/features/source/source.service.test.ts': "import './source.store'; import '@study/db';"
  });

  test.assert.strictEqual(diagnostics.length, 8, JSON.stringify(diagnostics));
});

test.stable(
  'feature boundaries inspect aliases and loaders without confusing shadowed require',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/source/source.workflow.ts': `const load = require;
load('#server/features/source/source.store');
function f(require: (x: string) => void) { require('#server/features/source/source.store');
} import('#server/features/source/source.store');`
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'feature public indexes cannot expose stores and only stores own database access',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/source/index.ts':
        "export { SourceService } from './source.service'; export { SourceStore } from './source.store';",
      'src/features/source/source.service.ts':
        "import { db } from '@study/db'; import type { Db } from '@study/db';",
      'src/features/source/source.decoder.ts': "import '@study/db';",
      'src/features/source/source.store.ts': "import '@study/db';"
    });

    test.assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.stable('feature public exports and adapters retain role boundaries', async () => {
  const diagnostics = await lintRule('server-layer-boundary', {
    'src/features/a/index.ts':
      "export { helper } from './helper'; export { AService } from './a.service';",
    'src/features/a/a.rpc.ts': "import './helper'; import './a.service';",
    'src/features/a/a.workflow.ts': "import type { Db } from '@study/db';"
  });

  test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test.stable('plain role filenames enforce the same boundaries as suffixed filenames', async () => {
  const diagnostics = await lintRule('server-layer-boundary', {
    'src/features/sources/store.ts': "import '@study/db'; import './service'; fetch('/');",
    'src/features/sources/service.ts': "import './workflow'; import '@study/db';",
    'src/features/sources/workflow.ts': "import './store'; import './service';",
    'src/features/sources/rpc.ts': "import './store'; import './service';",
    'src/features/sources/index.ts':
      "export { Sources } from './service'; export { SourceStore } from './store';"
  });

  test.assert.strictEqual(diagnostics.length, 7, JSON.stringify(diagnostics));
});

test.stable(
  'platform capabilities are valid service dependencies but private store type exports are not',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/sources/service.ts':
        "import { PublicationGuard } from '#server/platform/workflows/publication';",
      'src/features/materials/service.ts':
        "export type { SourceStore as MaterialsService } from './store';",
      'src/features/sources/nested/store.ts': "import '@study/db';"
    });

    test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics[0].filename.endsWith('/features/materials/service.ts'));
  }
);

test.stable('FSRS has one platform adapter rather than feature-specific copies', async () => {
  const diagnostics = await lintRule('server-layer-boundary', {
    'src/platform/scheduling/fsrs.ts': "import { fsrs } from 'ts-fsrs';",
    'src/features/learning/srs.ts': "import { fsrs } from 'ts-fsrs';",
    'src/features/practice/store.ts': "import type { Card } from 'ts-fsrs';"
  });

  test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test.stable('preferences are private to settings, auth, and themes stores', async () => {
  const diagnostics = await lintRule('server-layer-boundary', {
    'src/features/settings/store.ts': "import { preferences } from '@study/db';",
    'src/features/auth/token.store.ts': "import { preferences as credentials } from '@study/db';",
    'src/features/themes/store/selection.ts':
      "import * as schema from '@study/db'; schema.preferences;",
    'src/features/learning/store.ts': "import { preferences as prefs } from '@study/db';",
    'src/features/materials/materials.store.ts': "import { preferences } from '@study/db';",
    'src/features/notes/store/query.ts':
      "import * as schema from '@study/db'; schema.preferences; schema['preferences'];",
    'src/features/sources/store.ts': `import * as schema from '@study/db';
 const tables = schema;
 const { ['preferences']: prefs } = tables;
`,
    'src/features/settings/service.ts': "import { preferences } from '@study/db';",
    'src/features/learning/store.test.ts': "import { preferences } from '@study/db';"
  });

  test.assert.strictEqual(diagnostics.length, 6, JSON.stringify(diagnostics));
});

test.stable('preferences checks respect shadows, type imports, and unrelated tables', async () => {
  const diagnostics = await lintRule('server-layer-boundary', {
    'src/features/learning/store.ts': `import * as schema from '@study/db';
import type { preferences } from '@study/db';
schema.cards;
const { cards } = schema;
function f(schema: { preferences: string }) { const tables = schema;
tables.preferences;
const { preferences } = tables;
}`,
    'src/features/materials/store.ts':
      "import type * as schema from '@study/db'; type P = typeof schema.preferences;"
  });

  test.assert.strictEqual(diagnostics.length, 0, JSON.stringify(diagnostics));
});

test.stable(
  'runtime assembles feature workflows only through the dispatch and recovery registry',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/runtime/workflows.ts':
        "import { sourceIngestionHandlerLayer } from '#server/features/sources/workflow';",
      'src/runtime/native.ts':
        "import { sourceIngestionHandlerLayer } from '#server/features/sources/workflow';",
      'src/runtime/workers.ts':
        "import { sourceIngestionWorkflow } from '#server/features/sources/workflow';"
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'cross-feature capture uses public synchronous participants without exposing private selection stores',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/notes/service/capture.ts': `
      import { Materials } from '#server/features/materials/index';
      import { transaction } from '#server/platform/definitions/define-store';
      export const capture = (target) =>
        transaction((tx) => Materials.resolveNoteSelection(tx, target));
    `,
      'src/features/notes/service/bypass.ts': `
      import { MaterialVersionsStore } from '#server/features/materials/store/index';
    `,
      'src/features/materials/index.ts': `
      export { Materials } from './service/index';
      export { MaterialVersionsStore } from './store/index';
    `
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/service/capture.ts')));
  }
);

test.stable(
  'note transform coordinators use public participants and cannot import another feature private stores',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/notes/service/page-transform.ts': `
      import { Materials } from '#server/features/materials/index';
      import { publicationTransaction } from '#server/platform/definitions/define-store';
      export const publish = (context, output) =>
        publicationTransaction((tx) => Materials.publishPageTransform(tx, context, output));
    `,
      'src/features/materials/service/bypass.ts': `
      import { NoteContextStore } from '#server/features/notes/store/index';
    `,
      'src/features/notes/service/bypass.ts': `
      import { MaterialGenerationStore } from '#server/features/materials/store/index';
    `
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/service/bypass.ts')));
  }
);

test.stable(
  'proposal coordinators compose public Materials participants instead of reaching into private stores',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/notes/service/proposals.ts': `
      import { Materials } from '#server/features/materials/index';
      import { transaction } from '#server/platform/definitions/define-store';
      export const apply = value => transaction(tx => Materials.applyPageProposal(tx, value, true));
      export const keep = value => transaction(tx => Materials.keepPageProposal(tx, value));
    `,
      'src/features/notes/service/private.ts': `
      import { PageProposalStore } from '#server/features/materials/store/page-proposals';
    `,
      'src/features/materials/service/private.ts': `
      import { NoteContextValidityStore } from '#server/features/notes/store/context';
    `
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/service/private.ts')));
  }
);

test.stable(
  'note evidence composition consumes the public Materials participant and keeps all evidence stores private',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/notes/service/citations.ts': `
      import { Materials } from '#server/features/materials/index';
      import type { evidenceReferenceSchema } from '@study/contracts';
      import { transaction } from '#server/platform/definitions/define-store';
      export const resolve = reference => transaction(tx => Materials.resolveEvidence(tx, reference));
    `,
      'src/features/notes/service/private-evidence.ts': `
      import { EvidenceStore } from '#server/features/materials/store/evidence';
      import { CitationSupportStore } from '#server/features/materials/store/citation-support';
      import { AnnotationsStore } from '#server/features/materials/store/annotations';
    `,
      'src/features/materials/index.ts': `
      export { Materials } from './service/index';
      export { EvidenceStore } from './store/evidence';
    `
    });

    test.assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
    test.assert.ok(
      diagnostics.every(({ filename }) => !filename.endsWith('/service/citations.ts'))
    );
  }
);

test.stable(
  'deletion coordinators compose public Materials and Workflows retirement participants',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/notes/service/deletion.ts': `
      import { Materials } from '#server/features/materials/index';
      import { Workflows } from '#server/features/workflows/index';
      import { transaction } from '#server/platform/definitions/define-store';
      export const retire = input => transaction(tx => {
        Materials.prepareNoteRetirement(tx, input);
        Workflows.retireCorrelations(tx, input.ids, input.eventTypes);
      });
    `,
      'src/features/notes/service/private.ts': `
      import { NoteMaterialRetirementStore } from '#server/features/materials/store/note-retirement';
      import { ExecutionStore } from '#server/features/workflows/store/index';
    `
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));

    test.assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/service/private.ts')));
  }
);

test.stable(
  'Material cleanup composes public synchronous participants and cannot expose or import private retirement stores',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/materials/service/deletion.ts': `
      import { Sources } from '#server/features/sources/index';
      import { Notes } from '#server/features/notes/index';
      import { Recordings } from '#server/features/recordings/index';
      import { Learning } from '#server/features/learning/index';
      import { Workflows } from '#server/features/workflows/index';
      import { publicationTransaction } from '#server/platform/definitions/define-store';
      export const finish = id => publicationTransaction(tx => {
        Notes.scrubMaterialDeletion(tx, id); Sources.scrubMaterialDeletion(tx, id);
        Recordings.scrubMaterialDeletion(tx, id); Learning.scrubMaterialDeletion(tx, [id]);
        Workflows.scrubRetiredCorrelations(tx, [id]);
      });
    `,
      'src/features/materials/service/private.ts': `
      import { SourceMaterialDeletionStore } from '#server/features/sources/store/material-deletion';
      import { NoteMaterialDeletionStore } from '#server/features/notes/store/material-deletion';
    `,
      'src/features/sources/index.ts': `export { SourceMaterialDeletionStore } from './store/material-deletion';`
    });

    test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/service/deletion.ts')));
  }
);

test.stable(
  'history pruning composes public participants without exposing private ownership stores',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/features/materials/service/history.ts': `
      import { Sources } from '#server/features/sources/index';
      import { Notes } from '#server/features/notes/index';
      import { Learning } from '#server/features/learning/index';
      import { Workflows } from '#server/features/workflows/index';
      export const finish = tx => {
        Sources.scrubMaterialHistory(tx, 'exact'); Notes.scrubMaterialHistory(tx, 'exact');

        Learning.scrubMaterialHistory(tx, []); Workflows.scrubRetiredCorrelations(tx, []);
      };

    `,
      'src/features/materials/service/private-history.ts': `
      import { SourceMaterialHistoryStore } from '#server/features/sources/store/material-history';
      import { NoteMaterialHistoryStore } from '#server/features/notes/store/material-history';
    `,
      'src/features/sources/index.ts': `export { SourceMaterialHistoryStore } from './store/material-history';`
    });

    test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));

    test.assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/service/history.ts')));
  }
);

test.stable(
  'backup participants are injected by runtime and feature coordinators cannot acquire runtime or foreign stores',
  async () => {
    const diagnostics = await lintRule('server-layer-boundary', {
      'src/runtime/backups.ts': `import { Materials } from '#server/features/materials/index';
 import { Notes } from '#server/features/notes/index';
`,
      'src/features/system/service/backup.ts': `import { backupPolicy } from '#server/runtime/backups';
 import { SourceBackupStore } from '#server/features/sources/store/backup';
`,
      'src/features/materials/service/backup.ts': `import { Sources } from '#server/features/sources/index';
import { transaction } from '#server/platform/definitions/define-store';
transaction(tx => Sources.validateBackup(tx));`
    });

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
    test.assert.ok(diagnostics.every((d) => d.filename.endsWith('/system/service/backup.ts')));
  }
);
