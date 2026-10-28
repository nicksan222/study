import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBackendTest } from '#testing/backend-test';

import { inputValidator } from './input.ts';
test('startChatgptSignIn creates fresh attempts and forwards reconsent to the real OAuth flow', async (t) => {
  const f = await createBackendTest(t);
  const one = await f.caller.auth.startChatgptSignIn({
    reconsent: false
  });

  assert.ok(one.attemptId);
  assert.equal(new URL(one.url).hostname, 'auth.openai.com');
  const two = await f.caller.auth.startChatgptSignIn({
    reconsent: true
  });

  assert.notEqual(two.attemptId, one.attemptId);
  assert.equal(new URL(two.url).searchParams.get('force_reconsent'), 'true');
  assert.equal(f.app.cancelSignIn(one.attemptId), false);
  assert.equal(f.app.cancelSignIn(two.attemptId), true);
});

test('defaults omitted and undefined reconsent to false and rejects null', async (t) => {
  const f = await createBackendTest(t);
  const omitted = await inputValidator['~standard'].validate({});
  const explicitUndefined = await inputValidator['~standard'].validate({ reconsent: undefined });

  assert.deepEqual(omitted, { value: { reconsent: false } });
  assert.deepEqual(explicitUndefined, { value: { reconsent: false } });

  const omittedCallerInput = await f.caller.auth.startChatgptSignIn({});
  const undefinedCallerInput = await f.caller.auth.startChatgptSignIn({ reconsent: undefined });

  assert.ok(omittedCallerInput.attemptId);
  assert.ok(undefinedCallerInput.attemptId);
  const invalidInput = { reconsent: false };

  Object.defineProperty(invalidInput, 'reconsent', { value: null });
  await assert.rejects(f.caller.auth.startChatgptSignIn(invalidInput), {
    code: 'BAD_REQUEST'
  });
});
