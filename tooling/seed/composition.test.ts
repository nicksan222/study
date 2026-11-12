import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { code, paragraph, textSource } from './builders/content.ts';
import {
  createProject,
  createSource,
  createPage,
  createFlashcards,
  createNote
} from './harnesses/index.ts';
import type { SeedHarness } from './harnesses/index.ts';
import { seedDatabase } from './seed.ts';

function createSmallCourse(seed: SeedHarness) {
  const project = createProject(seed, { name: 'Small course', color: 'blue', examInDays: 21 });
  const source = createSource(
    project,
    textSource('outline.txt', 'Course outline\n\nA small, complete source fixture.')
  );
  const guide = createPage(project, {
    title: 'Working guide',
    blocks: [paragraph('Read the outline.'), code('SELECT 1;', 'sql')]
  });
  const overview = createFlashcards(project, 'Course overview', [['Read', 'Practice']]);

  createNote(project, {
    title: 'Read the outline',
    daysAgo: 2,
    exchanges: [['Where should I start?', 'Read the course outline.']],
    sources: [source],
    pages: [guide],
    materials: [overview]
  });
  createNote(project, {
    title: 'Apply the ideas',
    daysAgo: 1,
    exchanges: [['What should I do next?', 'Practise with a concrete example.']],
    sources: [source],
    pages: [guide],
    materials: [overview]
  });
}

testStable('creator sequences reuse library fixtures across any number of notes', async () => {
  const location = await createTestDatabase();

  try {
    const summary = await seedDatabase(location.path, [createSmallCourse]);

    expect(summary).toEqual({ projects: 1, notes: 2, sources: 1, pages: 1, materials: 1 });

    const db = await location.open();

    try {
      expect(db.orm.get(sql`SELECT count(*) n FROM notes`)?.n).toBe(2n);
      expect(db.orm.get(sql`SELECT count(*) n FROM note_sources`)?.n).toBe(2n);
      expect(db.orm.get(sql`SELECT count(*) n FROM note_pages`)?.n).toBe(2n);
      expect(db.orm.get(sql`SELECT count(*) n FROM note_materials`)?.n).toBe(2n);
      expect(db.orm.get(sql`SELECT count(*) n FROM messages`)?.n).toBe(4n);
      expect(db.orm.get(sql`SELECT count(*) n FROM material_flashcard_versions`)?.n).toBe(1n);
      expect(db.orm.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
    } finally {
      db.close();
    }
  } finally {
    await location.cleanup();
  }
});

testStable(
  'cross-project fixture references abort the candidate and preserve the existing database',
  async () => {
    const location = await createTestDatabase();
    const db = await location.open();
    const before = db.contentIdentity();

    db.close();

    try {
      await expect(
        seedDatabase(location.path, [
          (seed) => {
            const first = createProject(seed, { name: 'First', color: 'blue', examInDays: 21 });
            const second = createProject(seed, { name: 'Second', color: 'green', examInDays: 28 });
            const source = createSource(
              first,
              textSource('private.txt', 'A project-owned source.')
            );

            createNote(second, {
              title: 'Wrong project',
              exchanges: [],
              daysAgo: 1,
              sources: [source]
            });
          }
        ])
      ).rejects.toThrow(RangeError);

      const retained = await location.open();

      try {
        expect(retained.contentIdentity()).toBe(before);
      } finally {
        retained.close();
      }
    } finally {
      await location.cleanup();
    }
  }
);

testStable('notes can mix multiple turns and omit unrelated fixture kinds', async () => {
  const location = await createTestDatabase();

  try {
    await seedDatabase(location.path, [
      (seed) => {
        const project = createProject(seed, {
          name: 'Open questions',
          color: 'blue',
          examInDays: 21
        });

        createNote(project, {
          title: 'Open questions',
          daysAgo: 1,
          exchanges: [
            ['What do I know?', 'Start by writing down what you remember.'],
            ['How do I check it?', 'Compare your answer with the source.']
          ]
        });
      }
    ]);

    const db = await location.open();

    try {
      expect(db.orm.get(sql`SELECT count(*) n FROM messages`)?.n).toBe(4n);
      expect(db.orm.get(sql`SELECT count(*) n FROM sources`)?.n).toBe(0n);
    } finally {
      db.close();
    }
  } finally {
    await location.cleanup();
  }
});
