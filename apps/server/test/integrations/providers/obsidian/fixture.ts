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

import { StudyRpc } from '@study/contracts/rpc';
import { Effect, Exit } from 'effect';

import { fs, path, run } from '#integration-tests/filesystem';
import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

import { readVault, startObsidian } from './driver.ts';

export function obsidianVault(name: string) {
  return Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => run(fs.makeTempDirectory({ prefix: 'study-obsidian-' }))),
      (directory) =>
        Effect.promise(() => run(fs.remove(directory, { recursive: true, force: true })))
    );

    yield* Effect.addFinalizer((exit) =>
      Effect.promise(async () => {
        if (Exit.isFailure(exit)) {
          const source = Bun.file(path.join(directory, 'obsidian.log'));

          if (await source.exists())
            await Bun.write(
              path.resolve('apps/server/test-results/integrations', `${name}.log`),
              source
            );
        }
      })
    );
    const obsidian = yield* Effect.acquireRelease(
      Effect.promise(() => startObsidian(directory)),
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

    const app = yield* Effect.acquireRelease(
      Effect.promise(() => App.open({ path: path.join(directory, 'study.sqlite') })),
      (app) => Effect.promise(() => app.close())
    );
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => serve(app)),
      (server) => Effect.promise(() => server.close())
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
          let result = yield* client['integrations.import']({ id: preview.id });

          while (result.status === 'running') {
            yield* Effect.sleep('50 millis');
            result = yield* client['integrations.import']({ id: preview.id });
          }

          return result;
        })
    };
  });
}
