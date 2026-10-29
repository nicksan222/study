import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSession as opCreateSession } from '#server/procedures/conversations/operations/create-session';
import { deleteSession as opDeleteSession } from '#server/procedures/conversations/operations/delete-session';
import { editMessage as opEditMessage } from '#server/procedures/conversations/operations/edit-message';
import { postMessage as opPostMessage } from '#server/procedures/conversations/operations/post-message';
import { replaceWithGeneratedTitle as opReplaceWithGeneratedTitle } from '#server/procedures/conversations/operations/regenerate-title';
import { claimJob as opClaimJob } from '#server/procedures/jobs/worker';
import { finishMaterial as opFinishMaterial } from '#server/procedures/material/finish-material';
import { requestMaterial as opRequestMaterial } from '#server/procedures/material/operations/update-material';
import { finishQuestion as opFinishQuestion } from '#server/procedures/practice/finish-question';
import { listQuestions as opListQuestions } from '#server/procedures/practice/operations/practice';
import { createPractice as opCreatePractice } from '#server/procedures/practice/operations/project-practice';
import { createProject as opCreateProject } from '#server/procedures/projects/operations/create-project';
import { deleteProject as opDeleteProject } from '#server/procedures/projects/operations/delete-project';
import { createNote as opCreateNote } from '#server/procedures/sources/operations/create-note';
import { saveDocument as opSaveDocument } from '#server/procedures/sources/operations/source-document';
import { replacePassages as opReplacePassages } from '#server/procedures/system/index';
import { search as opSearch } from '#server/procedures/system/operations/search';
import { ServerContext } from '#server/runtime/context';
import { createServerTest } from '#testing/server-test';

test('lexical FTS searches accented passages and active messages with filters and cascades', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'Biology'),
      other = opCreateProject(store, 'History'),
      s = opCreateSession(store, p.id, 'S'),
      src = opCreateNote(store, 'cellules', 'test', p.id);
    const doc = opSaveDocument(store, src.id, {
      blocks: [
        {
          kind: 'paragraph',
          text: 'città mitochondria',
          anchor: { type: 'page', page: 3 }
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
    });

    opReplacePassages(store, doc, [
      {
        firstBlock: 0,
        lastBlock: 0,
        anchor: { type: 'page', page: 3 },
        text: 'città mitochondria'
      }
    ]);
    const msg = opPostMessage(store, {
      sessionId: s.id,
      text: 'mitochondria convert energy'
    });

    opPostMessage(store, {
      sessionId: opCreateSession(store, other.id, 'other').id,
      text: 'mitochondria history'
    });
    assert.equal(opSearch(store, 'citta', { projectId: p.id })[0].target.type, 'passage');
    const hits = opSearch(store, 'mitochondria', { projectId: p.id });

    assert.deepEqual(new Set(hits.map((h) => h.target.type)), new Set(['passage', 'message']));
    opEditMessage(store, msg.id, 'new subject');
    assert.equal(
      opSearch(store, 'mitochondria', { projectId: p.id, kinds: ['message'] }).length,
      0
    );
    opDeleteProject(store, p.id);
    assert.equal(opSearch(store, 'citta', {}).length, 0);
  } finally {
    store.close();
  }
});
test('catalog FTS finds project source material and question text', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'Anatomy'),
      src = opCreateNote(store, 'unusual-title', 'text', p.id);

    assert.equal(opSearch(store, 'anatomy', { kinds: ['project'] })[0].target.type, 'project');
    assert.equal(opSearch(store, 'unusual', { kinds: ['source'] })[0].target.id, src.id);
  } finally {
    store.close();
  }
});
test('FTS tracks material and question content and project deletion', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'Biology'),
      a = opRequestMaterial(store, p.id, 'flashcards', 'Summary', []);

    opClaimJob(store, ['artifact']);
    opFinishMaterial(
      store,
      a.artifactId,
      a.jobId,
      1n,
      {
        type: 'flashcards',
        cards: [{ front: 'osmosis', back: 'water', cites: [] }]
      },
      []
    );
    const practice = opCreatePractice(store, p.id),
      question = opListQuestions(store, practice.id)[0];
    const claimed = opClaimJob(store, ['question'])!;

    opFinishQuestion(
      store,
      question.id,
      claimed.id,
      claimed.attempts,
      {
        type: 'choice',
        question: 'Define osmosis',
        choices: ['water', 'air'],
        answer: 0,
        explanation: 'water',
        cites: []
      },
      'osmosis gist',
      []
    );
    assert.deepEqual(
      new Set(opSearch(store, 'osmosis', { projectId: p.id }).map((h) => h.target.type)),
      new Set(['material', 'question'])
    );
    opDeleteProject(store, p.id);
    assert.equal(opSearch(store, 'osmosis', {}).length, 0);
  } finally {
    store.close();
  }
});
test('invalid passage ranges roll back and preserve the previous index', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P'),
      src = opCreateNote(store, 'N', 'body', p.id),
      doc = opSaveDocument(store, src.id, {
        blocks: [
          {
            kind: 'paragraph',
            text: 'mitochondria',
            anchor: { type: 'page', page: 1 }
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
      });

    opReplacePassages(store, doc, [
      {
        firstBlock: 0,
        lastBlock: 0,
        anchor: { type: 'page', page: 1 },
        text: 'mitochondria'
      }
    ]);
    assert.throws(() =>
      opReplacePassages(store, doc, [
        {
          firstBlock: 0,
          lastBlock: 2,
          anchor: { type: 'page', page: 1 },
          text: 'invalid'
        }
      ])
    );
    assert.equal(opSearch(store, 'mitochondria', { projectId: p.id }).length, 1);
  } finally {
    store.close();
  }
});

