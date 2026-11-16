import { projectIdSchema } from '@study/contracts';
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
import { Appearance, Language } from '@study/contracts';
import { sql } from '@study/db';
import * as schema from '@study/db';
import { test } from '@study/testing';
import { Effect, Option, Schema } from 'effect';

function failureKind(error: unknown) {
  test.assert.ok(error && typeof error === 'object' && 'kind' in error);

  return error.kind;
}

test.stable(
  'native HTTP RPC preserves int64 IDs, bytes, typed failures and settings',
  async ({ rpc }) => {
    const large = Schema.decodeUnknownSync(projectIdSchema)(9007199254740993n);

    rpc.app.store.db.orm
      .insert(schema.projects)
      .values({ id: large, name: 'Large', created_at: 0n, updated_at: 0n })
      .run();
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;

        test.assert.strictEqual(
          (yield* client['projects.projects']({ limit: 10 })).items[0]?.id,
          large
        );
        const absent = Schema.decodeUnknownSync(projectIdSchema)(9223372036854775807n);

        test.assert.ok(Option.isNone(yield* client['projects.findProject']({ id: absent })));
        test.assert.ok(
          failureKind(yield* Effect.flip(client['projects.project']({ id: absent }))) ===
            'not_found'
        );
        test.assert.ok(
          failureKind(yield* Effect.flip(client['projects.createProject']({ name: '' }))) ===
            'invalid_input'
        );
        const source = yield* client['sources.createSource']({
          name: 'hello.txt',
          bytes: new TextEncoder().encode('hello'),
          projectId: large
        });

        test.assert.strictEqual(source.projectId, large);
        test.assert.ok(source.sha256 instanceof Uint8Array);
        test.expect(yield* client['sources.source']({ id: source.id })).toStrictEqual(source);
        const settings = {
          language: Language.ITALIAN,
          appearance: Appearance.LIGHT,
          zoomPercent: 125,
          onboarded: true
        };

        yield* client['settings.saveAppSettings'](settings);
        test.expect(yield* client['settings.appSettings']({})).toStrictEqual(settings);
        test.assert.strictEqual(yield* client['auth.publicAccount']({}), undefined);
        test.assert.strictEqual(
          yield* client['projects.setExam']({ id: large, examOn: '2028-02-29' }),
          true
        );
        test.assert.ok(
          failureKind(
            yield* Effect.flip(client['projects.setExam']({ id: large, examOn: '2026-02-29' }))
          ) === 'invalid_input'
        );
      })
    );
    const snapshot = rpc.app.store.db.orm.get(sql`SELECT bytes FROM source_snapshots LIMIT 1`) as {
      bytes: Uint8Array;
    };

    test.expect(snapshot.bytes).toStrictEqual(new TextEncoder().encode('hello'));
  }
);

test.stable(
  'native listener enforces browser origins and exposes the RPC endpoint',
  async ({ rpc }) => {
    for (const origin of [
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'http://localhost:5173'
    ]) {
      const response = await fetch(`${rpc.server.url}/rpc`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type'
        }
      });

      test.assert.strictEqual(response.status, 204);
      test.assert.strictEqual(response.headers.get('access-control-allow-origin'), origin);
    }

    const denied = await fetch(`${rpc.server.url}/rpc`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
    });

    test.assert.strictEqual(denied.status, 204);
    test.assert.strictEqual(
      (
        await fetch(`${rpc.server.url}/rpc`, {
          method: 'POST',
          headers: { origin: 'https://evil.example' }
        })
      ).status,
      403
    );
    test.assert.ok(denied.headers.get('access-control-allow-origin') === null);
    test.assert.strictEqual(
      (await fetch(`${rpc.server.url}/api/listProjects`, { method: 'POST' })).status,
      404
    );
  }
);

test.stable(
  'closing the listener terminates an incomplete request and rejects new connections',
  { timeout: 5000 },
  async ({ rpc }) => {
    const endpoint = new URL(rpc.server.url);
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
          test.assert.ok('code' in error && error.code === 'ECONNRESET');
        }
      }
    });

    try {
      socket.write(
        `POST /rpc HTTP/1.1\r\nHost: ${endpoint.host}\r\nContent-Type: application/json\r\nContent-Length: 1000000\r\n\r\n{`
      );
      await rpc.server.close();
      await test.withinTestDeadline(closed);
      await test.expect(fetch(`${rpc.server.url}/rpc`)).rejects.toSatisfy(() => true);
    } finally {
      socket.end();
    }
  }
);

test.stable(
  'HTTP message attachments retain explicit source identity across collections',
  async ({ rpc }) => {
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
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

        test.assert.strictEqual(message.parts[0]?.sourceId, source.id);
        test.assert.ok(message.parts[0]?.sourceName === 'notes.txt');
        const shared = yield* client['notes.postMessage']({
          noteId: note.id,
          text: '',
          sourceIds: [foreign.id]
        });

        test.assert.strictEqual(shared.parts[0]?.sourceId, foreign.id);
        test.assert.strictEqual(
          (yield* client['notes.thread']({ noteId: note.id, limit: 10 })).items.length,
          2
        );
      })
    );
  }
);
