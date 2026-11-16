import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies shared token refresh, durable refresh-token rotation, and invalidation    │
 * │ behavior in AuthManager. Tests also cover stale credentials and safe failures.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: refresh is shared and persists the rotation before exposing access; failed    │
 * │   persistence must be retried before any access or another refresh.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Starts #server/platform/ai/providers/chatgpt/session against a local HTTP peer; the test │
 * │ owns and closes that peer.                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';

const account = {
  subject: 'user',
  clientId: 'client',
  refreshToken: 'old',
  sharing: true
};

test.stable('refresh is shared and persists the rotation before exposing access', async () => {
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
    test.assert.throws(
      () =>
        new AuthManager({
          issuer: 'https://example.test',
          saveRefresh: async () => {}
        }),
      /owner/i
    );
    test
      .expect(new Set(await Promise.all(Array.from({ length: 20 }, () => auth.token()))))
      .toStrictEqual(new Set(['access']));
    test.assert.ok(saved === 'new');
    test.assert.strictEqual(calls, 1);
  } finally {
    await auth.dispose();
  }
});

test.stable('failed persistence must be retried before any access or another refresh', async () => {
  let calls = 0,
    saves = 0;
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async (previous, refresh) => {
      test.assert.ok(previous.refreshToken === 'old');
      test.assert.ok(refresh === 'rotated');

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
    await test.expect(auth.token()).rejects.toThrow(/disk/);
    test.assert.ok((await auth.token()) === 'access');
    test.assert.strictEqual(calls, 1);
    test.assert.strictEqual(saves, 2);
  } finally {
    await auth.dispose();
  }
});

test.stable('replacement invalidates in-flight refresh before it can return a token', async () => {
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
    await test.expect(stale).rejects.toThrow(/invalidated/i);
    await replacing;
    test.assert.ok((await auth.token()) === 'fresh');
    await auth.signOut();
    await test.expect(auth.token()).rejects.toThrow(/signed in/i);
  } finally {
    await auth.dispose();
  }
});

test.stable('seeded access and stale refusals do not cause gratuitous refresh', async () => {
  let calls = 0;
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {},
    fetch: async () => Response.json({ access_token: `access${++calls}`, expires_in: 3600 })
  });

  try {
    await auth.replace(account, { accessToken: 'seed', expiresIn: 3600 });
    test.assert.ok((await auth.token()) === 'seed');
    test.assert.strictEqual(calls, 0);
    auth.refused('seed');
    test.assert.ok((await auth.token()) === 'access1');
    auth.refused('seed');
    test.assert.ok((await auth.token()) === 'access1');
  } finally {
    await auth.dispose();
  }
});

test.stable('token endpoint failures do not expose response secrets', async () => {
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {},
    fetch: async () => new Response('secret-refresh-token', { status: 400 })
  });

  try {
    await auth.replace(account);
    await test
      .expect(auth.token())
      .rejects.toSatisfy((error) => !String(error).includes('secret-refresh-token'));
  } finally {
    await auth.dispose();
  }
});

test.stable(
  'sign-out waits for in-flight persistence and never returns its access token',
  async () => {
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
      const rejection = (async () => {
        await test.expect(token).rejects.toThrow(/invalidated/i);
      })();

      await started;
      let signedOut = false;
      const signOut = auth.signOut().then(() => {
        signedOut = true;
      });

      await Promise.resolve();
      test.assert.ok(signedOut === false);
      release();
      await rejection;
      await signOut;
      await test.expect(auth.token()).rejects.toThrow(/signed in/i);
    } finally {
      release();
      await auth.dispose();
    }
  }
);

test.stable(
  'replacement during response parsing preserves and reuses the rotated credential',
  async () => {
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
        test.assert.strictEqual(previous.refreshToken, saved);
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
      const rejected = (async () => {
        await test.expect(auth.token()).rejects.toThrow(/invalidated/i);
      })();

      await started;
      const replacing = auth.replace(account);

      release();
      await rejected;
      await replacing;
      test.assert.ok(saved === 'rotated');
      test.assert.ok((await auth.token()) === 'fresh');
      test.expect(used).toStrictEqual(['old', 'rotated']);
    } finally {
      release();
      await auth.dispose();
    }
  }
);

test.stable('replacement retries a dirty rotation before restoring the same account', async () => {
  let saved = 'old',
    saves = 0;
  const used: string[] = [];
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async (previous, rotated) => {
      test.assert.strictEqual(previous.refreshToken, saved);

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
    await test.expect(auth.token()).rejects.toThrow(/storage unavailable/);
    await auth.replace(account);
    test.assert.ok(saved === 'rotated');
    test.assert.ok((await auth.token()) === 'second');
    test.expect(used).toStrictEqual(['old', 'rotated']);
  } finally {
    await auth.dispose();
  }
});

