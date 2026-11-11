/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies the native HTTP RPC endpoint preserves int64 IDs, bytes, settings, and    │
 * │ typed failures, and enforces browser origins. The server uses the shared application     │
 * │ database.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: native HTTP RPC preserves int64 IDs, bytes, typed failures and settings;      │
 * │   native listener enforces browser origins and exposes the RPC endpoint.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { projectIdSchema } from '@study/contracts/ids';
import { StudyRpc } from '@study/contracts/rpc';
import { Appearance, Language } from '@study/contracts/settings';
import { sql } from '@study/db';
import * as schema from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Option, Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { App, serve } from '#server/runtime/index';

function failureKind(error: unknown) {
  assert.ok(error && typeof error === 'object' && 'kind' in error);

  return error.kind;
}

async function fixture() {
  const location = await createTestDatabase();
  const app = await App.open({ path: location.path });
  const server = await serve(app);

  return {
    location,
    app,
    server,
    async close() {
      await server.close();
      await app.close();
      await location.cleanup();
    }
  };
}

testStable('native HTTP RPC preserves int64 IDs, bytes, typed failures and settings', async () => {
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

          assert.strictEqual(
            (yield* client['projects.projects']({ limit: 10 })).items[0]?.id,
            large
          );
          const absent = Schema.decodeUnknownSync(projectIdSchema)(9223372036854775807n);

          assert.ok(Option.isNone(yield* client['projects.findProject']({ id: absent })));
          assert.ok(
            failureKind(yield* Effect.flip(client['projects.project']({ id: absent }))) ===
              'not_found'
          );
          assert.ok(
            failureKind(yield* Effect.flip(client['projects.createProject']({ name: '' }))) ===
              'invalid_input'
          );
          const source = yield* client['sources.createSource']({
            name: 'hello.txt',
            bytes: new TextEncoder().encode('hello'),
            projectId: large
          });

          assert.strictEqual(source.projectId, large);
          assert.ok(source.sha256 instanceof Uint8Array);
          expect(yield* client['sources.source']({ id: source.id })).toStrictEqual(source);
          const settings = {
            language: Language.ITALIAN,
            appearance: Appearance.LIGHT,
            zoomPercent: 125,
            onboarded: true
          };

          yield* client['settings.saveAppSettings'](settings);
          expect(yield* client['settings.appSettings']({})).toStrictEqual(settings);
          assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
          assert.strictEqual(
            yield* client['projects.setExam']({ id: large, examOn: '2028-02-29' }),
            true
          );
          assert.ok(
            failureKind(
              yield* Effect.flip(client['projects.setExam']({ id: large, examOn: '2026-02-29' }))
            ) === 'invalid_input'
          );
        })
      )
    );
    const snapshot = f.app.store.db.orm.get(sql`SELECT bytes FROM source_snapshots LIMIT 1`) as {
      bytes: Uint8Array;
    };

    expect(snapshot.bytes).toStrictEqual(new TextEncoder().encode('hello'));
  } finally {
    await f.close();
  }
});

testStable('native listener enforces browser origins and exposes the RPC endpoint', async () => {
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

      assert.strictEqual(response.status, 204);
      assert.strictEqual(response.headers.get('access-control-allow-origin'), origin);
    }

    const denied = await fetch(`${f.server.url}/rpc`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
    });

    assert.strictEqual(denied.status, 204);
    assert.strictEqual(
      (
        await fetch(`${f.server.url}/rpc`, {
          method: 'POST',
          headers: { origin: 'https://evil.example' }
        })
      ).status,
      403
    );
    assert.ok(denied.headers.get('access-control-allow-origin') === null);
    assert.strictEqual(
      (await fetch(`${f.server.url}/api/listProjects`, { method: 'POST' })).status,
      404
    );
  } finally {
    await f.close();
  }
});

testStable(
  'closing the listener terminates an incomplete request and rejects new connections',
  { timeout: 5000 },
  async () => {
    const f = await fixture();
    const endpoint = new URL(f.server.url);
    let onClose!: () => void;
    const closed = new Promise<void>((resolve) => {
      onClose = resolve;
    });
    const socket = await Bun.connect({
      hostname: endpoint.hostname,
      port: Number(endpoint.port),
      socket: {
        data() {},
        close() {
          onClose();
        },
        error(_socket, error) {
          assert.ok('code' in error && error.code === 'ECONNRESET');
        }
      }
    });

    try {
      socket.write(
        `POST /rpc HTTP/1.1\r\nHost: ${endpoint.host}\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n{`
      );
      await f.server.close();
      await Promise.race([
        closed,
        Bun.sleep(2000).then(() => {
          throw new Error('Socket did not close');
        })
      ]);
      await expect(fetch(`${f.server.url}/rpc`)).rejects.toSatisfy(() => true);
    } finally {
      socket.end();
      await f.close();
    }
  }
);

testStable(
  'HTTP message attachments retain explicit source identity across collections',
  async () => {
    const f = await fixture();

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: f.server.url });
            const one = yield* client['projects.createProject']({ name: 'One' });
            const two = yield* client['projects.createProject']({ name: 'Two' });
            const note = yield* client['notes.createNote']({
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
            const message = yield* client['notes.postMessage']({
              noteId: note.id,
              text: '',
              sourceIds: [source.id]
            });

            assert.strictEqual(message.parts[0]?.sourceId, source.id);
            assert.ok(message.parts[0]?.sourceName === 'notes.txt');
            const shared = yield* client['notes.postMessage']({
              noteId: note.id,
              text: '',
              sourceIds: [foreign.id]
            });

            assert.strictEqual(shared.parts[0]?.sourceId, foreign.id);
            assert.strictEqual(
              (yield* client['notes.thread']({ noteId: note.id, limit: 10 })).items.length,
              2
            );
          })
        )
      );
    } finally {
      await f.close();
    }
  }
);
