import { StudyRpc } from '@study/contracts/rpc';
import { createTestDatabase } from '@study/db/testing';
import { makeStudyClient } from '@study/server/client';
import { App, serve } from '@study/server/runtime';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { seedDatabase } from './seed.ts';

testStable(
  'seeded coursework opens through the real application RPC without workers or external requests',
  async () => {
    const location = await createTestDatabase();

    await seedDatabase(location.path);

    const app = await App.open({
      path: location.path,
      fetch: async () => {
        throw new Error('Seeding must stay offline');
      }
    });
    const server = await serve(app);

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });
            const sources = yield* client['sources.sources']({ limit: 100 });

            expect(sources.items).toHaveLength(15);

            for (const source of sources.items) {
              const exported = yield* client['sources.sourceExport']({ id: source.id });
              const extraction = yield* client['sources.currentExtraction']({ id: source.id });

              expect(exported.bytes.length).toBeGreaterThan(0);
              expect(extraction?.document.blocks.length).toBeGreaterThan(0);
              expect(source.createdAt).toBeLessThan(BigInt(Math.floor(Date.now() / 1000)));
            }

            const projects = yield* client['projects.projects']({ limit: 100 });

            expect(projects.items).toHaveLength(5);

            for (const project of projects.items) {
              const notes = yield* client['notes.notes']({
                limit: 100,
                project: project.id
              });

              expect(notes.items).toHaveLength(10);
              expect(new Set(notes.items.map((note) => note.title)).size).toBe(10);
            }

            const pages = yield* client['pages.pages']({ limit: 100, archived: false });

            expect(pages.items).toHaveLength(10);

            for (const note of pages.items) {
              const detail = yield* client['pages.page']({ id: note.id });

              expect(detail.version?.document.blocks.length).toBeGreaterThan(0);
              expect(detail.projectIds).toHaveLength(1);
            }

            const materials = yield* client['materials.materials']({ limit: 100, archived: false });

            expect(materials.items).toHaveLength(15);

            for (const material of materials.items) {
              const detail = yield* client['materials.material']({ id: material.id });

              expect(detail.version.status).toBe('published');
              expect(detail.projectIds).toHaveLength(1);
            }
          })
        )
      );
    } finally {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  }
);
