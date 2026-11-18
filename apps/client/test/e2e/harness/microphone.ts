import type { Page } from 'playwright';

type Permission = {
  requested: ReturnType<typeof Promise.withResolvers<void>>;
  released: ReturnType<typeof Promise.withResolvers<void>>;
};

/** Gates permission for Chromium's actual microphone capture. */
export async function controlMicrophone(page: Page) {
  let armed: Permission | undefined;

  await page.exposeBinding('__studyVoicePermissionGate', async () => {
    const permission = armed;

    if (!permission) throw new Error('Use microphone.start before requesting recording permission');

    armed = undefined;
    permission.requested.resolve();
    await permission.released.promise;
  });

  await page.addInitScript(() => {
    const bindings = window as unknown as {
      __studyVoicePermissionGate: () => Promise<void>;
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await bindings.__studyVoicePermissionGate();

      return capture(constraints);
    };
  });

  return {
    arm() {
      if (armed) throw new Error('A recording is already waiting to request microphone permission');

      const permission: Permission = {
        requested: Promise.withResolvers(),
        released: Promise.withResolvers()
      };

      armed = permission;

      return {
        requested: permission.requested.promise,
        release: () => permission.released.resolve(),
        dispose() {
          permission.released.resolve();

          if (armed === permission) armed = undefined;
        }
      };
    }
  };
}
