import { test } from '@study/testing';
import { Context, Result, Schema } from 'effect';

import { failureSchema } from '../src/errors.ts';
import { sourceIdSchema } from '../src/ids.ts';
import {
  dependency,
  EndpointPolicy,
  endpointGroup,
  liveFrameSchema,
  liveQuery,
  mutation
} from '../src/protocol.ts';

const schemas = { payload: { id: sourceIdSchema }, success: Schema.String, error: failureSchema };

test.stable('query and mutation constructors preserve native schemas and required policies', () => {
  const read = liveQuery('test.read', schemas, {
    dependencies: [dependency.sources],
    refresh: 'database'
  });
  const write = mutation('test.write', schemas, { changes: [dependency.sources] });
  const group = endpointGroup({ read, write });

  test.expect([...group.requests.keys()]).toEqual(['test.read', 'test.read.live', 'test.write']);
  test.expect(Context.get(read.rpc.annotations, EndpointPolicy)).toEqual({
    kind: 'query',
    dependencies: ['sources'],
    refresh: 'database'
  });
  test.expect(Context.get(write.rpc.annotations, EndpointPolicy)).toEqual({
    kind: 'mutation',
    changes: ['sources']
  });
  test.expect(read.successSchema).toBe(Schema.String);
  test.expect(write.rpc.errorSchema).toBe(failureSchema);
});

// This function is typechecked without executing intentionally invalid declarations.
function invalidDeclarations() {
  // @ts-expect-error native RPCs cannot bypass canonical endpoint constructors
  endpointGroup({ bypass: { rpc: mutation('typed', schemas, { changes: 'external' }).rpc } });

  // @ts-expect-error dependency declaration is mandatory
  liveQuery('missing', schemas);
  // @ts-expect-error changes declaration is mandatory
  mutation('missing', schemas);
  // @ts-expect-error queries cannot declare an empty dependency set
  liveQuery('empty', schemas, { dependencies: [], refresh: 'database' });
  // @ts-expect-error dependency keys are bounded, not arbitrary strings
  mutation('unknown', schemas, { changes: ['arbitrary'] });
  // @ts-expect-error database-free operations explicitly declare external effects
  mutation('empty', schemas, { changes: [] });
}

test.stable(
  'live queries derive a separate native stream without changing one-shot schemas',
  () => {
    const read = liveQuery('test.read', schemas, {
      dependencies: [dependency.sources],
      refresh: 'database'
    });

    test.expect(read.rpc._tag).toBe('test.read');
    test.expect(read.liveRpc._tag).toBe('test.read.live');
    test.expect(read.rpc.successSchema).toBe(Schema.String);
    test.expect(read.rpc.payloadSchema.fields.id).toBe(sourceIdSchema);
    test
      .expect(Context.get(read.liveRpc.annotations, EndpointPolicy))
      .toEqual(Context.get(read.rpc.annotations, EndpointPolicy));
  }
);

test.stable(
  'live frames preserve typed domain failures and distinguish transport heartbeats',
  () => {
    const schema = liveFrameSchema(Schema.BigInt, failureSchema);
    const codec = Schema.fromJsonString(Schema.toCodecJson(schema));
    const frames = [
      { _tag: 'Snapshot' as const, result: Result.succeed(42n) },
      {
        _tag: 'Snapshot' as const,
        result: Result.fail({ kind: 'not_found' as const, message: 'Missing', retryAfterMs: null })
      },
      { _tag: 'Heartbeat' as const },
      { _tag: 'Refreshing' as const }
    ];

    for (const frame of frames) {
      const decoded = Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(frame));

      test.expect(decoded).toEqual(frame);
    }
  }
);

void invalidDeclarations;
