/** Local DevTools transport that settles outstanding evaluations on disconnect. */
export async function connectDevTools(url: string) {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('close', () => reject(new Error('DevTools connection closed')), {
      once: true
    });
    socket.addEventListener('error', () => reject(new Error('DevTools connection failed')), {
      once: true
    });
  });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  socket.addEventListener('message', (message) => {
    const response = JSON.parse(String(message.data));
    const request = pending.get(response.id);

    if (!request) return;

    pending.delete(response.id);

    if (response.error || response.result?.exceptionDetails)
      request.reject(new Error(JSON.stringify(response)));
    else request.resolve(response.result?.result?.value);
  });

  const disconnected = () => {
    for (const request of pending.values()) request.reject(new Error('DevTools connection closed'));

    pending.clear();
  };

  socket.addEventListener('close', disconnected);
  socket.addEventListener('error', disconnected);

  return {
    evaluate: (expression: string) =>
      new Promise<unknown>((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
          reject(new Error('DevTools connection closed'));

          return;
        }

        const id = ++sequence;

        pending.set(id, { resolve, reject });
        socket.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true }
          })
        );
      }),
    close: () => socket.close()
  };
}
