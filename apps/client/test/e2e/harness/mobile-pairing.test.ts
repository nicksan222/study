import { endpoints } from '@study/contracts';
import { test } from '@study/testing';
import { Deferred, Effect, Fiber, Result, Stream } from 'effect';

import type { OpenPhoneRpc } from '#client/lib/mobile-link/phone-connection.ts';
import { frameSize, parseInvitation } from '#client/lib/mobile-link/protocol.ts';

const desktopId = 'desktop012345678901234';

const phoneId = 'phone01234567890123456';

const otherId = 'other01234567890123456';

type Peer = { peerId: string; userId: string };

type Packet = { peerId: string; userId: string; metadata?: string; signal: AbortSignal };

type Delivery = Packet & { byteLength: number };

type Listener<A> = (event: A) => void;

function events<A>() {
  const listeners = new Set<Listener<A>>();

  return {
    on(listener: Listener<A>) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    emit(event: A) {
      for (const listener of listeners) listener(event);
    }
  };
}

function inbox() {
  const messages = events<{ value: unknown; packet: Packet }>();
  let accepts: (packet: Delivery) => boolean = () => true;
  let request: (value: unknown, packet: Packet) => unknown;

  return {
    messages,
    accepts: (packet: Delivery) => accepts(packet),
    onReceive: (listener: typeof accepts) => (accepts = listener),
    onRequest: (listener: typeof request) => (request = listener),
    request: (value: unknown, packet: Packet) => request?.(value, packet)
  };
}

type ActionOptions = { target: string; metadata?: string; signal?: AbortSignal };

/** In-memory delivery for authenticated Trystero actions. RPC still uses its real WebSocket. */
function network() {
  const joined = new Map<string, ReturnType<typeof createPeer>>();
  let sequence = 0;

  function createPeer(userId: string) {
    const peer = { peerId: `peer-${++sequence}`, userId };
    const arrivals = events<Peer>();
    const departures = events<Peer>();
    const actions = new Map<string, ReturnType<typeof inbox>>();

    return {
      peer,
      arrivals,
      departures,
      actions,
      getSelf: async () => ({ userId, identityPersistence: 'local' }),
      getPeers: (): Record<string, Peer> =>
        Object.fromEntries(
          [...joined.values()]
            .filter((entry) => entry.peer !== peer)
            .map(({ peer }) => [peer.peerId, peer])
        ),
      onPeerJoin(listener: Listener<Peer>, { replay = false } = {}) {
        if (replay) for (const existing of Object.values(this.getPeers())) listener(existing);

        return arrivals.on(listener);
      },
      onPeerLeave: departures.on,
      onError: () => () => undefined,
      async leave() {
        joined.delete(peer.peerId);

        for (const other of joined.values()) {
          other.departures.emit(peer);
          departures.emit(other.peer);
        }
      },
      makeAction(name: string) {
        const action = inbox();

        actions.set(name, action);

        return {
          onReceive: action.onReceive,
          onRequest: action.onRequest,
          onMessage: (listener: (value: unknown, packet: Packet) => void) =>
            action.messages.on(({ value, packet }) => listener(value, packet)),
          send: async (value: unknown, options: ActionOptions) => {
            const delivery = recipient(value, options);

            delivery?.target.messages.emit({ value, packet: delivery.packet });
          },
          request: async (value: unknown, options: ActionOptions) => {
            const delivery = recipient(value, options);

            if (!delivery) throw new Error('Action rejected');

            return delivery.target.request(value, delivery.packet);
          }
        };

        function recipient(value: unknown, options: ActionOptions) {
          const signal = options.signal ?? new AbortController().signal;

          signal.throwIfAborted();

          const target = joined.get(options.target)?.actions.get(name);
          const packet = { ...peer, signal, metadata: options.metadata };
          const byteLength =
            value instanceof Uint8Array
              ? value.byteLength
              : new TextEncoder().encode(JSON.stringify(value)).byteLength;

          if (joined.has(peer.peerId) && target?.accepts({ ...packet, byteLength }))
            return { target, packet };
        }
      }
    };
  }

  return (userId: string) => {
    const entry = createPeer(userId);

    joined.set(entry.peer.peerId, entry);

    for (const other of joined.values()) if (other !== entry) other.arrivals.emit(entry.peer);

    return entry;
  };
}

async function setupPairing({ mock, vi }: Pick<test.unit.Context, 'mock' | 'vi'>) {
  const join = network();
  const identities = [desktopId, phoneId];
  const storage = new Map<string, string>();

  mock('trystero', () => ({ joinRoom: () => join(identities.shift()!) }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });

  const desktop = await import('#client/lib/mobile-link/desktop.ts');
  const { connectPhone } = await import('#client/lib/mobile-link/phone-connection.ts');

  await desktop.startInvitation();

  const invitation = parseInvitation(desktop.desktopState().invite!);
  const begin = (paired = false) => {
    const connected = Promise.withResolvers<OpenPhoneRpc>();
    const readyForApproval = Promise.withResolvers<void>();
    const disconnected = Promise.withResolvers<void>();
    const challenge = mock.fn();
    const approved = mock.fn();
    const unsub = desktop.subscribeDesktop(() => {
      if (desktop.desktopState().approval) readyForApproval.resolve();
    });
    const stop = connectPhone(invitation, paired, {
      challenge,
      paired: approved,
      connected: connected.resolve,
      disconnected: disconnected.resolve,
      error: () => connected.reject(new Error('Pairing failed'))
    });

    return {
      challenge,
      approved,
      connected: connected.promise,
      disconnected: disconnected.promise,
      readyForApproval: readyForApproval.promise,
      async stop() {
        unsub();
        await stop();
      }
    };
  };

  return { desktop, begin, join, identities, invitation };
}

