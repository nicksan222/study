import { createControlledOperation } from '@study/testing';

/** Hold a real HTTP source response while the ingestion worker is reading it. */
export function openSourcePeer() {
  let reply = createControlledOperation<void, Response>(() => {
    throw new Error('No source response planned');
  });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      return reply.run(undefined, request.signal);
    }
  });

  return {
    url: new URL('/observations.txt', server.url).href,
    next(text: string, { hold = false, status = 200 } = {}) {
      reply = createControlledOperation(
        () => new Response(text, { status, headers: { 'content-type': 'text/plain' } }),
        { hold }
      );

      return reply;
    },
    async [Symbol.asyncDispose]() {
      reply.release();
      await server.stop(true);
    }
  };
}
