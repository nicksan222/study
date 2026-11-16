import { test } from '@study/testing';

import { downloadBackup, encodeBackupFile, MAX_ARTIFACT_BYTES } from './files';

function artifact(bytes: Uint8Array, size = bytes.length) {
  const file = new File([Uint8Array.from(bytes).buffer], 'fixture.studybackup');
  const arrayBuffer = test.vi.fn(async () => Uint8Array.from(bytes).buffer);

  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });

  return { file, arrayBuffer };
}

test.beforeEach(() => {
  test.vi.stubGlobal('URL', { createObjectURL: test.vi.fn(), revokeObjectURL: test.vi.fn() });
});
test.afterEach(() => {
  test.vi.unstubAllGlobals();
  test.vi.restoreAllMocks();
  test.vi.useRealTimers();
});

test.stable('bounds file size before reading and rejects a different encoding', async () => {
  const oversized = artifact(new Uint8Array(), MAX_ARTIFACT_BYTES + 1);

  await test.expect(encodeBackupFile(oversized.file)).rejects.toThrow();
  test.expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  const empty = artifact(new Uint8Array());

  await test.expect(encodeBackupFile(empty.file)).rejects.toThrow();
  test.expect(empty.arrayBuffer).not.toHaveBeenCalled();
  const wrongFormat = artifact(new TextEncoder().encode('not a Study artifact'));

  await test.expect(encodeBackupFile(wrongFormat.file)).rejects.toThrow();
});

test.stable(
  'transports the binary artifact as base64 without converting it to JSON or text',
  async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('STUDYBK1\n'), 0, 255, 128, 3]);
    const encoded = await encodeBackupFile(artifact(bytes).file);

    test.expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(bytes);
  }
);

test.stable(
  'downloads exact binary bytes with an explicit filename and delayed Blob cleanup',
  async () => {
    test.vi.useFakeTimers();
    const create = test.vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    const revoke = test.vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = test.vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      test.expect(this.download).toBe('snapshot.studybackup');
      test.expect(this.href).toBe('blob:backup');
      test.expect(this.isConnected).toBe(true);
    });
    const binary = 'STUDYBK1\n\x00\xff\x80';

    downloadBackup(btoa(binary), 'snapshot');
    test.expect(create).toHaveBeenCalledWith(test.expect.any(Blob));
    test.expect(click).toHaveBeenCalledOnce();
    test.expect(document.querySelector('a[download]')).toBeNull();
    test.expect(revoke).not.toHaveBeenCalled();
    test.vi.advanceTimersByTime(999);
    test.expect(revoke).not.toHaveBeenCalled();
    test.vi.advanceTimersByTime(1);
    test.expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:backup');
    test.vi.useRealTimers();
    const blob = create.mock.calls[0]![0] as Blob;

    test.expect(blob).toBeInstanceOf(Blob);
    const transported = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    test.expect(transported).toBe(`data:application/octet-stream;base64,${btoa(binary)}`);
  }
);

test.stable('cleans up even when download dispatch fails', () => {
  test.vi.useFakeTimers();
  test.vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
  const revoke = test.vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  test.vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    throw new Error('blocked');
  });
  test.expect(() => downloadBackup(btoa('data'), 'snapshot')).toThrow();
  test.vi.runAllTimers();
  test.expect(revoke).toHaveBeenCalledWith('blob:backup');
  test.expect(document.querySelector('a[download]')).toBeNull();
});

test.stable.each([1, -1])(
  'rejects file byte-count mismatch (%s) after reading',
  async (difference) => {
    const bytes = new TextEncoder().encode('STUDYBK1\nexample');
    const value = artifact(bytes, bytes.length + difference);

    await test.expect(encodeBackupFile(value.file)).rejects.toThrow();
    test.expect(value.arrayBuffer).toHaveBeenCalledOnce();
  }
);

test.stable(
  'allows the exact declared size boundary to be read but still validates actual length',
  async () => {
    const value = artifact(new TextEncoder().encode('STUDYBK1\n'), MAX_ARTIFACT_BYTES);

    await test.expect(encodeBackupFile(value.file)).rejects.toThrow();
    test.expect(value.arrayBuffer).toHaveBeenCalledOnce();
  }
);

test.stable('preserves bytes across base64 conversion chunk boundaries', async () => {
  const bytes = new Uint8Array(16403);

  bytes.set(new TextEncoder().encode('STUDYBK1\n'));
  bytes[8191] = 255;
  bytes[8192] = 128;
  bytes[16384] = 254;
  bytes[16402] = 1;
  const encoded = await encodeBackupFile(artifact(bytes).file);

  test.expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(bytes);
});

test.stable('rejects oversized encoded downloads before decoding or allocating a Blob URL', () => {
  const decode = test.vi.spyOn(globalThis, 'atob');

  test
    .expect(() => downloadBackup('A'.repeat(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 4), 'snapshot'))
    .toThrow();
  test.expect(decode).not.toHaveBeenCalled();
  test.expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test.stable('rejects invalid base64 without creating a Blob URL or download anchor', () => {
  test.expect(() => downloadBackup('%%%invalid', 'snapshot')).toThrow();
  test.expect(URL.createObjectURL).not.toHaveBeenCalled();
  test.expect(document.querySelector('a[download]')).toBeNull();
});
