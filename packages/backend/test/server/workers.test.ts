import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createStudyClient } from '@study/backend/node';
import { sql } from 'drizzle-orm';

import { postMessage } from '#backend/procedures/conversations/post-message';
import { job as opJob } from '#backend/procedures/jobs/job';
import { listJobs as opListJobs } from '#backend/procedures/jobs/job-overviews';
import { enqueueJob } from '#backend/procedures/jobs/worker';
import { loadPreferences as opLoadPreferences } from '#backend/procedures/settings/preferences';
import { sourceBytes } from '#backend/procedures/sources/source';
import { source as opSource } from '#backend/procedures/sources/source';
import { search as opSearch } from '#backend/procedures/system/search';
import { BackendContext } from '#backend/runtime/context';
import { serve } from '#backend/runtime/server';
import { App } from '#backend/runtime/service';

function changed(app: App, predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for persisted job state'));
    }, 2000);
    const unsubscribe = app.subscribe(() => {
      if (predicate()) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });

    if (predicate()) {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });
}

test('workers read and index sources, persist corrections, and leave AI jobs waiting for sign-in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-workers-'));
  const path = join(dir, 'db');
  const app = await App.open({ path });
  const server = await serve(app);
  const client = createStudyClient({
    baseUrl: server.url
  });

  try {
    const project = await client.projects.createProject.mutate({
      name: 'Physics'
    });
    const source = await client.sources.createNote.mutate({
      project: project.id,
      title: 'Gravity',
      text: 'Gravity attracts masses.'
    });

    await client.system.startWorkers.mutate({});
    await changed(app, () =>
      opListJobs(app.store).some((j) => j.kind === 'index' && j.status === 'succeeded')
    );
    const document = (await client.sources.sourceDocument.query({ id: source.id })).value!;

    assert.equal(document.blocks[0]?.text, 'Gravity attracts masses.');
    const result = await client.system.search.query({
      query: 'attracts',
      project: project.id,
      limit: 10
    });

    assert.equal(
      result.hits.some((h) => h.target.type === 'source' && h.target.sourceId === source.id),
      true
    );
    assert.equal(
      (
        await client.sources.correctBlock.mutate({
          id: source.id,
          documentId: document.id,
          ordinal: 0,
          before: document.blocks[0]!.text,
          after: 'Gravity attracts matter.'
        })
      ).value,
      true
    );
    await changed(app, () =>
      opListJobs(app.store)
        .filter((j) => j.kind === 'index')
        .every((j) => j.status === 'succeeded')
    );
    assert.equal(
      (
        await client.system.search.query({
          query: 'matter',
          project: project.id,
          limit: 10
        })
      ).hits.length > 0,
      true
    );
    const session = await client.conversations.createSession.mutate({
      project: project.id,
      title: 'Notes'
    });

    await client.conversations.postMessage.mutate({
      place: { type: 'timeline', id: session.id },
      text: '@study Explain gravity'
    });
    await changed(app, () =>
      opListJobs(app.store).some((j) => j.kind === 'reply' && j.status === 'waiting')
    );
    const job = opListJobs(app.store).find((j) => j.kind === 'reply')!;

    assert.equal(job.errorKind, 'auth');
    assert.equal(app.signInStatus().signedIn, false);
    assert.deepEqual(opLoadPreferences(app.store, 'private.chatgpt'), {});
    await app.workers.stop();
    const reopened = BackendContext.open(path);

    try {
      const persisted = opJob(reopened, job.id)!;

      assert.equal(persisted.status, 'waiting');
      assert.equal(persisted.errorKind, 'auth');
      assert.equal(persisted.attempts, 1n);
      assert.deepEqual(opLoadPreferences(reopened, 'private.chatgpt'), {});
      assert.equal(opSearch(reopened, 'matter', { limit: 10 }).length > 0, true);
    } finally {
      reopened.close();
    }

    assert.equal((await client.jobs.cancelJob.mutate({ id: job.id })).value, true);
    assert.equal((await client.jobs.job.query({ id: job.id })).value?.status, 'cancelled');
  } finally {
    await server.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shutdown aborts actual HTTP page fetching, closes its socket and requeues durable work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-stop-'));
  const path = join(dir, 'db');
  // This server deliberately holds the response open until the real fetch aborts.
  const page = createServer();
  const sockets = new Set<Socket>();

  page.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const listening = once(page, 'listening');

  page.listen(0, '127.0.0.1');
  await listening;
  const address = page.address();

  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/notes`;
  const app = await App.open({ path });
  const server = await serve(app);
  const client = createStudyClient({ baseUrl: server.url });

  try {
    await client.sources.addLink.mutate({ url });
    const request = once(page, 'request', {
      signal: AbortSignal.timeout(5000)
    });

    await client.system.startWorkers.mutate({});
    const [incoming, response] = await request;

    assert.equal(incoming.url, '/notes');
    assert.equal(incoming.method, 'GET');
    assert.equal(response.writableEnded, false);
    const disconnected = once(incoming.socket, 'close', {
      signal: AbortSignal.timeout(5000)
    });
    const active = opListJobs(app.store).find((job) => job.kind === 'fetch')!;

    assert.equal(active.status, 'running');
    assert.equal(active.attempts, 1n);
    await app.workers.stop();
    await disconnected;
    assert.equal(incoming.socket.destroyed, true);
    assert.equal(response.writableEnded, false);
    assert.equal(app.workers.started, false);
    const queued = opJob(app.store, active.id)!;

    assert.equal(queued.status, 'queued');
    assert.equal(queued.attempts, 1n);
    assert.equal(
      opListJobs(app.store).some((job) => job.kind === 'extract'),
      false
    );
    const reopened = BackendContext.open(path);

    try {
      assert.equal(opJob(reopened, active.id)?.status, 'queued');
      assert.equal(opJob(reopened, active.id)?.attempts, 1n);
      assert.equal(active.target.type, 'source');

      if (active.target.type === 'source')
        assert.equal(opSource(reopened, active.target.id)?.uri, url);
    } finally {
      reopened.close();
    }
  } finally {
    try {
      await server.close();
      await app.close();
    } finally {
      const closed = new Promise<void>((resolve, reject) => {
        page.close((error) => (error ? reject(error) : resolve()));
      });

      page.closeAllConnections();

      for (const socket of sockets) socket.destroy();

      await closed;
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('published link fetch hands durable consumers to the fetched extraction across restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-fetch-handoff-'));
  const path = join(dir, 'db');
  const page = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body><p>Snapshot gravity evidence.</p></body></html>');
  });

  page.listen(0, '127.0.0.1');
  await once(page, 'listening');
  const address = page.address();

  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/article`;
  let app = await App.open({ path });
  let server = await serve(app);
  let client = createStudyClient({ baseUrl: server.url });
  let unsubscribe = () => {};

  try {
    const project = await client.projects.createProject.mutate({ name: 'Fetch' });
    const source = await client.sources.addLink.mutate({ project: project.id, url });
    const session = await client.conversations.createSession.mutate({
      project: project.id,
      title: 'Consumer'
    });

    postMessage(app.store, {
      sessionId: session.id,
      text: 'Explain gravity',
      attachments: [source.id]
    });
    const fetchJob = opListJobs(app.store).find((job) => job.kind === 'fetch')!;
    const consumer = enqueueJob(app.store, {
      kind: 'title',
      target: { type: 'session', id: session.id },
      after: [fetchJob.id]
    });
    let stopping: Promise<void> | undefined;

    unsubscribe = app.subscribe(() => {
      if (opJob(app.store, fetchJob.id)?.status === 'succeeded' && !stopping)
        stopping = app.workers.stop();
    });
    app.workers.start();
    await changed(app, () => opJob(app.store, fetchJob.id)?.status === 'succeeded');
    await stopping;
    unsubscribe();
    const extract = opListJobs(app.store).find((job) => job.kind === 'extract')!;

    assert.ok(extract);
    assert.equal(extract.target.type, 'source');

    if (extract.target.type !== 'source') throw new Error('Expected extraction source');

    assert.notEqual(extract.target.id, source.id);
    assert.equal(Buffer.from(sourceBytes(app.store, source.id)!).toString(), url);
    assert.ok(
      Buffer.from(sourceBytes(app.store, extract.target.id)!)
        .toString()
        .includes('Snapshot gravity evidence')
    );
    const reopened = BackendContext.open(path);

    try {
      assert.equal(opJob(reopened, consumer)?.status, 'blocked');
      assert.equal(opJob(reopened, consumer)?.attempts, 0n);
      assert.ok(
        reopened.db.orm.get(
          sql`SELECT 1 FROM job_deps WHERE job_id=${extract.id} AND depends_on=${fetchJob.id}`
        )
      );
      assert.ok(
        reopened.db.orm.get(
          sql`SELECT 1 FROM job_deps WHERE job_id=${consumer} AND depends_on=${extract.id}`
        )
      );
    } finally {
      reopened.close();
    }

    await server.close();
    await app.close();
    app = await App.open({ path });
    server = await serve(app);
    client = createStudyClient({ baseUrl: server.url });
    app.workers.start();
    await changed(app, () => opJob(app.store, consumer)?.status === 'waiting');
    assert.equal(opJob(app.store, extract.id)?.status, 'succeeded');
    assert.equal(opJob(app.store, consumer)?.errorKind, 'auth');
    const found = (await client.sources.sourceDocument.query({ id: source.id })).value;

    assert.ok(found?.blocks.some((block) => block.text.includes('Snapshot gravity evidence')));
  } finally {
    unsubscribe();
    await server.close();
    await app.close();
    await new Promise<void>((resolve, reject) =>
      page.close((error) => (error ? reject(error) : resolve()))
    );
    rmSync(dir, { recursive: true, force: true });
  }
});
