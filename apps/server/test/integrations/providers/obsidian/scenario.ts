/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies a real Obsidian vault becomes editable Study notes.                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates vault content through the running application.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real HTTP RPC SQLite and native Workflow publish and verify imported content.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { fs, path, run } from '#integration-tests/filesystem';
import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

import { readVault, startObsidian, requireObsidianContainer } from './driver.ts';

function scenario() {
  return Effect.gen(function* () {
    yield* Effect.promise(() => requireObsidianContainer('obsidian'));
    const directory = yield* Effect.promise(() =>
      run(fs.makeTempDirectory({ prefix: 'study-obsidian-' }))
    );
    const obsidian = yield* Effect.acquireRelease(
      Effect.promise(() => startObsidian(directory)),
      (obsidian) => Effect.promise(() => obsidian.close())
    );
    const created = yield* Effect.promise(() =>
      obsidian.evaluate(`(async () => {
    await app.vault.createFolder('Biology');
    await app.vault.createFolder('assets');
    await app.vault.create('Biology/Cells.md', '---\\ntitle: Cell biology\\ntags: [science]\\n---\\n# Cells\\n\\nSee [[DNA|genetic material]] and ![[assets/cell.svg]].');
    await app.vault.create('Biology/DNA.md', '# DNA\\n\\nDNA carries genetic information.');
    await app.vault.create('Empty.md', '');
    await app.vault.create('Excluded.md', '# Leave this note in Obsidian');
    await app.vault.create('assets/cell.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>');
    return app.vault.getMarkdownFiles().map(file => file.path).sort();
  })()`)
    );

    expect(created).toEqual(['Biology/Cells.md', 'Biology/DNA.md', 'Empty.md', 'Excluded.md']);
    const app = yield* Effect.acquireRelease(
      Effect.promise(() => App.open({ path: path.join(directory, 'study.sqlite') })),
      (app) => Effect.promise(() => app.close())
    );
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => serve(app)),
      (server) => Effect.promise(() => server.close())
    );

    yield* Effect.promise(() => app.workers.start());
    const files = yield* Effect.promise(() => readVault(obsidian.vault));

    const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
    const providers = yield* client['integrations.providers']({});

    expect(providers).toEqual([{ id: 'obsidian', capabilities: ['import'] }]);
    const preview = yield* client['integrations.previewImport']({
      providerId: 'obsidian',
      sourceKey: 'Real Obsidian E2E',
      files
    });

    expect(preview.items.length).toBe(3);
    expect(preview.warnings.some((warning) => warning.code === 'empty_note')).toBeTruthy();
    yield* client['integrations.startImport']({
      id: preview.id,
      excludedKeys: ['Excluded.md']
    });
    let result = yield* client['integrations.import']({ id: preview.id });

    while (result.status === 'running') {
      yield* Effect.sleep('50 millis');
      result = yield* client['integrations.import']({ id: preview.id });
    }

    expect(result.status).toBe('completed');
    expect(result.items.map((item) => item.status)).toEqual(['imported', 'imported', 'excluded']);
    const notes = yield* client['notes.notes']({ limit: 100 });

    expect(notes.items.map((item) => item.title).sort()).toEqual(['Cell biology', 'DNA']);
    const documents = yield* client['pages.pages']({ limit: 100, archived: false });
    const cells = documents.items.find((item) => item.title === 'Cell biology');

    expect(cells).toBeTruthy();
    const detail = yield* client['pages.page']({ id: cells!.id });

    expect(detail.version).toBeTruthy();
    expect(
      detail.version!.document.blocks.some((block) => block.text.includes('genetic material'))
    ).toBeTruthy();
    const dnaNote = result.items.find((item) => item.key === 'Biology/DNA.md')!.noteId;
    const links = detail
      .version!.document.blocks.flatMap((block) =>
        block.content.type === 'paragraph' ? block.content.inlines : []
      )
      .filter((inline) => inline.type === 'link');

    expect(links).toEqual([{ type: 'link', text: 'genetic material', href: `/note/${dnaNote}` }]);
    const sources = yield* client['sources.sources']({ limit: 100 });
    const svg = sources.items.find((item) => item.name === 'cell.svg');

    expect(svg).toBeTruthy();
    const cellNote = result.items.find((item) => item.key === 'Biology/Cells.md')!.noteId;
    const thread = yield* client['notes.thread']({
      noteId: cellNote!,
      limit: 100
    });

    expect(
      thread.items.flatMap((message) => message.parts).some((part) => part.sourceId === svg!.id)
    ).toBeTruthy();
    const exported = yield* client['sources.exportRevision']({
      sourceId: svg!.id,
      revision: 1n
    });

    expect(new TextDecoder().decode(exported.bytes)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>'
    );
    const repeated = yield* client['integrations.previewImport']({
      providerId: 'obsidian',
      sourceKey: 'Real Obsidian E2E',
      files
    });

    yield* client['integrations.startImport']({
      id: repeated.id,
      excludedKeys: ['Excluded.md']
    });
    let second = yield* client['integrations.import']({ id: repeated.id });

    while (second.status === 'running') {
      yield* Effect.sleep('50 millis');
      second = yield* client['integrations.import']({ id: repeated.id });
    }

    expect(second.items.map((item) => item.status)).toEqual(['unchanged', 'unchanged', 'excluded']);
    expect((yield* client['notes.notes']({ limit: 100 })).items.length).toBe(2);
  });
}

testStable(
  'official Obsidian creates a vault and Study imports it through HTTP RPC and native Workflow',
  { timeout: 60000 },
  async () => {
    await Effect.runPromise(Effect.scoped(scenario()), { signal: AbortSignal.timeout(45000) });
  }
);
