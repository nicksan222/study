import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#backend/procedures/conversations/create-session';
import { postMessage as opPostMessage } from '#backend/procedures/conversations/post-message';
import { requestReply as opRequestReply } from '#backend/procedures/conversations/reanswer';
import { cancelJob as opCancelJob } from '#backend/procedures/jobs/cancel-job';
import { job as opJob } from '#backend/procedures/jobs/job';
import { listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { retryJob as opRetryJob } from '#backend/procedures/jobs/retry-job';
import {
  enqueueJob as opEnqueueJob,
  claimJob as opClaimJob,
  finishJob as opFinishJob,
  recoverJobs as opRecoverJobs,
  failJob as opFailJob,
  releaseWaiting as opReleaseWaiting
} from '#backend/procedures/jobs/worker';
import { requestMaterial as opRequestMaterial } from '#backend/procedures/material/update-material';
import { listQuestions as opListQuestions } from '#backend/procedures/practice/practice';
import { createPractice as opCreatePractice } from '#backend/procedures/practice/project-practice';
import { createProject as opCreateProject } from '#backend/procedures/projects/create-project';
import { addLink as opAddLink } from '#backend/procedures/sources/add-link';
import { correctBlock as opCorrectBlock } from '#backend/procedures/sources/correct-block';
import { createNote as opCreateNote } from '#backend/procedures/sources/create-note';
import { deleteSource as opDeleteSource } from '#backend/procedures/sources/delete-source';
import {
  saveDocument as opSaveDocument,
  saveRead as opSaveRead,
  documentOf as opDocumentOf
} from '#backend/procedures/sources/source-document';
import { BackendContext } from '#backend/runtime/context';

const emptyDocument = {
  blocks: [],
  meta: {
    extractor: null,
    extractorVersion: 0,
    provider: null,
    durationMs: null,
    pageCount: null,
    refiners: [],
    waitingFor: [],
    corrected: false
  }
};

function fixture(fn: (store: BackendContext, path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'study-jobs-')),
    path = join(dir, 'db');
  const store = BackendContext.open(path);

  try {
    fn(store, path);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('jobs are durable, deduplicated, claimed and dependencies released', () =>
  fixture((store, path) => {
    const src = opCreateNote(store, 'n', 'body');
    const job = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: src.id }
    });

    assert.equal(
      opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: src.id }
      }),
      job
    );
    const dep = opEnqueueJob(store, {
      kind: 'fetch',
      target: { type: 'source', id: src.id },
      after: [job]
    });

    assert.equal(opJob(store, dep)?.status, 'blocked');
    assert.equal(opClaimJob(store, ['extract'])?.id, job);
    assert.equal(opFinishJob(store, job, 1n), true);
    assert.equal(opJob(store, dep)?.status, 'queued');
    const other = BackendContext.open(path);

    assert.equal(opJob(other, job)?.status, 'succeeded');
    other.close();
  }));
test('job events occur only after outer commit and are discarded on rollback', () =>
  fixture((store) => {
    const source = opCreateNote(store, 'n', 'body');
    const events: undefined[] = [];

    store.subscribe(() => events.push(undefined));
    assert.throws(() =>
      store.transaction(() => {
        opEnqueueJob(store, {
          kind: 'extract',
          target: { type: 'source', id: source.id }
        });
        assert.equal(events.length, 0);

        throw Error('abort');
      })
    );
    assert.equal(events.length, 0);
    assert.equal(opListJobs(store).length, 0);
    store.transaction(() => {
      opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: source.id }
      });
      assert.equal(events.length, 0);
    });
    assert.deepEqual(events, [undefined]);
  }));
test('cancels, retries, and recovers interrupted claims', () =>
  fixture((store) => {
    const src = opCreateNote(store, 'n', 'body');
    const id = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: src.id }
    });

    assert.equal(opClaimJob(store, ['extract'])?.id, id);
    assert.equal(opRecoverJobs(store), 1);
    assert.equal(opJob(store, id)?.status, 'queued');
    assert.equal(opClaimJob(store, ['extract'])?.id, id);
    assert.equal(opCancelJob(store, id), true);
    assert.equal(opFinishJob(store, id, 2n), false);
    assert.equal(opRetryJob(store, id), true);
    assert.equal(opJob(store, id)?.status, 'queued');
  }));
test('failed jobs retain classified errors and can wait for sign-in', () =>
  fixture((store) => {
    const src = opCreateNote(store, 'n', 'body');
    const id = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: src.id }
    });

    opClaimJob(store, ['extract']);
    assert.equal(
      opFailJob(store, id, 1n, {
        kind: 'auth',
        message: 'sign in',
        retryAfterMs: null
      }),
      true
    );
    assert.equal(opJob(store, id)?.status, 'waiting');
    assert.equal(opReleaseWaiting(store), 1);
    assert.equal(opJob(store, id)?.status, 'queued');
    opClaimJob(store, ['extract']);
    assert.equal(
      opFailJob(store, id, 2n, {
        kind: 'invalid_input',
        message: 'bad',
        retryAfterMs: null
      }),
      true
    );
    assert.equal(opJob(store, id)?.status, 'failed');
    assert.equal(opJob(store, id)?.errorKind, 'invalid_input');
  }));