test.stable('malformed refresh JSON never appears in the thrown error', async () => {
  const auth = new AuthManager({
    issuer: 'https://example.test',
    saveRefresh: async () => {},
    fetch: async () => new Response('secret-from-refresh', { status: 200 })
  });

  try {
    await auth.replace(account);
    await test
      .expect(auth.token())
      .rejects.toSatisfy(
        (error) =>
          !String(error).includes('secret-from-refresh') &&
          error instanceof Error &&
          error.cause === undefined
      );
  } finally {
    await auth.dispose();
  }
});

test.stable('a failed retirement keeps ownership and can be retried', async () => {
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
    await test.expect(auth.token()).rejects.toThrow(/storage unavailable/);
    await test.expect(auth.replace(account)).rejects.toThrow(/storage unavailable/);
    await test.expect(auth.token()).rejects.toThrow(/signed in/);
    test.assert.throws(
      () =>
        new AuthManager({
          issuer: 'https://example.test',
          saveRefresh: async () => {}
        }),
      /owner/i
    );
    await auth.replace(account, { accessToken: 'new', expiresIn: 3600 });
    test.assert.ok((await auth.token()) === 'new');
  } finally {
    await auth.dispose();
  }
});

test.stable(
  'dispose closes admission and retains ownership until an admitted replacement retires',
  async () => {
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
      const token = (async () => {
        await test.expect(auth.token()).rejects.toThrow(/invalidated/i);
      })();

      await started;
      const replacing = (async () => {
        await test
          .expect(
            auth.replace(
              { ...account, subject: 'new', refreshToken: 'new' },
              { accessToken: 'new', expiresIn: 3600 }
            )
          )
          .rejects.toThrow(/dispos/i);
      })();
      const disposing = auth.dispose();

      await test.expect(auth.replace(account)).rejects.toThrow(/dispos/i);
      await test.expect(auth.token()).rejects.toThrow(/signed in/i);
      test.assert.throws(() => new AuthManager(options), /owner/i);
      release();
      await token;
      await replacing;
      await disposing;
      await test.expect(auth.token()).rejects.toThrow(/signed in/i);
      await test.expect(auth.replace(account)).rejects.toThrow(/dispos/i);
      const next = new AuthManager(options);

      await next.dispose();
    } finally {
      release();
      await auth.dispose();
    }
  }
);

test.stable('overlapping sign-out and replacement cannot both succeed', async () => {
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
    const token = (async () => {
      await test.expect(auth.token()).rejects.toThrow(/invalidated/i);
    })();

    await started;
    const signOut = auth.signOut();

    await test
      .expect(auth.replace(account, { accessToken: 'new', expiresIn: 3600 }))
      .rejects.toThrow(/transition/i);
    release();
    await token;
    await signOut;
    await test.expect(auth.token()).rejects.toThrow(/signed in/i);
  } finally {
    release();
    await auth.dispose();
  }
});

test.stable('sign-out is rejected while replacement is pending', async () => {
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
    const token = (async () => {
      await test.expect(auth.token()).rejects.toThrow(/invalidated/i);
    })();

    await started;
    const replace = auth.replace(
      { ...account, subject: 'new' },
      { accessToken: 'new', expiresIn: 3600 }
    );

    await test.expect(auth.signOut()).rejects.toThrow(/transition/i);
    release();
    await token;
    await replace;
    test.assert.ok((await auth.token()) === 'new');
  } finally {
    release();
    await auth.dispose();
  }
});

test.stable(
  'failed disposal retains ownership, blocks transitions and can be retried',
  async () => {
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
      await test.expect(auth.token()).rejects.toThrow(/disk/);
      await test.expect(auth.dispose()).rejects.toThrow(/disk/);
      test.assert.throws(() => new AuthManager(options), /owner/i);
      await test.expect(auth.replace(account)).rejects.toThrow(/dispos/i);
      await test.expect(auth.token()).rejects.toThrow(/signed in/i);
      await auth.dispose();
      const next = new AuthManager(options);

      await next.dispose();
    } finally {
      await auth.dispose();
    }
  }
);

test.stable('seed refresh follows the native clock against a loopback token endpoint', async () => {
  const { Clock, Effect } = await import('effect');
  const { TestClock } = await import('effect/testing');
  let calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      calls++;

      return Response.json({ access_token: 'refreshed', expires_in: 3600 });
    }
  });

  test.assert.ok(server.port, 'No loopback address');

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000_000);
        const clock = yield* Clock.Clock;
        const auth = new AuthManager({
          issuer: server.url.origin,
          clock,
          saveRefresh: async () => {}
        });

        try {
          yield* Effect.promise(() =>
            auth.replace(account, { accessToken: 'seed', expiresIn: 600 })
          );
          yield* TestClock.adjust('299 seconds');
          test.assert.strictEqual(yield* Effect.promise(() => auth.token()), 'seed');
          yield* TestClock.adjust('1 second');
          test.assert.strictEqual(yield* Effect.promise(() => auth.token()), 'refreshed');
          test.assert.strictEqual(calls, 1);
        } finally {
          yield* Effect.promise(() => auth.dispose());
        }
      }).pipe(Effect.provide(TestClock.layer()))
    );
  } finally {
    await server.stop(true);
  }
});
