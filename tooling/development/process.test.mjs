import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { spawnOwned, stopOwned, waitReady } from './process.mjs';

test('owned process stops and is reaped', async () => {
  const child = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await once(child, 'spawn');
  await stopOwned(child);
  assert.ok(child.exitCode !== null || child.signalCode);
  await stopOwned(child);
});

test('readiness rejects early process exit', async () => {
  const child = spawnOwned(process.execPath, ['-e', 'process.exit(7)']);
  await assert.rejects(waitReady(child, 'http://127.0.0.1:1', 5000), /exited/);
  await stopOwned(child);
});

test('readiness is bounded', async () => {
  const child = spawnOwned(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  try {
    await assert.rejects(waitReady(child, 'http://127.0.0.1:1', 100), /timed out/);
  } finally {
    await stopOwned(child);
  }
});

test('teardown also stops descendants after the command exits first', { skip: process.platform === 'win32' }, async () => {
  const { readFileSync } = await import('node:fs');
  const { setTimeout: delay } = await import('node:timers/promises');
  const parent = spawnOwned(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(child.pid);
    setTimeout(() => process.exit(0), 20);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  parent.stdout.on('data', bytes => { output += bytes; });
  await once(parent, 'exit');
  const descendant = Number(output.trim());
  assert.ok(descendant > 1);
  const running = () => {
    try { return readFileSync(`/proc/${descendant}/stat`, 'utf8').split(' ')[2] !== 'Z'; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  try {
    assert.ok(running());
    await stopOwned(parent);
    for (let attempt = 0; attempt < 20 && running(); attempt++) await delay(50);
    assert.equal(running(), false);
  } finally {
    if (running()) process.kill(descendant, 'SIGKILL');
  }
});
