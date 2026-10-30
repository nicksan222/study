import { App, serve } from './index.ts';

const path = process.env.STUDY_DATABASE;

if (!path) throw new Error('STUDY_DATABASE is required');

const app = await App.open({ path });

let server: Awaited<ReturnType<typeof serve>>;

try {
  server = await serve(app);
  await app.workers.start();
} catch (error) {
  await app.close();

  throw error;
}

process.stdout.write(`${JSON.stringify({ url: server.url })}\n`);

let closing: Promise<void> | undefined;

const close = () =>
  (closing ??= (async () => {
    await server.close();
    await app.close();
    process.stdin.destroy();
  })());

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void close().catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
  });

process.stdin.resume();
process.stdin.once('end', () => {
  void close().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
});