test('correction cancels in-flight extraction so stale read cannot overwrite it', () =>
  fixture((store) => {
    const src = opCreateNote(store, 'n', 'body');
    const doc = {
      blocks: [
        {
          kind: 'paragraph' as const,
          text: 'old',
          anchor: { type: 'page' as const, page: 1 }
        }
      ],
      meta: {
        extractor: null,
        extractorVersion: 0,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false
      }
    };
    const docId = opSaveDocument(store, src.id, doc);
    const job = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: src.id }
    });

    opClaimJob(store, ['extract']);
    const corrected = opCorrectBlock(store, src.id, docId, 0, 'old', 'new');

    assert.notEqual(corrected, null);
    assert.equal(opJob(store, job)?.status, 'cancelled');
    assert.equal(opSaveRead(store, job, 1n, src.id, doc), null);
    assert.equal(opDocumentOf(store, src.id)?.document.blocks[0].text, 'new');
  }));
test('an earlier attempt cannot finish or save after recovery and re-claim', () =>
  fixture((store) => {
    const src = opCreateNote(store, 'n', 'body');
    const job = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: src.id }
    });
    const first = opClaimJob(store, ['extract'])!;

    opRecoverJobs(store);
    const second = opClaimJob(store, ['extract'])!;

    assert.notEqual(first.attempts, second.attempts);
    const doc = {
      blocks: [],
      meta: {
        extractor: null,
        extractorVersion: 0,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false
      }
    };

    assert.equal(opSaveRead(store, job, first.attempts, src.id, doc), null);
    assert.equal(opFinishJob(store, job, first.attempts), false);
    assert.notEqual(opSaveRead(store, job, second.attempts, src.id, doc), null);
    assert.equal(opFinishJob(store, job, second.attempts), true);
  }));
test('running work cannot acquire dependencies that create cycles', () =>
  fixture((store) => {
    const s = opCreateNote(store, 'n', 'x');
    const a = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: s.id }
    });

    opClaimJob(store, ['extract']);
    const b = opEnqueueJob(store, {
      kind: 'index',
      target: { type: 'document', id: opSaveDocument(store, s.id, emptyDocument) },
      after: [a]
    });

    assert.throws(() =>
      opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: s.id },
        after: [b]
      })
    );
    opRecoverJobs(store);
    assert.equal(opJob(store, b)?.status, 'blocked');
  }));
test('missing dependencies are rejected, terminal dependencies do not block', () =>
  fixture((store) => {
    const s = opCreateNote(store, 'n', 'x');

    assert.throws(() =>
      opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: s.id },
        after: [999n as never]
      })
    );
    const a = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: s.id }
    });

    opCancelJob(store, a);
    const b = opEnqueueJob(store, {
      kind: 'index',
      target: { type: 'document', id: opSaveDocument(store, s.id, emptyDocument) },
      after: [a]
    });

    assert.equal(opJob(store, b)?.status, 'queued');
  }));
test('retry reblocks queued dependents and rejects retry after dependent starts', () =>
  fixture((store) => {
    const s = opCreateNote(store, 'n', 'x');
    const a = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: s.id }
    });
    const b = opEnqueueJob(store, {
      kind: 'index',
      target: { type: 'document', id: opSaveDocument(store, s.id, emptyDocument) },
      after: [a]
    });

    opCancelJob(store, a);
    assert.equal(opJob(store, b)?.status, 'queued');
    assert.equal(opRetryJob(store, a), true);
    assert.equal(opJob(store, b)?.status, 'blocked');
    opCancelJob(store, a);
    assert.equal(opClaimJob(store, ['index'])?.id, b);
    assert.equal(opRetryJob(store, a), false);
  }));
test('deleting a prerequisite target releases and notifies surviving dependent', () =>
  fixture((store) => {
    const a = opCreateNote(store, 'a', 'a'),
      b = opCreateNote(store, 'b', 'b');
    const first = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: a.id }
    });
    const second = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: b.id },
      after: [first]
    });
    const events: undefined[] = [];

    store.subscribe(() => events.push(undefined));
    opDeleteSource(store, a.id);
    assert.equal(opJob(store, second)?.status, 'queued');
    assert.ok(events.length > 0);
  }));
test('retryable failures with delay remain queued until due', () =>
  fixture((store) => {
    const source = opCreateNote(store, 'n', 'body'),
      id = opEnqueueJob(store, {
        kind: 'fetch',
        target: { type: 'source', id: source.id }
      });

    opClaimJob(store, ['fetch']);
    assert.equal(
      opFailJob(store, id, 1n, {
        kind: 'rate_limited',
        message: 'slow',
        retryAfterMs: 120000
      }),
      true
    );
    assert.equal(opJob(store, id)?.status, 'queued');
    assert.equal(opClaimJob(store, ['fetch']), null);
  }));
