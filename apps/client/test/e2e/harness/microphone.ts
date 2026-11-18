import type { Page } from 'playwright';

type Permission = {
  sequence: number;
  requested: ReturnType<typeof Promise.withResolvers<void>>;
  released: ReturnType<typeof Promise.withResolvers<void>>;
  started: ReturnType<typeof Promise.withResolvers<void>>;
};

/** Gates real Chromium capture and matches each worklet startup to its permission request. */
export async function controlMicrophone(page: Page) {
  const permissions = new Map<number, Permission>();
  let sequence = 0;
  let armed: Permission | undefined;

  await page.exposeBinding('__studyVoiceAudioReady', (_source, id: number) => {
    permissions.get(id)?.started.resolve();
    permissions.delete(id);
  });

  await page.exposeBinding('__studyVoicePermissionGate', async () => {
    const permission = armed;

    if (!permission) throw new Error('Use microphone.start before requesting recording permission');

    armed = undefined;
    permission.requested.resolve();
    await permission.released.promise;

    return permission.sequence;
  });

  await page.addInitScript(() => {
    const bindings = window as unknown as {
      __studyVoicePermissionGate: () => Promise<number>;
      __studyVoiceAudioReady: (id: number) => Promise<void>;
    };
    let recording: number | undefined;

    window.AudioWorkletNode = new Proxy(window.AudioWorkletNode, {
      construct(target, args) {
        const node = Reflect.construct(target, args) as AudioWorkletNode;
        const id = recording;

        recording = undefined;

        if (id !== undefined)
          node.port.addEventListener('message', (event) => {
            if (event.data?.type === 'started') void bindings.__studyVoiceAudioReady(id);
          });

        return node;
      }
    });
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const id = await bindings.__studyVoicePermissionGate();
      const stream = await capture(constraints);

      recording = id;

      return stream;
    };
  });

  return {
    arm() {
      if (armed) throw new Error('A recording is already waiting to request microphone permission');

      const permission: Permission = {
        sequence: ++sequence,
        requested: Promise.withResolvers(),
        released: Promise.withResolvers(),
        started: Promise.withResolvers()
      };

      permissions.set(permission.sequence, permission);
      armed = permission;

      return {
        requested: permission.requested.promise,
        started: permission.started.promise,
        release: () => permission.released.resolve(),
        dispose() {
          permission.released.resolve();
          permissions.delete(permission.sequence);

          if (armed === permission) armed = undefined;
        }
      };
    }
  };
}
