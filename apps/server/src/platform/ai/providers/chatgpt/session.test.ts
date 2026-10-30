import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

const account = {
  subject: 'user',
  clientId: 'client',
  refreshToken: 'old',
  sharing: true
};

test('refresh is shared and persists the rotation before exposing access', async () => {
  let calls = 0;
  let saved = '';
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async (_account, refresh) => {
      saved = refresh;
    },
    fetch: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));

      return Response.json({
        access_token: 'access',
        refresh_token: 'new',
        expires_in: 3600
      });
    }
  });

  try {
    await auth.replace(account);
    assert.throws(
      () =>
        new AuthManager({
          issuer: 'https://example.test',
          saveRefresh: async () => {}
        }),
      /owner/i
    );
    assert.deepEqual(
      new Set(await Promise.all(Array.from({ length: 20 }, () => auth.token()))),
      new Set(['access'])
    );
    assert.equal(saved, 'new');
    assert.equal(calls, 1);
  } finally {
    await auth.dispose();
  }
});

test('failed persistence must be retried before any access or another refresh', async () => {
  let calls = 0,
    saves = 0;
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async (previous, refresh) => {
      assert.equal(previous.refreshToken, 'old');
      assert.equal(refresh, 'rotated');

      if (++saves === 1) throw Error('disk');
    },
    fetch: async () => {
      calls++;

      return Response.json({
        access_token: 'access',
        refresh_token: 'rotated',
        expires_in: 3600
      });
    }
  });

  try {
    await auth.replace(account);
    await assert.rejects(auth.token(), /disk/);
    assert.equal(await auth.token(), 'access');
    assert.equal(calls, 1);
    assert.equal(saves, 2);
  } finally {
    await auth.dispose();
  }
});

test('replacement invalidates in-flight refresh before it can return a token', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {},
    fetch: async () => {
      entered();
      await gate;

      return Response.json({ access_token: 'stale', refresh_token: 'rotated' });
    }
  });

  try {
    await auth.replace(account);
    const stale = auth.token();

    await started;
    const replacing = auth.replace(
      { ...account, subject: 'new', refreshToken: 'new' },
      { accessToken: 'fresh', expiresIn: 3600 }
    );

    release();
    await assert.rejects(stale, /invalidated/i);
    await replacing;
    assert.equal(await auth.token(), 'fresh');
    await auth.signOut();
    await assert.rejects(auth.token(), /signed in/i);
  } finally {
    await auth.dispose();
  }
});

test('seeded access and stale refusals do not cause gratuitous refresh', async () => {
  let calls = 0;
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {},
    fetch: async () => Response.json({ access_token: `access${++calls}`, expires_in: 3600 })
  });

  try {
    await auth.replace(account, { accessToken: 'seed', expiresIn: 3600 });
    assert.equal(await auth.token(), 'seed');
    assert.equal(calls, 0);
    auth.refused('seed');
    assert.equal(await auth.token(), 'access1');
    auth.refused('seed');
    assert.equal(await auth.token(), 'access1');
  } finally {
    await auth.dispose();
  }
});

test('token endpoint failures do not expose response secrets', async () => {
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {},
    fetch: async () => new Response('secret-refresh-token', { status: 400 })
  });

  try {
    await auth.replace(account);
    await assert.rejects(auth.token(), (error) => !String(error).includes('secret-refresh-token'));
  } finally {
    await auth.dispose();
  }
});

test('sign-out waits for in-flight persistence and never returns its access token', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {
      entered();
      await gate;
    },
    fetch: async () => Response.json({ access_token: 'stale', refresh_token: 'rotated' })
  });

  try {
    await auth.replace(account);
    const token = auth.token();
    const rejection = assert.rejects(token, /invalidated/i);

    await started;
    let signedOut = false;
    const signOut = auth.signOut().then(() => {
      signedOut = true;
    });

    await Promise.resolve();
    assert.equal(signedOut, false);
    release();
    await rejection;
    await signOut;
    await assert.rejects(auth.token(), /signed in/i);
  } finally {
    release();
    await auth.dispose();
  }
});

