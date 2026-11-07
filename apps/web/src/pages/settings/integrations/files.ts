import { MAX_INTEGRATION_BYTES } from '@study/contracts/integrations/schemas';

/** Read only visible vault files and bound memory before loading any content. */
export async function vaultFiles(selection: readonly File[]) {
  const sourceKey = selection[0]?.webkitRelativePath.split('/')[0];

  if (!sourceKey) throw new Error('Invalid vault selection');

  const files = selection
    .map((file) => ({ file, path: file.webkitRelativePath.slice(sourceKey.length + 1) }))
    .filter(({ path }) => path && !path.split('/').some((part) => part.startsWith('.')));

  if (
    !files.length ||
    files.length > 10000 ||
    files.reduce((size, { file }) => size + file.size, 0) > MAX_INTEGRATION_BYTES
  )
    throw new Error('Vault exceeds transfer limit');

  const encoded: { path: string; content: string }[] = [];

  for (let offset = 0; offset < files.length; offset += 4) {
    const batch = await Promise.all(
      files.slice(offset, offset + 4).map(async ({ file, path }) => {
        const bytes = new Uint8Array(await file.arrayBuffer());

        if (bytes.length !== file.size) throw new Error('Vault file changed during read');

        let binary = '';

        for (let start = 0; start < bytes.length; start += 8192)
          binary += String.fromCharCode(...bytes.subarray(start, start + 8192));

        return { path, content: btoa(binary) };
      })
    );

    encoded.push(...batch);
  }

  return { sourceKey, files: encoded };
}
