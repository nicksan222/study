/** @file Explicit, bounded and integrity-checked acquisition of a speech model's assets. */
import { StudyError } from '@study/contracts';
import { CryptoHasher } from 'bun';
import type { FileSystem } from 'effect';

import { normalizeError } from '#server/platform/errors/classify-error';
import { runFileSystemPromise } from '#server/platform/filesystem/index';

export interface SpeechAsset {
  readonly filename: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

async function digest(file: Bun.BunFile) {
  const hash = new CryptoHasher('sha256');

  for await (const chunk of file.stream()) hash.update(chunk);

  return hash.digest('hex');
}

function installationCleanupError(failure: unknown, cleanup: unknown) {
  const original = normalizeError(failure);
  const cause = new AggregateError([original, cleanup]);

  if (original.kind === 'cancelled')
    return new StudyError('internal', 'Could not remove partial speech model files', { cause });

  return new StudyError(original.kind, original.message, {
    cause,
    retryAfterMs: original.retryAfterMs,
    resource: original.resource
  });
}

export class VoiceModels {
  private initialized?: Promise<void>;
  private ready = false;
  private downloading = false;
  private downloaded = 0;
  readonly totalBytes: number;

  readonly root: string;
  private readonly fs: FileSystem.FileSystem;
  private readonly assets: readonly SpeechAsset[];
  private readonly request: (url: string, options?: RequestInit) => Promise<Response>;

  constructor(
    root: string,
    fs: FileSystem.FileSystem,
    assets: readonly SpeechAsset[],
    request: (url: string, options?: RequestInit) => Promise<Response> = fetch
  ) {
    this.root = root;
    this.fs = fs;
    this.assets = assets;
    this.request = request;
    this.totalBytes = assets.reduce((sum, item) => sum + item.size, 0);
  }

  path(index: number) {
    return `${this.root}/ready/${this.assets[index]!.filename}`;
  }

  private initialize() {
    return (this.initialized ??= (async () => {
      await runFileSystemPromise(
        this.fs.remove(`${this.root}/installing`, { recursive: true, force: true })
      );
      this.ready = await this.verifyAssets();
    })().catch((cause: unknown) => {
      this.initialized = undefined;
      this.ready = false;

      throw cause;
    }));
  }

  private async verifyAssets() {
    for (const [index, item] of this.assets.entries()) {
      const file = Bun.file(this.path(index));

      if (!(await file.exists()) || file.size !== item.size || (await digest(file)) !== item.sha256)
        return false;
    }

    return true;
  }

  async status() {
    await this.initialize();

    return {
      state: this.downloading
        ? ('downloading' as const)
        : this.ready
          ? ('ready' as const)
          : ('missing' as const),
      downloadedBytes: this.ready ? this.totalBytes : this.downloaded,
      totalBytes: this.totalBytes
    };
  }

  async install(signal: AbortSignal) {
    await this.initialize();

    if (this.ready) return;

    if (this.downloading)
      throw new StudyError('invalid_input', 'Speech model installation is already running');

    this.downloading = true;
    this.downloaded = 0;
    const staging = `${this.root}/installing`;

    try {
      await runFileSystemPromise(this.fs.makeDirectory(staging, { recursive: true }));

      for (const item of this.assets) {
        signal.throwIfAborted();
        await this.downloadAsset(item, staging, signal);
      }

      signal.throwIfAborted();
      await runFileSystemPromise(
        this.fs.remove(`${this.root}/ready`, { recursive: true, force: true })
      );
      signal.throwIfAborted();
      await runFileSystemPromise(this.fs.rename(staging, `${this.root}/ready`));
      this.ready = true;
    } catch (cause) {
      await this.rejectInstall(staging, signal, cause);
    } finally {
      this.downloading = false;
      this.downloaded = 0;
    }
  }

  private async rejectInstall(
    staging: string,
    signal: AbortSignal,
    cause: unknown
  ): Promise<never> {
    const failure = signal.aborted
      ? new StudyError('cancelled', 'Speech model installation was cancelled', { cause })
      : cause;

    try {
      await runFileSystemPromise(this.fs.remove(staging, { recursive: true, force: true }));
    } catch (cleanup) {
      this.initialized = undefined;

      throw installationCleanupError(failure, cleanup);
    }

    throw failure;
  }

  private async downloadAsset(item: SpeechAsset, staging: string, signal: AbortSignal) {
    const response = await this.request(item.url, { signal });

    if (!response.ok || !response.body)
      throw new StudyError('transient', 'Speech model download failed');

    const writer = Bun.file(`${staging}/${item.filename}`).writer();
    const hash = new CryptoHasher('sha256');
    let size = 0;

    try {
      for await (const bytes of response.body) {
        signal.throwIfAborted();
        size += bytes.length;

        if (size > item.size)
          throw new StudyError('invalid_input', 'Speech model exceeds its expected size');

        hash.update(bytes);
        writer.write(bytes);
        await writer.flush();
        this.downloaded += bytes.length;
      }
    } finally {
      await writer.end();
    }

    if (size !== item.size || hash.digest('hex') !== item.sha256)
      throw new StudyError('invalid_input', 'Speech model integrity check failed');
  }

  async remove() {
    await this.initialize();

    if (this.downloading)
      throw new StudyError('invalid_input', 'Cancel speech model installation before removing it');

    const wasReady = this.ready;

    this.ready = false;
    this.downloaded = 0;

    try {
      await runFileSystemPromise(
        this.fs.remove(`${this.root}/ready`, { recursive: true, force: true })
      );
    } catch (cause) {
      this.ready = wasReady && (await this.verifyAssets().catch(() => false));

      throw cause;
    }
  }
}
