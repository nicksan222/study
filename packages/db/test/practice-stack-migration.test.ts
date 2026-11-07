import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';

for (const cutoff of ['20261107132029_matching-practice', '20261107141857_ordering-practice'])
  testStable(`${cutoff} retains earlier question kinds, references and boolean guards`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-practice-stack-'));
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    const previous = join(folder, 'migrations');
    const path = join(folder, 'study.sqlite');
    let connection: Db | undefined;

    try {
      for (const name of readdirSync(migrations))
        if (name < cutoff)
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      connection = Db.open(path, previous);
      const db = connection.orm;

      db.run(
        sql`INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'quiz','Recall',1,1)`
      );
      db.run(
        sql`INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'quiz',1,1)`
      );
      db.run(sql`INSERT INTO material_quiz_versions(version_id) VALUES(1)`);
      db.run(sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES
      (1,1,0,'single_choice','Choose one','Evidence'),
      (2,1,1,'multiple_choice','Choose several','Evidence'),
      (3,1,2,'open','Explain','Evidence'),
      (4,1,3,'fill_blank','Recall ____','Evidence'),
      (5,1,4,'true_false','ATP carries energy','Evidence')`);
      db.run(
        sql`INSERT INTO material_quiz_open_answers(question_id,kind,reference_answer) VALUES(3,'open','Energy'),(4,'fill_blank','ATP')`
      );
      db.run(sql`INSERT INTO material_quiz_choices(id,question_id,question_kind,position,text,is_correct) VALUES
      (1,1,'single_choice',0,'ATP',1),(2,1,'single_choice',1,'DNA',0),
      (3,2,'multiple_choice',0,'ATP',1),(4,2,'multiple_choice',1,'DNA',1),
      (5,5,'true_false',0,'true',1),(6,5,'true_false',1,'false',0)`);
      const pairs = [
        {
          termId: '11111111-1111-4111-8111-111111111111',
          definitionId: '33333333-3333-4333-8333-333333333333',
          term: 'ATP',
          definition: 'Energy'
        },
        {
          termId: '22222222-2222-4222-8222-222222222222',
          definitionId: '44444444-4444-4444-8444-444444444444',
          term: 'DNA',
          definition: 'Information'
        }
      ];
      const matching = cutoff.endsWith('ordering-practice');

      if (matching)
        db.run(
          sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation,matching_pairs) VALUES(10,1,5,'matching','Match','Evidence',${JSON.stringify(pairs)})`
        );

      db.run(sql`UPDATE material_versions SET status='published',published_at=1 WHERE id=1`);
      db.run(
        sql`INSERT INTO material_quiz_attempts(id,version_id,status,started_at) VALUES(1,1,'in_progress',1)`
      );
      db.run(
        sql`INSERT INTO material_quiz_attempt_questions(attempt_id,version_id,question_id,position) VALUES(1,1,5,0)`
      );
      db.run(
        sql`INSERT INTO material_quiz_attempt_choices(attempt_id,question_id,choice_id,position) VALUES(1,5,5,0),(1,5,6,1)`
      );
      db.run(
        sql`INSERT INTO material_quiz_responses(attempt_id,version_id,question_id,question_kind) VALUES(1,1,5,'true_false')`
      );
      db.run(
        sql`INSERT INTO material_quiz_selections(attempt_id,question_id,choice_id) VALUES(1,5,5)`
      );

      if (matching) {
        db.run(
          sql`INSERT INTO material_quiz_attempt_questions(attempt_id,version_id,question_id,position,matching_order) VALUES(1,1,10,1,${JSON.stringify(pairs.map((pair) => pair.definitionId))})`
        );
        db.run(
          sql`INSERT INTO material_quiz_responses(attempt_id,version_id,question_id,question_kind,answer,score) VALUES(1,1,10,'matching',${JSON.stringify(pairs.map(({ termId, definitionId }) => ({ termId, definitionId })))},1)`
        );
      }

      const responses = db.all(sql`SELECT * FROM material_quiz_responses ORDER BY question_id`);
      const before = db.all(sql`SELECT id,kind,prompt FROM material_quiz_questions ORDER BY id`);

      connection.close();
      connection = Db.open(path);
      const next = connection.orm;

      assert.deepEqual(
        next.all(sql`SELECT * FROM material_quiz_responses ORDER BY question_id`),
        responses
      );
      assert.deepEqual(
        next.all(sql`SELECT id,kind,prompt FROM material_quiz_questions ORDER BY id`),
        before
      );
      assert.deepEqual(next.all(sql`SELECT choice_id FROM material_quiz_selections`), [
        { choice_id: 5n }
      ]);
      assert.throws(() =>
        next.run(
          sql`INSERT INTO material_quiz_selections(attempt_id,question_id,choice_id) VALUES(1,5,6)`
        )
      );
      next.run(sql`DELETE FROM material_quiz_selections WHERE attempt_id=1`);
      assert.throws(() =>
        next.run(sql`UPDATE material_quiz_attempts SET status='completed',finished_at=2 WHERE id=1`)
      );
      next.run(
        sql`INSERT INTO material_quiz_selections(attempt_id,question_id,choice_id) VALUES(1,5,5)`
      );
      next.run(sql`UPDATE material_quiz_attempts SET status='completed',finished_at=2 WHERE id=1`);
      assert.throws(() =>
        next.run(sql`UPDATE material_quiz_questions SET prompt='Changed' WHERE id=5`)
      );
      assert.throws(() => next.run(sql`DELETE FROM material_quiz_responses WHERE attempt_id=1`));
      next.run(
        sql`INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(2,1,'quiz',2,1)`
      );
      next.run(sql`INSERT INTO material_quiz_versions(version_id) VALUES(2)`);
      next.run(
        sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES(6,2,0,'true_false','Malformed truth tokens','Evidence')`
      );
      next.run(
        sql`INSERT INTO material_quiz_choices(id,question_id,question_kind,position,text,is_correct) VALUES(7,6,'true_false',0,'Yes',1),(8,6,'true_false',1,'No',0)`
      );
      assert.throws(() =>
        next.run(sql`UPDATE material_versions SET status='published',published_at=1 WHERE id=2`)
      );

      if (matching) {
        assert.throws(() =>
          next.run(
            sql`UPDATE material_quiz_attempt_questions SET matching_order='[]' WHERE question_id=10`
          )
        );
        next.run(
          sql`INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(3,1,'quiz',3,1)`
        );
        next.run(sql`INSERT INTO material_quiz_versions(version_id) VALUES(3)`);
        next.run(
          sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES(20,3,0,'ordering','Order','Evidence')`
        );
        assert.throws(() =>
          next.run(sql`UPDATE material_versions SET status='published',published_at=1 WHERE id=3`)
        );
        next.run(
          sql`INSERT INTO material_quiz_ordering_items(id,question_id,position,text) VALUES(101,20,0,'First'),(102,20,1,'Second')`
        );
        next.run(sql`UPDATE material_versions SET status='published',published_at=1 WHERE id=3`);
        assert.throws(() =>
          next.run(sql`UPDATE material_quiz_ordering_items SET text='Changed' WHERE id=101`)
        );
        assert.equal(next.all(sql`SELECT DISTINCT kind FROM material_quiz_questions`).length, 7);
      }

      assert.deepEqual(next.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      connection?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