test('rejected cycle remains safe when a running job waits for sign in', () =>
  fixture((store) => {
    const s = opCreateNote(store, 'n', 'body'),
      a = opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: s.id }
      });

    opClaimJob(store, ['extract']);
    const b = opEnqueueJob(store, {
      kind: 'index',
      target: { type: 'document', id: opSaveDocument(store, s.id, emptyDocument) },
      after: [a]
    });

    assert.throws(() =>
      opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: s.id },
        after: [b]
      })
    );
    opFailJob(store, a, 1n, {
      kind: 'auth',
      message: 'sign in',
      retryAfterMs: null
    });
    assert.equal(opJob(store, b)?.status, 'blocked');
    opReleaseWaiting(store);
    opClaimJob(store, ['extract']);
    opFinishJob(store, a, 2n);
    assert.equal(opJob(store, b)?.status, 'queued');
  }));
test('document replacement reconciles jobs and nested rollback suppresses events', () =>
  fixture((store) => {
    const a = opCreateNote(store, 'a', 'a'),
      b = opCreateNote(store, 'b', 'b');
    const doc = {
      blocks: [],
      meta: {
        extractor: null,
        extractorVersion: 0,
        provider: null,
        durationMs: null,
        pageCount: null,
        refiners: [],
        waitingFor: [],
        corrected: false
      }
    };
    const firstDoc = opSaveDocument(store, a.id, doc),
      first = opEnqueueJob(store, {
        kind: 'index',
        target: { type: 'document', id: firstDoc }
      }),
      dep = opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: b.id },
        after: [first]
      });
    const events: undefined[] = [];

    store.subscribe(() => events.push(undefined));
    assert.throws(() =>
      store.transaction(() => {
        opSaveDocument(store, a.id, doc);

        throw Error('rollback');
      })
    );
    assert.equal(events.length, 0);
    assert.equal(opJob(store, dep)?.status, 'blocked');
    const replacement = opSaveDocument(store, a.id, doc);

    assert.notEqual(replacement, firstDoc);
    assert.equal(opDocumentOf(store, a.id)?.id, replacement);
    assert.equal(opJob(store, dep)?.status, 'blocked');
    const oldIndex = opClaimJob(store, ['index'])!;

    assert.equal(oldIndex.id, first);
    opFinishJob(store, oldIndex.id, oldIndex.attempts);
    assert.equal(opJob(store, dep)?.status, 'queued');
    assert.ok(events.length > 0);
  }));
test('retry refuses a terminal job when the same work is already running', () =>
  fixture((store) => {
    const s = opCreateNote(store, 'n', 'body'),
      first = opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: s.id }
      });

    opCancelJob(store, first);
    const next = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: s.id }
    });

    opClaimJob(store, ['extract']);
    assert.notEqual(first, next);
    assert.equal(opRetryJob(store, first), false);
  }));

test('fetch dependents wait through the extraction handoff', () =>
  fixture((store) => {
    const p = opCreateProject(store, 'P'),
      session = opCreateSession(store, p.id, 'S');
    const source = opAddLink(store, p.id, 'https://example.com/lecture');
    const fetch = opEnqueueJob(store, {
      kind: 'fetch',
      target: { type: 'source', id: source.id }
    });
    const message = opPostMessage(store, {
      sessionId: session.id,
      text: 'Explain',
      attachments: [source.id]
    });
    const reply = opRequestReply(store, message.id);
    const material = opRequestMaterial(store, p.id, 'flashcards', 'Cards', [source.id]);
    const practice = opCreatePractice(store, p.id);

    assert.equal(opClaimJob(store, ['question']), null);
    opClaimJob(store, ['fetch']);
    const extract = opEnqueueJob(store, {
      kind: 'extract',
      target: { type: 'source', id: source.id }
    });

    opFinishJob(store, fetch, 1n);
    assert.equal(opClaimJob(store, ['reply', 'artifact', 'question']), null);
    opClaimJob(store, ['extract']);
    opFinishJob(store, extract, 1n);
    assert.equal(opJob(store, reply.jobId)?.status, 'queued');
    assert.equal(opJob(store, material.jobId)?.status, 'queued');
    assert.equal(opListQuestions(store, practice.id).length, 2);
    assert.ok(opClaimJob(store, ['question']));
  }));

test('an extraction handoff cannot introduce a cycle through a consumer', () =>
  fixture((store) => {
    const source = opAddLink(store, null, 'https://example.com');
    const fetch = opEnqueueJob(store, {
      kind: 'fetch',
      target: { type: 'source', id: source.id }
    });
    const consumer = opEnqueueJob(store, {
      kind: 'index',
      target: { type: 'document', id: opSaveDocument(store, source.id, emptyDocument) },
      after: [fetch]
    });

    assert.throws(() =>
      opEnqueueJob(store, {
        kind: 'extract',
        target: { type: 'source', id: source.id },
        after: [consumer]
      })
    );
    assert.equal(opListJobs(store).length, 2);
  }));
