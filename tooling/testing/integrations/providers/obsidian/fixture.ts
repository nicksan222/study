import { StudyRpc } from '@study/contracts';
import { snapshotValues } from '@study/contracts/testing';
import { makeStudyClient } from '@study/server/client';
import { createServerFixture } from '@study/server/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Creates independent Obsidian vaults and Study services for each test.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns provider processes, SQLite state, RPC clients and failure diagnostics.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Every resource belongs to one scoped test and closes before directory removal.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { observeUntil } from '@study/testing/effect';
import { temporaryDirectory } from '@study/testing/resources';
import { Effect, Exit } from 'effect';

import { path } from '#tooling/testing/integrations/filesystem';

import { readVault, startObsidian } from './driver.ts';

export function obsidianVault(name: string) {
  return Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => temporaryDirectory({ prefix: 'study-obsidian-' })),
      (directory) => Effect.promise(() => directory[Symbol.asyncDispose]())
    );

    yield* Effect.addFinalizer((exit) =>
      Effect.promise(async () => {
        if (Exit.isFailure(exit)) {
          const source = Bun.file(path.join(directory.path, 'obsidian.log'));

          if (await source.exists())
            await Bun.write(
              path.resolve('tooling/test-results/integrations', `${name}.log`),
              source
            );
        }
      })
    );
    const obsidian = yield* Effect.acquireRelease(
      Effect.promise(() => startObsidian(directory.path)),
      (obsidian) => Effect.promise(() => obsidian.close())
    );

    yield* Effect.promise(() =>
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

    const fixture = yield* Effect.acquireRelease(
      Effect.promise(() => createServerFixture()),
      (fixture) => Effect.promise(() => fixture[Symbol.asyncDispose]())
    );
    const { app, server } = yield* Effect.promise(() =>
      fixture.openRpc({ path: path.join(directory.path, 'study.sqlite') })
    );

    yield* Effect.promise(() => app.workers.start());
    const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
    const files = yield* Effect.promise(() => readVault(obsidian.vault));

    return {
      client,
      preview: () =>
        client['integrations.previewImport']({
          providerId: 'obsidian',
          sourceKey: 'Obsidian test vault',
          files
        }),
      import: (excludedKeys: string[] = []) =>
        Effect.gen(function* () {
          const preview = yield* client['integrations.previewImport']({
            providerId: 'obsidian',
            sourceKey: 'Obsidian test vault',
            files
          });

          yield* client['integrations.startImport']({ id: preview.id, excludedKeys });

          return yield* observeUntil(
            snapshotValues(client['integrations.import.live']({ id: preview.id })),
            (value) => value.status !== 'running'
          );
        })
    };
  });
}
