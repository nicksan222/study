import { test } from '@study/testing';

import { downloadBackup, encodeBackupFile, MAX_ARTIFACT_BYTES } from './files';

function artifact({ vi }: Pick<test.Context, 'vi'>, bytes: Uint8Array, size = bytes.length) {
  const file = new File([Uint8Array.from(bytes).buffer], 'fixture.studybackup');
  const arrayBuffer = vi.fn(async () => Uint8Array.from(bytes).buffer);

  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });

  return { file, arrayBuffer };
}

test.beforeEach(({ vi }) => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
});
test.afterEach(({ vi }) => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test.stable(
  'bounds file size before reading and rejects a different encoding',
  async ({ expect, vi }) => {
    const oversized = artifact({ vi }, new Uint8Array(), MAX_ARTIFACT_BYTES + 1);

    await expect(encodeBackupFile(oversized.file)).rejects.toThrow();
    expect(oversized.arrayBuffer).not.toHaveBeenCalled();
    const empty = artifact({ vi }, new Uint8Array());

    await expect(encodeBackupFile(empty.file)).rejects.toThrow();
    expect(empty.arrayBuffer).not.toHaveBeenCalled();
    const wrongFormat = artifact({ vi }, new TextEncoder().encode('not a Study artifact'));

    await expect(encodeBackupFile(wrongFormat.file)).rejects.toThrow();
  }
);

test.stable(
  'transports the binary artifact as base64 without converting it to JSON or text',
  async ({ expect, vi }) => {
    const bytes = new Uint8Array([...new TextEncoder().encode('STUDYBK1\n'), 0, 255, 128, 3]);
    const encoded = await encodeBackupFile(artifact({ vi }, bytes).file);

    expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(bytes);
  }
);

test.stable(
  'downloads exact binary bytes with an explicit filename and delayed Blob cleanup',
  async ({ vi, expect }) => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      expect(this.download).toBe('snapshot.studybackup');
      expect(this.href).toBe('blob:backup');
      expect(this.isConnected).toBe(true);
    });
    const binary = 'STUDYBK1\n\x00\xff\x80';

    downloadBackup(btoa(binary), 'snapshot');
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:backup');
    vi.useRealTimers();
    const blob = create.mock.calls[0]![0] as Blob;

    expect(blob).toBeInstanceOf(Blob);
    const transported = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    expect(transported).toBe(`data:application/octet-stream;base64,${btoa(binary)}`);
  }
);

test.stable('cleans up even when download dispatch fails', ({ vi, expect }) => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => downloadBackup(btoa('data'), 'snapshot')).toThrow();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledWith('blob:backup');
  expect(document.querySelector('a[download]')).toBeNull();
});

test.stable.for([1, -1])(
  'rejects file byte-count mismatch (%s) after reading',
  async (difference, { expect, vi }) => {
    const bytes = new TextEncoder().encode('STUDYBK1\nexample');
    const value = artifact({ vi }, bytes, bytes.length + difference);

    await expect(encodeBackupFile(value.file)).rejects.toThrow();
    expect(value.arrayBuffer).toHaveBeenCalledOnce();
  }
);

test.stable(
  'allows the exact declared size boundary to be read but still validates actual length',
  async ({ expect, vi }) => {
    const value = artifact({ vi }, new TextEncoder().encode('STUDYBK1\n'), MAX_ARTIFACT_BYTES);

    await expect(encodeBackupFile(value.file)).rejects.toThrow();
    expect(value.arrayBuffer).toHaveBeenCalledOnce();
  }
);

test.stable('preserves bytes across base64 conversion chunk boundaries', async ({ expect, vi }) => {
  const bytes = new Uint8Array(16403);

  bytes.set(new TextEncoder().encode('STUDYBK1\n'));
  bytes[8191] = 255;
  bytes[8192] = 128;
  bytes[16384] = 254;
  bytes[16402] = 1;
  const encoded = await encodeBackupFile(artifact({ vi }, bytes).file);

  expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(bytes);
});

test.stable(
  'rejects oversized encoded downloads before decoding or allocating a Blob URL',
  ({ vi, expect }) => {
    const decode = vi.spyOn(globalThis, 'atob');

    expect(() =>
      downloadBackup('A'.repeat(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 4), 'snapshot')
    ).toThrow();
    expect(decode).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  }
);

test.stable(
  'rejects invalid base64 without creating a Blob URL or download anchor',
  ({ expect }) => {
    expect(() => downloadBackup('%%%invalid', 'snapshot')).toThrow();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
  }
);
