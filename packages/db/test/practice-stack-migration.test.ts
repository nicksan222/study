import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';

testStable('matching upgrade retains earlier question kinds, references and boolean guards', () => {
  const folder = mkdtempSync(join(tmpdir(), 'study-practice-stack-'));
  const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
  const previous = join(folder, 'migrations');
  const path = join(folder, 'study.sqlite');
  let connection: Db | undefined;

  try {
    for (const name of readdirSync(migrations))
      if (name < '20261107132029_matching-practice')
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
    const before = db.all(sql`SELECT id,kind,prompt FROM material_quiz_questions ORDER BY id`);

    connection.close();
    connection = Db.open(path);
    const next = connection.orm;

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
    assert.deepEqual(next.all(sql`PRAGMA foreign_key_check`), []);
  } finally {
    connection?.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
