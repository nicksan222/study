import type { Page } from 'playwright';

/** Gates browser permission acquisition while preserving Chromium's real fake-device capture. */
export async function controlMicrophone(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let opened!: () => void;
  const requested = new Promise<void>((resolve) => {
    opened = resolve;
  });

  const audio = new Set<() => void>();

  await page.exposeBinding('__studyVoiceAudioReady', () => {
    for (const ready of audio) ready();

    audio.clear();
  });

  await page.exposeBinding('__studyVoicePermissionGate', async () => {
    opened();
    await gate;
  });
  await page.addInitScript(() => {
    const bindings = window as unknown as {
      __studyVoicePermissionGate: () => Promise<void>;
      __studyVoiceAudioReady: () => Promise<void>;
    };

    window.MediaRecorder = new Proxy(window.MediaRecorder, {
      construct(target, args) {
        const recorder = Reflect.construct(target, args) as MediaRecorder;

        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size) void bindings.__studyVoiceAudioReady();
        });

        return recorder;
      }
    });
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await bindings.__studyVoicePermissionGate();

      return capture(constraints);
    };
  });

  return { requested, release, nextAudio: () => new Promise<void>((ready) => audio.add(ready)) };
}
