import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Schema } from 'effect';

import {
  draftMaterialVersionDetailSchema,
  publishedMaterialVersionDetailSchema
} from '#backend/shared/materials/schemas';
import { createBackendTest } from '#testing/backend-test';

import type { Output } from './output.ts';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

type Expect<Value extends true> = Value;

type Material = NonNullable<Output>;

type PublishedVersion = NonNullable<Material['latestPublishedVersion']>;

type DraftVersion = NonNullable<Material['latestDraftVersion']>;

type _PublishedStateIsCorrelated = Expect<
  Equal<PublishedVersion['status'], 'published'> extends true
    ? Equal<PublishedVersion['published_at'], bigint>
    : false
>;

type _DraftStateIsCorrelated = Expect<
  Equal<DraftVersion['status'], 'draft'> extends true
    ? Equal<DraftVersion['published_at'], null>
    : false
>;

test('get distinguishes missing materials from invalid ids', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials;

  assert.equal(await c.get({ id: 999n }), null);
  await assert.rejects(c.get({ id: 0n }));
});

test('published head and latest draft remain explicit while a branch is edited', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const a = await c.create({ projectId: p.id, title: 'A', content });
  const draft = await c.createVersion({
    materialId: a.id,
    content: { ...content, payload: 'Draft' },
    publish: false,
    parents: [a.version.id]
  });
  const head = await c.get({ id: a.id });

  assert.equal(head?.version.id, a.version.id);
  assert.equal(head?.latestPublishedVersion?.id, a.version.id);
  assert.equal(head?.latestDraftVersion?.id, draft.id);

  if (head?.latestPublishedVersion) {
    const publishedAt: bigint = head.latestPublishedVersion.published_at;

    assert.equal(typeof publishedAt, 'bigint');
    assert.equal(head.latestPublishedVersion.status, 'published');

    const invalidPublishedVersion: unknown = {
      ...head.latestPublishedVersion,
      published_at: null
    };

    assert.throws(() =>
      Schema.decodeUnknownSync(publishedMaterialVersionDetailSchema)(invalidPublishedVersion)
    );
  }

  if (head?.latestDraftVersion) {
    const publishedAt: null = head.latestDraftVersion.published_at;

    assert.equal(publishedAt, null);
    assert.equal(head.latestDraftVersion.status, 'draft');

    const invalidDraftVersion: unknown = {
      ...head.latestDraftVersion,
      status: 'published',
      published_at: 1n
    };

    assert.throws(() =>
      Schema.decodeUnknownSync(draftMaterialVersionDetailSchema)(invalidDraftVersion)
    );
  }

  await c.publishVersion({ id: draft.id });
  const updated = await c.get({ id: a.id });

  assert.equal(updated?.version.id, draft.id);
  assert.equal(updated?.latestDraftVersion, null);
});

test('get preserves draft-only and archived version states', async (t) => {
  const f = await createBackendTest(t),
    c = f.caller.materials,
    p = await f.caller.projects.createProject({ name: 'P' }),
    content = { kind: 'diagram', format: 'mermaid', payload: 'A' } as const;
  const draftOnly = await c.create({ projectId: p.id, title: 'Draft', content, publish: false });
  const draftDetail = await c.get({ id: draftOnly.id });

  assert.equal(draftDetail?.version.status, 'draft');
  assert.equal(draftDetail?.version.published_at, null);
  assert.equal(draftDetail?.latestPublishedVersion, null);
  assert.equal(draftDetail?.latestDraftVersion?.status, 'draft');

  const published = await c.create({ projectId: p.id, title: 'Published', content });

  await c.archive({ id: published.id });
  const archived = await c.get({ id: published.id });

  assert.notEqual(archived?.archived_at, null);
  assert.equal(archived?.latestPublishedVersion?.status, 'published');

  if (archived?.latestPublishedVersion) {
    const publishedAt: bigint = archived.latestPublishedVersion.published_at;

    assert.equal(typeof publishedAt, 'bigint');
  }
});
