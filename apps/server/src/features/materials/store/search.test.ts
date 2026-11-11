/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies published source search projections against real SQLite database records. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises version publication, scope changes and anchored passage retrieval.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses temporary database files and the feature search projection without running models.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Clock, Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { makeMaterialSearchProjections } from './search.ts';

testStable(
  'material projections include published payloads and choices while excluding hidden quiz answers',
  () => {
    const location = createTestDatabase();
    const db = location.open();

    try {
      db.orm.run(
        sql`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES (1,'quiz','Quiz',1,1),(2,'flashcards','More cards',1,1),(3,'flashcards','Cards',1,1)`
      );
      db.orm.run(
        sql`INSERT INTO material_versions(id,material_id,kind,number,status,created_at) VALUES (1,1,'quiz',1,'draft',1),(2,2,'flashcards',1,'draft',1),(3,3,'flashcards',1,'draft',1)`
      );
      db.orm.run(sql`INSERT INTO material_quiz_versions(version_id) VALUES (1)`);
      db.orm.run(
        sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES (1,1,0,'open','Orbital motion','Secret explanation')`
      );
      db.orm.run(
        sql`INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES (1,'Secret reference')`
      );
      db.orm.run(
        sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES (2,1,1,'single_choice','Color','Secret correction')`
      );
      db.orm.run(
        sql`INSERT INTO material_quiz_choices(id,question_id,question_kind,position,text,is_correct) VALUES (1,2,'single_choice',0,'Blue',1),(2,2,'single_choice',1,'Red',0)`
      );
      db.exec(
        `INSERT INTO material_flashcard_versions(version_id,material_id) SELECT id,material_id FROM material_versions v WHERE id IN (2) AND NOT EXISTS(SELECT 1 FROM material_flashcard_versions f WHERE f.version_id=v.id); INSERT INTO material_card_identities(id,material_id) SELECT DISTINCT material_id,material_id FROM material_versions v WHERE id IN (2) AND NOT EXISTS(SELECT 1 FROM material_card_identities c WHERE c.id=v.material_id); INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back) SELECT id,material_id,material_id,0,'graph TD; Sun-->Earth','Answer' FROM material_versions WHERE id=2`
      );
      db.orm.run(sql`INSERT INTO material_flashcard_versions(version_id,material_id) VALUES (3,3)`);
      db.orm.run(sql`INSERT INTO material_card_identities(id,material_id) VALUES (1,3)`);
      db.orm.run(
        sql`INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back) VALUES (3,3,1,0,'Planet','Terra')`
      );
      expect(
        makeMaterialSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })()
      ).toStrictEqual([]);
      db.orm.run(sql`UPDATE material_versions SET status='published',published_at=2`);
      const entries = makeMaterialSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })();

      expect(entries.map((entry) => entry.target.type)).toStrictEqual([
        'question',
        'question',
        'material',
        'material',
        'material'
      ]);
      const read = makeMaterialSearchProjections({ db, clock: Effect.runSync(Clock.Clock) });
      const questionPage = read({ kind: 'question', offset: 1, limit: 1 });
      const materialPage = read({ kind: 'material', offset: 1, limit: 1 });

      expect(questionPage.map((entry) => entry.title)).toStrictEqual(['Color']);
      expect(materialPage.map((entry) => entry.title)).toStrictEqual(['More cards']);
      expect(
        read({
          kind: 'question',
          offset: 0,
          limit: 10,
          targets: questionPage.map((entry) => entry.target)
        })
      ).toStrictEqual(questionPage);
      expect(
        read({
          kind: 'material',
          offset: 0,
          limit: 10,
          targets: materialPage.map((entry) => entry.target)
        })
      ).toStrictEqual(materialPage);
      expect(
        read({
          kind: 'material',
          offset: 0,
          limit: 10,
          targets: questionPage.map((entry) => entry.target)
        })
      ).toStrictEqual([]);
      expect(entries.some((entry) => entry.text.includes('Secret'))).toBe(false);
      expect(entries.some((entry) => entry.text.includes('Blue\nRed'))).toBe(true);
      expect(entries.some((entry) => entry.text.includes('Sun-->Earth'))).toBe(true);
      expect(entries.some((entry) => entry.text.includes('Planet\nTerra'))).toBe(true);
      db.orm.run(sql`UPDATE materials SET archived_at=3 WHERE id=1`);
      expect(
        makeMaterialSearchProjections({ db, clock: Effect.runSync(Clock.Clock) })().map(
          (entry) => entry.target.type
        )
      ).toStrictEqual(['material', 'material']);
    } finally {
      db.close();
      location.cleanup();
    }
  }
);
