import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

// ONNX Runtime 1.30.0 publishes this layout; reject upstream changes before removing binaries.
const targets: Record<string, string[]> = {
  linux: ['arm64', 'x64'],
  darwin: ['arm64'],
  win32: ['arm64', 'x64']
};

export async function pruneOnnx(root: string, platform: string, arch: string) {
  if (!targets[platform]?.includes(arch))
    throw new Error(`Unsupported ONNX target: ${platform}/${arch}`);

  const platforms = await readdir(root, { withFileTypes: true });

  if (
    platforms.length !== Object.keys(targets).length ||
    platforms.some((entry) => !entry.isDirectory() || !targets[entry.name])
  )
    throw new Error('Unexpected ONNX platform layout');

  for (const entry of platforms) {
    const architectures = await readdir(join(root, entry.name), { withFileTypes: true });

    if (
      architectures.length !== targets[entry.name].length ||
      architectures.some((item) => !item.isDirectory() || !targets[entry.name].includes(item.name))
    )
      throw new Error(`Unexpected ONNX architecture layout: ${entry.name}`);

    for (const item of architectures) {
      if (!(await stat(join(root, entry.name, item.name, 'onnxruntime_binding.node'))).isFile())
        throw new Error(`Missing ONNX binding: ${entry.name}/${item.name}`);
    }
  }

  for (const entry of platforms.filter((item) => item.name !== platform))
    await rm(join(root, entry.name), { recursive: true });

  for (const item of targets[platform].filter((name) => name !== arch))
    await rm(join(root, platform, item), { recursive: true });
}
