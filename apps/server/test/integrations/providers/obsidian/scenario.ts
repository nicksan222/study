/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies a real Obsidian vault becomes editable Study sessions.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates vault content through the running application.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real HTTP RPC SQLite and native Workflow publish and verify imported content.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StudyRpc } from '@study/contracts/rpc';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

import { readVault, startObsidian, requireObsidianContainer } from './driver.ts';

testStable(
  'official Obsidian creates a vault and Study imports it through HTTP RPC and native Workflow',
  { timeout: 300000 },
  async (t) => {
    requireObsidianContainer('obsidian');
    const directory = await mkdtemp(join(tmpdir(), 'study-obsidian-'));
    const obsidian = await startObsidian(directory);

    t.onTestFinished(() => obsidian.close());
    const created = await obsidian.evaluate(`(async () => {
    await app.vault.createFolder('Biology');
    await app.vault.createFolder('assets');
    await app.vault.create('Biology/Cells.md', '---\\ntitle: Cell biology\\ntags: [science]\\n---\\n# Cells\\n\\nSee [[DNA|genetic material]] and ![[assets/cell.svg]].');
    await app.vault.create('Biology/DNA.md', '# DNA\\n\\nDNA carries genetic information.');
    await app.vault.create('Empty.md', '');
    await app.vault.create('Excluded.md', '# Leave this note in Obsidian');
    await app.vault.create('assets/cell.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>');
    return app.vault.getMarkdownFiles().map(file => file.path).sort();
  })()`);

    assert.deepEqual(created, ['Biology/Cells.md', 'Biology/DNA.md', 'Empty.md', 'Excluded.md']);
    const app = await App.open({ path: join(directory, 'study.sqlite') });

    t.onTestFinished(() => app.close());
    const server = await serve(app);

    t.onTestFinished(() => server.close());
    await app.workers.start();
    const files = await readVault(obsidian.vault);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
          const providers = yield* client['integrations.providers']({});

          assert.deepEqual(providers, [{ id: 'obsidian', capabilities: ['import'] }]);
          const preview = yield* client['integrations.previewImport']({
            providerId: 'obsidian',
            sourceKey: 'Real Obsidian E2E',
            files
          });

          assert.equal(preview.items.length, 3);
          assert.ok(preview.warnings.some((warning) => warning.code === 'empty_note'));
          yield* client['integrations.startImport']({
            id: preview.id,
            excludedKeys: ['Excluded.md']
          });
          let result = yield* client['integrations.import']({ id: preview.id });

          while (result.status === 'running') {
            yield* Effect.sleep('50 millis');
            result = yield* client['integrations.import']({ id: preview.id });
          }

          assert.equal(result.status, 'completed');
          assert.deepEqual(
            result.items.map((item) => item.status),
            ['imported', 'imported', 'excluded']
          );
          const sessions = yield* client['conversations.sessions']({ limit: 100 });

          assert.deepEqual(sessions.items.map((item) => item.title).sort(), [
            'Cell biology',
            'DNA'
          ]);
          const documents = yield* client['documents.documents']({ limit: 100, archived: false });
          const cells = documents.items.find((item) => item.title === 'Cell biology');

          assert.ok(cells);
          const detail = yield* client['documents.document']({ id: cells.id });

          assert.ok(detail.version);
          assert.ok(
            detail.version.document.blocks.some((block) => block.text.includes('genetic material'))
          );
          const dnaSession = result.items.find((item) => item.key === 'Biology/DNA.md')!.sessionId;
          const paragraph = detail.version.document.blocks.find(
            (block) => block.content.type === 'paragraph'
          );

          assert.ok(paragraph?.content.type === 'paragraph');
          assert.deepEqual(
            paragraph.content.inlines.filter((inline) => inline.type === 'link'),
            [{ type: 'link', text: 'genetic material', href: `/session/${dnaSession}` }]
          );
          const sources = yield* client['sources.sources']({ limit: 100 });
          const svg = sources.items.find((item) => item.name === 'cell.svg');

          assert.ok(svg);
          const cellSession = result.items.find(
            (item) => item.key === 'Biology/Cells.md'
          )!.sessionId;
          const thread = yield* client['conversations.thread']({
            sessionId: cellSession!,
            limit: 100
          });

          assert.ok(
            thread.items
              .flatMap((message) => message.parts)
              .some((part) => part.sourceId === svg.id)
          );
          const exported = yield* client['sources.exportRevision']({
            sourceId: svg.id,
            revision: 1n
          });

          assert.equal(
            new TextDecoder().decode(exported.bytes),
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

          assert.deepEqual(
            second.items.map((item) => item.status),
            ['unchanged', 'unchanged', 'excluded']
          );
          assert.equal((yield* client['conversations.sessions']({ limit: 100 })).items.length, 2);

          return {
            obsidianVersion: '1.15.0',
            firstImport: result,
            repeatedImport: second,
            sessions: sessions.items
          };
        })
      ),
      { signal: AbortSignal.timeout(45000) }
    );
  }
);