test.unit.stable(
  'only the approved phone can open the live RPC channel',
  async ({ mock, vi, expect }) => {
    const fixture = await setupPairing({ mock, vi });
    const { desktop, join } = fixture;
    const phone = fixture.begin();
    const other = join(otherId);
    const [target] = Object.keys(other.getPeers());
    const open = other.makeAction('rpc-open');
    const id = crypto.randomUUID();

    try {
      await phone.readyForApproval;
      expect(phone.challenge).toHaveBeenCalledWith(phoneId.slice(-6));
      expect(desktop.desktopState().approval?.code).toBe(phoneId.slice(-6));
      expect(phone.approved).not.toHaveBeenCalled();
      await expect(open.request(id, { target: target! })).rejects.toThrow('Action rejected');

      desktop.desktopState().approval?.confirm();
      await phone.connected;
      expect(desktop.desktopState().link?.phone).toBe(phoneId);
      expect(phone.approved).toHaveBeenCalledTimes(1);
      await expect(open.request(id, { target: target! })).rejects.toThrow('Action rejected');

      await desktop.disconnectDesktop();
      await phone.disconnected;
      expect(desktop.desktopState().link).toBeUndefined();
    } finally {
      await phone.stop();
      await other.leave();
      await desktop.disconnectDesktop();
    }
  }
);

test.unit.stable(
  'an expired invitation cannot be approved and revocation releases the request',
  async ({ mock, vi, expect }) => {
    const { desktop, begin, invitation } = await setupPairing({ mock, vi });
    const phone = begin();

    try {
      await phone.readyForApproval;
      vi.setSystemTime(invitation.expiresAt!);
      desktop.desktopState().approval?.confirm();
      expect(desktop.desktopState().link).toBeUndefined();
      await desktop.disconnectDesktop();
      await phone.disconnected;
      expect(phone.approved).not.toHaveBeenCalled();
      expect(desktop.desktopState().invite).toBeUndefined();
    } finally {
      vi.useRealTimers();
      await phone.stop();
      await desktop.disconnectDesktop();
    }
  }
);

test.server.stable(
  'the paired transport shares desktop data and subscriptions after reconnecting',
  async ({ mock, vi, expect, rpc, runTestEffect }) => {
    mock('@tauri-apps/api/core', () => ({
      isTauri: () => true,
      invoke: () => ({ baseUrl: rpc.url })
    }));

    const pairing = await setupPairing({ mock, vi });
    const { desktop, identities } = pairing;
    const phone = pairing.begin();

    try {
      await phone.readyForApproval;
      desktop.desktopState().approval?.confirm();
      await phone.connected;
      await phone.stop();
      identities.push(desktopId, phoneId);
      await desktop.resumeDesktop(true);

      const returning = pairing.begin(true);

      try {
        const open = await returning.connected;
        const { createRpcTransport } = await import('#client/lib/effect/rpc.ts');
        const transport = createRpcTransport(open);
        const { create, list } = endpoints.projects;

        await runTestEffect(
          Effect.gen(function* () {
            const empty = yield* Deferred.make<void>();
            const subscription = yield* transport.subscribe(list.liveRpc, { limit: 10 }).pipe(
              Stream.filter((frame) => frame._tag === 'Snapshot'),
              Stream.map((frame) => Result.getOrThrow(frame.result)),
              Stream.tap((page) =>
                page.items.length === 0 ? Deferred.succeed(empty, undefined) : Effect.void
              ),
              Stream.takeUntil((page) => page.items.length > 0),
              Stream.runLast,
              Effect.forkChild
            );

            yield* Deferred.await(empty);

            const saved = yield* transport.execute(create.rpc, { name: 'Biologia' });
            const observed = yield* Fiber.join(subscription);
            const snapshot = yield* rpc.client['projects.projects']({ limit: 10 });

            expect(saved.name).toBe('Biologia');
            expect(observed).toMatchObject({ value: { items: [saved] } });
            expect(snapshot.items).toEqual([saved]);
          })
        );
        expect(returning.challenge).not.toHaveBeenCalled();

        const { create: upload, sourceExport: download } = endpoints.sources;
        const bytes = new TextEncoder().encode('Biologia 🧬\n'.repeat(frameSize / 4));

        await runTestEffect(
          Effect.gen(function* () {
            const source = yield* transport.execute(upload.rpc, {
              name: 'Biologia.txt',
              bytes,
              projectId: null
            });
            const exported = yield* transport.execute(download.rpc, { id: source.id });

            expect(exported.bytes).toEqual(bytes);
          })
        );

        const raw = await open(AbortSignal.timeout(5000));
        const received = expect(raw.readable.getReader().read()).rejects.toThrow(
          'Desktop disconnected'
        );

        await desktop.disconnectDesktop();
        await received;
      } finally {
        await returning.stop();
      }
    } finally {
      await phone.stop();
      await desktop.disconnectDesktop();
    }
  }
);