test('replacement during response parsing preserves and reuses the rotated credential', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saved = 'old';
  const used: string[] = [];
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async (previous, rotated) => {
      assert.equal(previous.refreshToken, saved);
      saved = rotated;
    },
    fetch: async (_url, init) => {
      used.push(new URLSearchParams(init?.body as string).get('refresh_token')!);

      if (used.length === 1) {
        return new Response(
          new ReadableStream({
            async start(controller) {
              entered();
              await gate;
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({ access_token: 'stale', refresh_token: 'rotated' })
                )
              );
              controller.close();
            }
          })
        );
      }

      return Response.json({ access_token: 'fresh' });
    }
  });

  try {
    await auth.replace(account);
    const rejected = assert.rejects(auth.token(), /invalidated/i);

    await started;
    const replacing = auth.replace(account);

    release();
    await rejected;
    await replacing;
    assert.equal(saved, 'rotated');
    assert.equal(await auth.token(), 'fresh');
    assert.deepEqual(used, ['old', 'rotated']);
  } finally {
    release();
    await auth.dispose();
  }
});

test('replacement retries a dirty rotation before restoring the same account', async () => {
  let saved = 'old',
    saves = 0;
  const used: string[] = [];
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async (previous, rotated) => {
      assert.equal(previous.refreshToken, saved);

      if (++saves === 1) throw Error('storage unavailable');

      saved = rotated;
    },
    fetch: async (_url, init) => {
      used.push(new URLSearchParams(init?.body as string).get('refresh_token')!);

      return Response.json(
        used.length === 1
          ? { access_token: 'first', refresh_token: 'rotated' }
          : { access_token: 'second' }
      );
    }
  });

  try {
    await auth.replace(account);
    await assert.rejects(auth.token(), /storage unavailable/);
    await auth.replace(account);
    assert.equal(saved, 'rotated');
    assert.equal(await auth.token(), 'second');
    assert.deepEqual(used, ['old', 'rotated']);
  } finally {
    await auth.dispose();
  }
});

test('malformed refresh JSON never appears in the thrown error', async () => {
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {},
    fetch: async () => new Response('secret-from-refresh', { status: 200 })
  });

  try {
    await auth.replace(account);
    await assert.rejects(
      auth.token(),
      (error) =>
        !String(error).includes('secret-from-refresh') &&
        error instanceof Error &&
        error.cause === undefined
    );
  } finally {
    await auth.dispose();
  }
});

test('a failed retirement keeps ownership and can be retried', async () => {
  let saves = 0;
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {
      if (++saves < 3) throw Error('storage unavailable');
    },
    fetch: async () => Response.json({ access_token: 'access', refresh_token: 'rotated' })
  });

  try {
    await auth.replace(account);
    await assert.rejects(auth.token(), /storage unavailable/);
    await assert.rejects(auth.replace(account), /storage unavailable/);
    await assert.rejects(auth.token(), /signed in/);
    assert.throws(
      () =>
        new AuthManager({
          issuer: 'https://example.test',
          saveRefresh: async () => {}
        }),
      /owner/i
    );
    await auth.replace(account, { accessToken: 'new', expiresIn: 3600 });
    assert.equal(await auth.token(), 'new');
  } finally {
    await auth.dispose();
  }
});

