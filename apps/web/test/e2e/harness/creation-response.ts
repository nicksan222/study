import { noteSchema } from '@study/contracts/notes/schemas';
import { Schema } from 'effect';
import { RpcSerialization } from 'effect/rpc';
import type { ProxyOptions } from 'vite-plus';

const request = Schema.Struct({
  _tag: Schema.Literal('Request'),
  id: Schema.Union([Schema.String, Schema.Number]),
  tag: Schema.Literal('notes.createUntitledNote')
});
const success = Schema.Struct({
  _tag: Schema.Literal('Exit'),
  requestId: Schema.Union([Schema.String, Schema.Number]),
  exit: Schema.Struct({ _tag: Schema.Literal('Success'), value: Schema.Unknown })
});
const decodeNote = Schema.decodeUnknownSync(Schema.toCodecJson(noteSchema));

/** Uses the production codec: an unterminated or failed Exit cannot prove commit. */
export class CreationFrames {
  private readonly requests = RpcSerialization.ndjson.makeUnsafe();
  private readonly responses = RpcSerialization.ndjson.makeUnsafe();
  id: string | number | undefined;

  request(chunk: Uint8Array): void {
    for (const frame of this.requests.decode(chunk)) {
      if (this.id === undefined && Schema.is(request)(frame)) this.id = frame.id;
    }
  }

  response(chunk: Uint8Array) {
    for (const frame of this.responses.decode(chunk)) {
      if (Schema.is(success)(frame) && frame.requestId === this.id)
        return { requestId: frame.requestId, note: decodeNote(frame.exit.value) };
    }
  }
}

type Receipt = NonNullable<ReturnType<CreationFrames['response']>>;

/** One owned creation loss; callers can observe commit before explicitly losing receipt. */
export function creationResponse() {
  let armed = false;
  let consumed = false;
  let settled = false;
  let release: (() => Promise<void>) | undefined;
  let resolveHeld!: (receipt: Receipt) => void;
  let rejectHeld!: (error: Error) => void;
  const held = new Promise<Receipt>((resolve, reject) => {
    resolveHeld = resolve;
    rejectHeld = reject;
  });

  // Teardown may reject before a journey starts waiting.
  void held.catch(() => undefined);
  const exchanges = new WeakMap<object, CreationFrames>();
  const active = new Set<() => Promise<void>>();
  const configure: NonNullable<ProxyOptions['configure']> = (proxy) => {
    proxy.on('proxyReq', (_outgoing, incoming) => {
      if (!armed || consumed) return;
      const frames = new CreationFrames();

      exchanges.set(incoming, frames);
      incoming.on('data', (chunk: Buffer) => {
        try {
          frames.request(chunk);
        } catch (error) {
          settled = true;
          rejectHeld(new Error('Invalid creation request framing', { cause: error }));
        }
      });
    });
    proxy.on('proxyRes', (upstream, incoming, downstream) => {
      if (!('writeHead' in downstream)) return;
      const frames = exchanges.get(incoming);

      if (!frames || frames.id === undefined || consumed) {
        downstream.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(downstream);
        return;
      }

      consumed = true;
      const chunks: Buffer[] = [];
      let holding = false;
      const closed = Promise.all([
        new Promise<void>((resolve) => downstream.once('close', resolve)),
        new Promise<void>((resolve) => upstream.once('close', resolve))
      ]);
      const close = async () => {
        upstream.destroy();
        downstream.destroy();
        await closed;
        active.delete(close);
      };

      active.add(close);
      downstream.once('close', () => {
        upstream.destroy();
        if (!holding && !settled) {
          settled = true;
          rejectHeld(new Error('Creation client closed before receipt'));
        }
      });
      void closed.then(() => active.delete(close));
      upstream.on('aborted', () => {
        settled = true;
        rejectHeld(new Error('Creation response aborted before receipt'));
        downstream.destroy();
      });
      upstream.on('error', (error) => {
        settled = true;
        rejectHeld(error);
        downstream.destroy();
      });
      upstream.on('data', (chunk: Buffer) => {
        if (holding) return;
        chunks.push(chunk);
        try {
          const receipt = frames.response(chunk);

          if (!receipt) return;
          holding = true;
          chunks.length = 0;
          release = close;
          settled = true;
          resolveHeld(receipt);
        } catch (error) {
          settled = true;
          rejectHeld(new Error('Invalid creation response framing', { cause: error }));
          upstream.destroy();
          downstream.destroy();
        }
      });
      upstream.on('end', () => {
        if (holding) return;
        settled = true;
        rejectHeld(new Error('Creation ended without its successful Exit'));
        downstream.writeHead(upstream.statusCode ?? 502, upstream.headers);
        for (const chunk of chunks) downstream.write(chunk);
        downstream.end();
      });
    });
  };

  return {
    proxy(options: ProxyOptions): ProxyOptions {
      return {
        ...options,
        selfHandleResponse: true,
        configure(proxy, config) {
          options.configure?.(proxy, config);
          configure(proxy, config);
        }
      };
    },
    arm() {
      if (armed) throw new Error('Creation response loss is one-shot');
      armed = true;
      return {
        held,
        async drop() {
          await held;
          await release!();
        }
      };
    },
    async close() {
      if (!settled) rejectHeld(new Error('Creation response owner closed before commit'));
      await Promise.all([...active].map((close) => close()));
    }
  };
}
