import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { test } from 'node:test';

import { projectIdSchema } from '@study/contracts/ids';
import { StudyRpc } from '@study/contracts/rpc';
import { Appearance, Language } from '@study/contracts/settings';
import { sql } from '@study/db';
import * as schema from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Option, Schema } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

function failureKind(error: unknown) {
  assert.ok(error && typeof error === 'object' && 'kind' in error);

  return error.kind;
}

async function fixture() {
  const location = createTestDatabase();
  const app = await App.open({ path: location.path });
  const server = await serve(app);

  return {
    location,
    app,
    server,
    async close() {
      await server.close();
      await app.close();
      location.cleanup();
    }
  };
}

test('native HTTP RPC preserves int64 IDs, bytes, typed failures and settings', async () => {
  const f = await fixture();

  try {
    const large = Schema.decodeUnknownSync(projectIdSchema)(9007199254740993n);

    f.app.store.db.orm
      .insert(schema.projects)
      .values({ id: large, name: 'Large', created_at: 0n, updated_at: 0n })
      .run();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.server.url });

          assert.equal((yield* client['projects.projects']({ limit: 10 })).items[0]?.id, large);
          const absent = Schema.decodeUnknownSync(projectIdSchema)(9223372036854775807n);

          assert.ok(Option.isNone(yield* client['projects.findProject']({ id: absent })));
          assert.equal(
            failureKind(yield* Effect.flip(client['projects.project']({ id: absent }))),
            'not_found'
          );
          assert.equal(
            failureKind(yield* Effect.flip(client['projects.createProject']({ name: '' }))),
            'invalid_input'
          );
          const source = yield* client['sources.createSource']({
            name: 'hello.txt',
            bytes: new TextEncoder().encode('hello'),
            projectId: large
          });

          assert.equal(source.projectId, large);
          assert.ok(source.sha256 instanceof Uint8Array);
          assert.deepEqual(yield* client['sources.source']({ id: source.id }), source);
          const settings = {
            language: Language.ITALIAN,
            appearance: Appearance.LIGHT,
            zoomPercent: 125,
            onboarded: true
          };

          yield* client['settings.saveAppSettings'](settings);
          assert.deepEqual(yield* client['settings.appSettings']({}), settings);
          assert.equal(yield* client['auth.publicAccount']({}), undefined);
          assert.equal(
            yield* client['projects.setExam']({ id: large, examOn: '2028-02-29' }),
            true
          );
          assert.equal(
            failureKind(
              yield* Effect.flip(client['projects.setExam']({ id: large, examOn: '2026-02-29' }))
            ),
            'invalid_input'
          );
        })
      )
    );
    const snapshot = f.app.store.db.orm.get(sql`SELECT bytes FROM source_snapshots LIMIT 1`) as {
      bytes: Uint8Array;
    };

    assert.deepEqual(Buffer.from(snapshot.bytes), Buffer.from('hello'));
  } finally {
    await f.close();
  }
});

test('native listener enforces browser origins and exposes the RPC endpoint', async () => {
  const f = await fixture();

  try {
    for (const origin of [
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'http://localhost:5173'
    ]) {
      const response = await fetch(`${f.server.url}/rpc`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type'
        }
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
    }

    const denied = await fetch(`${f.server.url}/rpc`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
    });

    assert.equal(denied.status, 204);
    assert.equal(
      (
        await fetch(`${f.server.url}/rpc`, {
          method: 'POST',
          headers: { origin: 'https://evil.example' }
        })
      ).status,
      403
    );
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch(`${f.server.url}/api/listProjects`, { method: 'POST' })).status, 404);
  } finally {
    await f.close();
  }
});

test(
  'closing the listener terminates an incomplete request and rejects new connections',
  { timeout: 5000 },
  async () => {
    const f = await fixture();
    const endpoint = new URL(f.server.url);
    const socket = createConnection({ host: endpoint.hostname, port: Number(endpoint.port) });

    try {
      await once(socket, 'connect', { signal: AbortSignal.timeout(2000) });
      socket.resume();
      socket.write(
        `POST /rpc HTTP/1.1\r\nHost: ${endpoint.host}\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n{`
      );
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));

      socket.on('error', (error: NodeJS.ErrnoException) => assert.equal(error.code, 'ECONNRESET'));
      await f.server.close();
      await closed;
      await assert.rejects(fetch(`${f.server.url}/rpc`));
    } finally {
      socket.destroy();
      await f.close();
    }
  }
);

test('HTTP message attachments retain source identity and reject another project', async () => {
  const f = await fixture();

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.server.url });
          const one = yield* client['projects.createProject']({ name: 'One' });
          const two = yield* client['projects.createProject']({ name: 'Two' });
          const session = yield* client['conversations.createSession']({
            project: one.id,
            title: 'Notes'
          });
          const source = yield* client['sources.createSource']({
            projectId: one.id,
            name: 'notes.txt',
            bytes: new TextEncoder().encode('Physics')
          });
          const foreign = yield* client['sources.createSource']({
            projectId: two.id,
            name: 'other.txt',
            bytes: new TextEncoder().encode('Other')
          });
          const message = yield* client['conversations.postMessage']({
            sessionId: session.id,
            text: '',
            sourceIds: [source.id]
          });

          assert.equal(message.parts[0]?.sourceId, source.id);
          assert.equal(message.parts[0]?.sourceName, 'notes.txt');
          assert.equal(
            failureKind(
              yield* Effect.flip(
                client['conversations.postMessage']({
                  sessionId: session.id,
                  text: '',
                  sourceIds: [foreign.id]
                })
              )
            ),
            'invalid_input'
          );
          assert.equal(
            (yield* client['conversations.thread']({ sessionId: session.id, limit: 10 })).items
              .length,
            1
          );
        })
      )
    );
  } finally {
    await f.close();
  }
});
