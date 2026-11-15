import { testStable, withinTestDeadline } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { connectDevTools } from './devtools.ts';

testStable('a DevTools disconnect rejects pending and future evaluations', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;

      return new Response('Not found', { status: 404 });
    },
    websocket: {
      message(socket) {
        socket.close();
      }
    }
  });

  try {
    const connection = await connectDevTools(`ws://127.0.0.1:${server.port}`);
    const first = connection.evaluate('pending');
    const second = connection.evaluate('also pending');

    await expect(withinTestDeadline(Promise.all([first, second]))).rejects.toThrow(
      'DevTools connection closed'
    );
    await expect(first).rejects.toThrow('DevTools connection closed');
    await expect(second).rejects.toThrow('DevTools connection closed');
    await expect(connection.evaluate('after close')).rejects.toThrow('DevTools connection closed');
    connection.close();
  } finally {
    await server.stop(true);
  }
});
