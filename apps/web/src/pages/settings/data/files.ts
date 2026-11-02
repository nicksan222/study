import { MAX_BACKUP_BYTES } from '@study/contracts/system/backups';

export const MAX_ARTIFACT_BYTES = MAX_BACKUP_BYTES + 16384;
export async function encodeBackupFile(file: File): Promise<string> {
  if (file.size < 1 || file.size > MAX_ARTIFACT_BYTES) throw new Error('size');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length > MAX_ARTIFACT_BYTES) throw new Error('size');
  const magic = new TextEncoder().encode('STUDYBK1\n');
  if (!magic.every((byte, index) => bytes[index] === byte)) throw new Error('format');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function downloadBackup(encoded: string, id: string) {
  if (encoded.length > Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4) throw new Error('size');
  const binary = atob(encoded);
  if (binary.length > MAX_ARTIFACT_BYTES) throw new Error('size');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `${id}.studybackup`;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to acquire the Blob; this survives section unmount.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
