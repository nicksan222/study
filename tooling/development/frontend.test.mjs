import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontendArguments, bridgeCommand } from './frontend.mjs';
test('frontend has explicit validated ports and production snapshot mode', () => {
  assert.deepEqual(frontendArguments([]), { port: 5173, production: false });
  assert.deepEqual(frontendArguments(['--port', '1421']), { port: 1421, production: false });
  assert.deepEqual(frontendArguments(['--production', '--port', '1423']), { port: 1423, production: true });
  for (const args of [['--port', '0'], ['--port', '3.5'], ['--port', '99999'], ['x'], ['--production', '--production']]) assert.throws(() => frontendArguments(args));
});

test('fixture-only launch is independent of persistent data lock', () => {
  assert.deepEqual(bridgeCommand(['run'], true), ['cargo', ['run']]);
  const [command, args] = bridgeCommand(['run'], false);
  assert.equal(command, 'python3');
  assert.ok(args[1].endsWith('/target/desktop/data.lock'));
  assert.deepEqual(args.slice(2), ['cargo', 'run']);
});