test('dispose closes admission and retains ownership until an admitted replacement retires', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const options = {
    issuer: 'https://example.test',
    saveRefresh: async () => {
      entered();
      await gate;
    },
    fetch: async () => Response.json({ access_token: 'stale', refresh_token: 'rotated' })
  };
  const auth = new AuthManager(options);

  try {
    await auth.replace(account);
    const token = assert.rejects(auth.token(), /invalidated/i);

    await started;
    const replacing = assert.rejects(
      auth.replace(
        { ...account, subject: 'new', refreshToken: 'new' },
        { accessToken: 'new', expiresIn: 3600 }
      ),
      /dispos/i
    );
    const disposing = auth.dispose();

    await assert.rejects(auth.replace(account), /dispos/i);
    await assert.rejects(auth.token(), /signed in/i);
    assert.throws(() => new AuthManager(options), /owner/i);
    release();
    await token;
    await replacing;
    await disposing;
    await assert.rejects(auth.token(), /signed in/i);
    await assert.rejects(auth.replace(account), /dispos/i);
    const next = new AuthManager(options);

    await next.dispose();
  } finally {
    release();
    await auth.dispose();
  }
});

test('overlapping sign-out and replacement cannot both succeed', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {
      entered();
      await gate;
    },
    fetch: async () => Response.json({ access_token: 'stale', refresh_token: 'rotated' })
  });

  try {
    await auth.replace(account);
    const token = assert.rejects(auth.token(), /invalidated/i);

    await started;
    const signOut = auth.signOut();

    await assert.rejects(
      auth.replace(account, { accessToken: 'new', expiresIn: 3600 }),
      /transition/i
    );
    release();
    await token;
    await signOut;
    await assert.rejects(auth.token(), /signed in/i);
  } finally {
    release();
    await auth.dispose();
  }
});

test('sign-out is rejected while replacement is pending', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {
      entered();
      await gate;
    },
    fetch: async () => Response.json({ access_token: 'stale', refresh_token: 'rotated' })
  });

  try {
    await auth.replace(account);
    const token = assert.rejects(auth.token(), /invalidated/i);

    await started;
    const replace = auth.replace(
      { ...account, subject: 'new' },
      { accessToken: 'new', expiresIn: 3600 }
    );

    await assert.rejects(auth.signOut(), /transition/i);
    release();
    await token;
    await replace;
    assert.equal(await auth.token(), 'new');
  } finally {
    release();
    await auth.dispose();
  }
});

test('failed disposal retains ownership, blocks transitions and can be retried', async () => {
  let saves = 0;
  const options = {
    issuer: 'https://example.test',
    saveRefresh: async () => {
      if (++saves < 3) throw Error('disk');
    },
    fetch: async () => Response.json({ access_token: 'access', refresh_token: 'rotated' })
  };
  const auth = new AuthManager(options);

  try {
    await auth.replace(account);
    await assert.rejects(auth.token(), /disk/);
    await assert.rejects(auth.dispose(), /disk/);
    assert.throws(() => new AuthManager(options), /owner/i);
    await assert.rejects(auth.replace(account), /dispos/i);
    await assert.rejects(auth.token(), /signed in/i);
    await auth.dispose();
    const next = new AuthManager(options);

    await next.dispose();
  } finally {
    await auth.dispose();
  }
});

test('seed refresh follows the native clock against a loopback token endpoint', async () => {
  const { createServer } = await import('node:http');
  const { Clock, Effect } = await import('effect');
  const { TestClock } = await import('effect/testing');
  let calls = 0;
  const server = createServer((_request, response) => {
    calls++;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ access_token: 'refreshed', expires_in: 3600 }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('No loopback address');

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000_000);
        const clock = yield* Clock.Clock;
        const auth = new AuthManager({
          issuer: `http://127.0.0.1:${address.port}`,
          clock,
          saveRefresh: async () => {}
        });

        try {
          yield* Effect.promise(() =>
            auth.replace(account, { accessToken: 'seed', expiresIn: 600 })
          );
          yield* TestClock.adjust('299 seconds');
          assert.equal(yield* Effect.promise(() => auth.token()), 'seed');
          yield* TestClock.adjust('1 second');
          assert.equal(yield* Effect.promise(() => auth.token()), 'refreshed');
          assert.equal(calls, 1);
        } finally {
          yield* Effect.promise(() => auth.dispose());
        }
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
