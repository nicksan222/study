import * as schema from '@study/db/schema';
import { sql } from 'drizzle-orm';

import { syncCanonicalArtifact } from '#backend/procedures/material/canonical';
import { cardRow } from '#backend/procedures/material/operations/artifact';
import { now } from '#backend/procedures/practice/finish-question';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { ArtifactId, CardId, QuestionId } from '#backend/shared/ids';
import type { Card } from '#backend/shared/study/types';

import { question as opQuestion } from './practice.ts';

export function addMistakeCard(
  ctx: BackendContext,
  id: QuestionId,
  front: string,
  back: string,
  title: string
): Card {
  return ctx.transaction(() => {
    const q = opQuestion(ctx, id);

    if (!q || q.status !== 'graded' || q.verdict === 'correct')
      throw new StudyError('invalid_input', 'question is not a mistake');

    if (!front.trim() || !back.trim() || !title.trim() || [...title.trim()].length > 200)
      throw new StudyError('invalid_input', 'empty card');

    if (
      ctx.db.orm
        .select({
          id: schema.cards.id
        })
        .from(schema.cards)
        .where(sql`question_id=${id}`)
        .get()
    )
      throw new StudyError('invalid_input', 'mistake already saved');

    const practice = ctx.db.orm
      .select({
        project_id: schema.practices.project_id
      })
      .from(schema.practices)
      .where(sql`id=${q.practiceId}`)
      .get()!;
    let a = ctx.db.orm
      .select({
        id: schema.artifacts.id
      })
      .from(schema.artifacts)
      .where(sql`practice_id=${q.practiceId}`)
      .get()?.id as ArtifactId | undefined;

    if (!a)
      a = ctx.db.orm
        .insert(schema.artifacts)
        .values({
          project_id: practice.project_id as bigint,
          practice_id: q.practiceId,
          kind: 'flashcards',
          mistakes: 1n,
          title: title.trim(),
          status: 'complete',
          body: '{"type":"flashcards","cards":[]}',
          created_at: now(),
          updated_at: now()
        })
        .run().lastInsertRowid as ArtifactId;

    const card = ctx.db.orm
      .insert(schema.cards)
      .values({
        artifact_id: a,
        ordinal: sql`(SELECT COALESCE(MAX(ordinal),-1)+1 FROM cards WHERE artifact_id=${a})`,
        front: front.trim(),
        back: back.trim(),
        due: now(),
        question_id: id
      })
      .run().lastInsertRowid as CardId;
    const cards = ctx.db.orm
      .select({
        front: schema.cards.front,
        back: schema.cards.back,
        cites: schema.cards.cites
      })
      .from(schema.cards)
      .where(sql`artifact_id=${a}`)
      .orderBy(schema.cards.ordinal)
      .all()
      .map((row) => ({
        front: row.front,
        back: row.back,
        cites: JSON.parse(row.cites as string)
      }));

    ctx.db.orm
      .update(schema.artifacts)
      .set({
        body: JSON.stringify({
          type: 'flashcards',
          cards
        }),
        updated_at: now()
      })
      .where(sql`id=${a}`)
      .run();
    syncCanonicalArtifact(ctx, a);
    const row = ctx.db.orm
      .select()
      .from(schema.cards)
      .where(sql`id=${card}`)
      .get()!;

    return cardRow(row);
  });
}
