import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { sql } from 'drizzle-orm';

import { Db } from '../src/index.ts';

test('learning tables enforce typed content and ownership', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'study-learning-'));
  const db = Db.open(join(folder, 'study.db'));

  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const run = (query: ReturnType<typeof sql>) => db.orm.run(query);

  run(sql`SELECT version_id FROM material_quiz_versions LIMIT 0`);
  run(sql`INSERT INTO projects(id,name,created_at,updated_at) VALUES (1,'P',1,1)`);

  for (const [id, kind] of [
    [1, 'quiz'],
    [2, 'quiz'],
    [3, 'flashcards'],
    [4, 'flashcards']
  ] as const) {
    run(
      sql`INSERT INTO materials(id,project_id,kind,title,created_at,updated_at) VALUES (${id},1,${kind},'M',1,1)`
    );
    run(
      sql`INSERT INTO material_versions(id,material_id,project_id,kind,number,status,created_at) VALUES (${id},${id},1,${kind},1,'draft',1)`
    );
  }

  run(sql`INSERT INTO material_quiz_versions(version_id) VALUES (1),(2)`);
  run(
    sql`INSERT INTO material_quiz_questions(id,version_id,position,kind,prompt,explanation) VALUES (1,1,0,'single_choice','Q','E'),(2,2,0,'multiple_choice','Q','E'),(3,1,1,'open','Q','E')`
  );
  run(
    sql`INSERT INTO material_quiz_choices(id,question_id,question_kind,position,text,is_correct) VALUES (1,1,'single_choice',0,'A',1),(2,2,'multiple_choice',0,'B',0)`
  );
  run(
    sql`INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES (3,'Reference')`
  );
  run(
    sql`INSERT INTO material_quiz_choices(question_id,question_kind,position,text,is_correct) VALUES (1,'single_choice',1,'Other',0),(2,'multiple_choice',1,'Correct',1)`
  );
  run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id IN (1,2)`);
  run(
    sql`INSERT INTO material_quiz_attempts(id,version_id,status,started_at) VALUES (1,1,'in_progress',0)`
  );
  run(
    sql`INSERT INTO material_quiz_responses(attempt_id,version_id,question_id,question_kind) VALUES (1,1,1,'single_choice')`
  );
  run(sql`INSERT INTO material_quiz_selections(attempt_id,question_id,choice_id) VALUES (1,1,1)`);
  run(
    sql`INSERT INTO material_quiz_responses(attempt_id,version_id,question_id,question_kind,answer,score) VALUES (1,1,3,'open','Answer',0.5)`
  );
  run(sql`INSERT INTO material_flashcard_versions(version_id,material_id) VALUES (3,3),(4,4)`);
  run(sql`INSERT INTO material_card_identities(id,material_id) VALUES (1,3),(2,4)`);
  run(
    sql`INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back) VALUES (3,3,1,0,'Front','Back')`
  );
  run(
    sql`INSERT INTO material_card_schedules(card_id,due,state,stability,difficulty,reps,lapses) VALUES (1,0,'new',0,1,0,0)`
  );
  run(sql`UPDATE material_versions SET status='published',published_at=2 WHERE id=3`);
  run(
    sql`INSERT INTO material_card_reviews(card_id,version_id,reviewed_at,rating,elapsed_days) VALUES (1,3,0,'good',0)`
  );
  const invalid = [
    sql`INSERT INTO material_quiz_versions(version_id) VALUES (3)`,
    sql`INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back) VALUES (3,3,2,1,'F','B')`,
    sql`INSERT INTO material_flashcard_entries(version_id,material_id,card_id,position,front,back) VALUES (4,3,1,1,'F','B')`,
    sql`INSERT INTO material_quiz_responses(attempt_id,version_id,question_id,question_kind) VALUES (1,1,2,'multiple_choice')`,
    sql`INSERT INTO material_quiz_selections(attempt_id,question_id,choice_id) VALUES (1,1,2)`,
    sql`INSERT INTO material_quiz_open_answers(question_id,reference_answer) VALUES (1,'R')`,
    sql`UPDATE material_quiz_questions SET kind='choice' WHERE id=3`,
    sql`UPDATE material_quiz_questions SET position=-1 WHERE id=3`,
    sql`UPDATE material_quiz_questions SET position=0 WHERE id=3`,
    sql`UPDATE material_quiz_questions SET prompt=' ' WHERE id=3`,
    sql`UPDATE material_quiz_questions SET explanation='' WHERE id=3`,
    sql`UPDATE material_quiz_choices SET is_correct=2 WHERE id=1`,
    sql`UPDATE material_quiz_choices SET question_kind='open' WHERE id=1`,
    sql`UPDATE material_quiz_choices SET position=-1 WHERE id=1`,
    sql`UPDATE material_quiz_choices SET text='' WHERE id=1`,
    sql`UPDATE material_quiz_responses SET answer='invalid' WHERE question_id=1`,
    sql`UPDATE material_quiz_responses SET score=1.1 WHERE question_id=1`,
    sql`UPDATE material_quiz_responses SET answer=' ' WHERE question_id=3`,
    sql`UPDATE material_quiz_attempts SET status='completed' WHERE id=1`,
    sql`UPDATE material_quiz_attempts SET started_at=-1 WHERE id=1`,
    sql`UPDATE material_card_schedules SET state='invalid' WHERE card_id=1`,
    sql`UPDATE material_card_schedules SET difficulty=11 WHERE card_id=1`,
    sql`UPDATE material_card_schedules SET stability=-1 WHERE card_id=1`,
    sql`UPDATE material_card_schedules SET stability=36501 WHERE card_id=1`,
    sql`UPDATE material_card_schedules SET reps=-1 WHERE card_id=1`,
    sql`UPDATE material_card_schedules SET lapses=-1 WHERE card_id=1`,
    sql`UPDATE material_flashcard_entries SET position=-1 WHERE card_id=1`,
    sql`UPDATE material_flashcard_entries SET front=' ' WHERE card_id=1`,
    sql`UPDATE material_flashcard_entries SET back='' WHERE card_id=1`,
    sql`UPDATE material_quiz_versions SET kind='flashcards' WHERE version_id=1`,
    sql`UPDATE material_flashcard_versions SET kind='quiz' WHERE version_id=3`,
    sql`UPDATE material_quiz_attempts SET status='invalid' WHERE id=1`,
    sql`UPDATE material_quiz_attempts SET finished_at=1 WHERE id=1`,
    sql`UPDATE material_quiz_responses SET question_kind='open' WHERE question_id=1`,
    sql`UPDATE material_card_reviews SET version_id=4 WHERE card_id=1`,
    sql`UPDATE material_card_reviews SET rating='invalid' WHERE card_id=1`,
    sql`UPDATE material_card_reviews SET elapsed_days=-1 WHERE card_id=1`
  ];

  for (const query of invalid) assert.throws(() => run(query));
});
