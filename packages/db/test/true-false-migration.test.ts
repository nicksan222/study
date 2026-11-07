import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { Db, sql } from '../src/index.ts';

testStable(
  'true or false migration preserves populated quiz attempts and all existing trigger guards',
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'study-boolean-migration-'));
    const migrations = fileURLToPath(new URL('../drizzle', import.meta.url));
    const previous = join(folder, 'migrations');
    const path = join(folder, 'study.sqlite');
    let connection: Db | undefined;

    try {
      for (const name of readdirSync(migrations))
        if (name < '20261107130459_true-false-practice')
          cpSync(join(migrations, name), join(previous, name), { recursive: true });

      connection = Db.open(path, previous);
      const db = connection.orm;
      const statements = [
        "INSERT INTO materials(id,kind,title,created_at,updated_at) VALUES(1,'quiz','Recall',1,1)",
        "INSERT INTO material_versions(id,material_id,kind,number,created_at) VALUES(1,1,'quiz',1,1)",
        'INSERT INTO material_quiz_versions(version_id) VALUES(1)',
        "INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES(1,1,0,'open','Explain ATP','Energy'),(2,1,1,'single_choice','Select','Choice')",
        "INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES(1,'Energy carrier')",
        "INSERT INTO material_quiz_choices(id,question_id,question_kind,position,text,is_correct) VALUES(1,2,'single_choice',0,'ATP',1),(2,2,'single_choice',1,'DNA',0)",
        "UPDATE material_versions SET status='published',published_at=1 WHERE id=1",
        "INSERT INTO material_quiz_attempts(id,version_id,status,started_at) VALUES(1,1,'in_progress',1)",
        'INSERT INTO material_quiz_attempt_questions(attempt_id,version_id,question_id,position) VALUES(1,1,1,0),(1,1,2,1)',
        'INSERT INTO material_quiz_attempt_choices(attempt_id,question_id,choice_id,position) VALUES(1,2,1,0),(1,2,2,1)',
        "INSERT INTO material_quiz_responses(attempt_id,version_id,question_id,question_kind,answer,score,feedback) VALUES(1,1,1,'open','Energy carrier',1,'Correct'),(1,1,2,'single_choice',NULL,1,NULL)",
        'INSERT INTO material_quiz_selections(attempt_id,question_id,choice_id) VALUES(1,2,1)',
        "UPDATE material_quiz_attempts SET status='completed',finished_at=2 WHERE id=1"
      ];

      for (const statement of statements) db.run(sql.raw(statement));

      const tables = [
        'material_quiz_questions',
        'material_quiz_open_answers',
        'material_quiz_choices',
        'material_quiz_attempts',
        'material_quiz_attempt_questions',
        'material_quiz_attempt_choices',
        'material_quiz_responses',
        'material_quiz_selections'
      ];
      const before = tables.map((table) => db.all(sql.raw(`SELECT * FROM ${table}`)));
      const triggers = db.all(
        sql`SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name`
      );

      connection.close();
      connection = undefined;
      connection = Db.open(path);
      assert.deepEqual(
        tables.map((table) => connection!.orm.all(sql.raw(`SELECT * FROM ${table}`))),
        before
      );
      assert.deepEqual(
        connection.orm.all(sql`SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name`),
        triggers
      );
      assert.deepEqual(connection.orm.all(sql`PRAGMA foreign_key_check`), []);
      assert.throws(() =>
        connection!.orm.run(sql`UPDATE material_quiz_responses SET score=0 WHERE attempt_id=1`)
      );
      assert.throws(() =>
        connection!.orm.run(sql`UPDATE material_quiz_questions SET prompt='Changed' WHERE id=1`)
      );
    } finally {
      connection?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  }
);
