/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Starts the private server process from STUDY_DATABASE, serves RPC, and starts      │
 * │ workflow workers. It reports the loopback URL and closes server and application          │
 * │ resources on stdin EOF or termination signals.                                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Opens App, serves RPC, starts workers, emits the endpoint JSON line, and closes        │
 * │   resources on stdin EOF or termination signals.                                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Reads STUDY_DATABASE and owns process startup and shutdown; App owns service resources   │
 * │ and serve owns the HTTP listener.                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
