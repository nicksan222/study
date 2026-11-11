import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { join } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

// ONNX Runtime 1.30.0 publishes this layout; reject upstream changes before removing binaries.
const targets: Record<string, string[]> = {
  linux: ['arm64', 'x64'],
  darwin: ['arm64'],
  win32: ['arm64', 'x64']
};

async function validateArchitectures(root: string, platform: string) {
  const architectures = await Effect.runPromise(fs.readDirectory(join(root, platform)));

  if (architectures.length !== targets[platform]!.length)
    throw new Error(`Unexpected ONNX architecture layout: ${platform}`);

  for (const arch of architectures) {
    if (
      !targets[platform]!.includes(arch) ||
      (await Effect.runPromise(fs.lstat(join(root, platform, arch)))).type !== 'Directory'
    )
      throw new Error(`Unexpected ONNX architecture layout: ${platform}`);

    if (
      (await Effect.runPromise(fs.stat(join(root, platform, arch, 'onnxruntime_binding.node'))))
        .type !== 'File'
    )
      throw new Error(`Missing ONNX binding: ${platform}/${arch}`);
  }
}

async function validateLayout(root: string) {
  const platforms = await Effect.runPromise(fs.readDirectory(root));

  if (platforms.length !== Object.keys(targets).length)
    throw new Error('Unexpected ONNX platform layout');

  for (const platform of platforms) {
    if (
      !targets[platform] ||
      (await Effect.runPromise(fs.lstat(join(root, platform)))).type !== 'Directory'
    )
      throw new Error('Unexpected ONNX platform layout');

    await validateArchitectures(root, platform);
  }

  return platforms;
}

export async function pruneOnnx(root: string, platform: string, arch: string) {
  if (!targets[platform]?.includes(arch))
    throw new Error(`Unsupported ONNX target: ${platform}/${arch}`);

  const platforms = await validateLayout(root);

  for (const entry of platforms.filter((item) => item !== platform))
    await Effect.runPromise(fs.remove(join(root, entry), { recursive: true }));

  for (const item of targets[platform].filter((name) => name !== arch))
    await Effect.runPromise(fs.remove(join(root, platform, item), { recursive: true }));
}