test('session titles are searchable and follow renames and deletion', (t) => {
  const testDatabase = createServerTest(t, { app: false });
  const store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const p = opCreateProject(store, 'P');
    const session = opCreateSession(store, p.id, 'Photosynthesis');

    assert.equal(opSearch(store, 'photosynthesis')[0]?.target.id, session.id);
    assert.equal(opSearch(store, 'photosynthesis')[0]?.target.type, 'session');
    opReplaceWithGeneratedTitle(store, session.id, 'Respiration');
    assert.equal(opSearch(store, 'photosynthesis').length, 0);
    assert.equal(opSearch(store, 'respiration', { projectId: p.id })[0]?.target.id, session.id);
    opDeleteSession(store, session.id);
    assert.equal(opSearch(store, 'respiration').length, 0);
  } finally {
    store.close();
  }
});

test('partial search matches token prefixes and fragments within names', (t) => {
  const testDatabase = createServerTest(t, { app: false });
  const store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  try {
    const project = opCreateProject(store, 'Photosynthesis');
    const session = opCreateSession(store, project.id, 'Photosynthesis lecture');
    const source = opCreateNote(store, 'Photosynthesis notes', 'Photosynthesis', project.id);

    opPostMessage(store, {
      sessionId: session.id,
      text: 'Photosynthesis powers plants'
    });
    const document = opSaveDocument(store, source.id, {
      blocks: [
        {
          kind: 'paragraph',
          text: 'Photosynthesis',
          anchor: { type: 'page', page: 1 }
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
    });

    opReplacePassages(store, document, [
      {
        firstBlock: 0,
        lastBlock: 0,
        text: 'Photosynthesis',
        anchor: { type: 'page', page: 1 }
      }
    ]);
    const prefix = opSearch(store, 'Photo');

    assert.deepEqual(
      new Set(prefix.map((hit) => hit.target.type)),
      new Set(['project', 'session', 'source', 'message', 'passage'])
    );
    assert.equal(prefix.filter((hit) => hit.target.type === 'session').length, 1);
    assert.deepEqual(
      new Set(opSearch(store, 'synth').map((hit) => hit.target.type)),
      new Set(['project', 'session', 'source'])
    );
    assert.equal(
      opSearch(store, 'synth', {
        projectId: (project.id + 1n) as typeof project.id
      }).length,
      0
    );
    opCreateSession(store, project.id, 'Photo_100% complete');
    assert.equal(opSearch(store, 'Photo_100%', { kinds: ['session'] }).length, 1);
  } finally {
    store.close();
  }
});
