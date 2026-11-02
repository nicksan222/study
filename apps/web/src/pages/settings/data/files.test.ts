import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import { downloadBackup, encodeBackupFile, MAX_ARTIFACT_BYTES } from './files';
function artifact(bytes: Uint8Array, size = bytes.length) {
  const file = new File([Uint8Array.from(bytes).buffer], 'fixture.studybackup');
  const arrayBuffer = vi.fn(async () => Uint8Array.from(bytes).buffer);
  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
  return { file, arrayBuffer };
}
beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('bounds file size before reading and rejects a different encoding', async () => {
  const oversized = artifact(new Uint8Array(), MAX_ARTIFACT_BYTES + 1);
  await expect(encodeBackupFile(oversized.file)).rejects.toThrow();
  expect(oversized.arrayBuffer).not.toHaveBeenCalled();
  const empty = artifact(new Uint8Array());
  await expect(encodeBackupFile(empty.file)).rejects.toThrow();
  expect(empty.arrayBuffer).not.toHaveBeenCalled();
  const wrongFormat = artifact(new TextEncoder().encode('not a Study artifact'));
  await expect(encodeBackupFile(wrongFormat.file)).rejects.toThrow();
});
it('transports the binary artifact as base64 without converting it to JSON or text', async () => {
  const bytes = new Uint8Array([...new TextEncoder().encode('STUDYBK1\n'), 0, 255, 128, 3]);
  const encoded = await encodeBackupFile(artifact(bytes).file);
  expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(bytes);
});
it('downloads exact binary bytes with an explicit filename and delayed Blob cleanup', async () => {
  vi.useFakeTimers();
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
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
  const blob = create.mock.calls[0]![0];
  expect(blob).toBeInstanceOf(Blob);
  const transported = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  expect(transported).toBe(`data:application/octet-stream;base64,${btoa(binary)}`);
});
it('cleans up even when download dispatch fails', () => {
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


it.each([1, -1])('rejects file byte-count mismatch (%s) after reading', async (difference) => {
  const bytes = new TextEncoder().encode('STUDYBK1\nexample');
  const value = artifact(bytes, bytes.length + difference);
  await expect(encodeBackupFile(value.file)).rejects.toThrow();
  expect(value.arrayBuffer).toHaveBeenCalledOnce();
});

it('allows the exact declared size boundary to be read but still validates actual length', async () => {
  const value = artifact(new TextEncoder().encode('STUDYBK1\n'), MAX_ARTIFACT_BYTES);
  await expect(encodeBackupFile(value.file)).rejects.toThrow();
  expect(value.arrayBuffer).toHaveBeenCalledOnce();
});

it('preserves bytes across base64 conversion chunk boundaries', async () => {
  const bytes = new Uint8Array(16403);
  bytes.set(new TextEncoder().encode('STUDYBK1\n'));
  bytes[8191] = 255;
  bytes[8192] = 128;
  bytes[16384] = 254;
  bytes[16402] = 1;
  const encoded = await encodeBackupFile(artifact(bytes).file);
  expect(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))).toEqual(bytes);
});

it('rejects oversized encoded downloads before decoding or allocating a Blob URL', () => {
  const decode = vi.spyOn(globalThis, 'atob');
  expect(() => downloadBackup('A'.repeat(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 4), 'snapshot')).toThrow();
  expect(decode).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('rejects invalid base64 without creating a Blob URL or download anchor', () => {
  expect(() => downloadBackup('%%%invalid', 'snapshot')).toThrow();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(document.querySelector('a[download]')).toBeNull();
});
