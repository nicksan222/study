import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { pruneOnnx } from './prune-onnx';

test('keeps the selected target and its companions, rejecting unknown layouts before deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'onnx-prune-'));
  try {
    for (const target of ['linux/x64', 'linux/arm64', 'darwin/arm64', 'win32/x64', 'win32/arm64']) {
      await mkdir(join(root, target), { recursive: true });
      await writeFile(join(root, target, 'onnxruntime_binding.node'), target);
      await writeFile(join(root, target, 'companion'), target);
    }
    await mkdir(join(root, 'unknown'));
    await expect(pruneOnnx(root, 'linux', 'arm64')).rejects.toThrow();
    expect((await readdir(join(root, 'linux'))).sort()).toEqual(['arm64', 'x64']);
    await rm(join(root, 'unknown'), { recursive: true });
    await expect(pruneOnnx(root, 'darwin', 'x64')).rejects.toThrow();
    await pruneOnnx(root, 'linux', 'arm64');
    expect(await readdir(root)).toEqual(['linux']);
    expect((await readdir(join(root, 'linux', 'arm64'))).sort()).toEqual([
      'companion',
      'onnxruntime_binding.node'
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
