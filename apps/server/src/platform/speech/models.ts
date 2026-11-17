/** @file Explicit, bounded and integrity-checked acquisition of the two fixed speech assets. */
import { StudyError } from '@study/contracts';
import { CryptoHasher } from 'bun';
import type { FileSystem } from 'effect';

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
      this.ready = true;

      for (const [index, item] of this.assets.entries()) {
        const file = Bun.file(this.path(index));

        if (
          !(await file.exists()) ||
          file.size !== item.size ||
          (await digest(file)) !== item.sha256
        ) {
          this.ready = false;
          break;
        }
      }
    })().catch((cause: unknown) => {
      this.initialized = undefined;
      this.ready = false;

      throw cause;
    }));
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
      await runFileSystemPromise(this.fs.rename(staging, `${this.root}/ready`));
      this.ready = true;
    } finally {
      this.downloading = false;
      this.downloaded = 0;
      await runFileSystemPromise(this.fs.remove(staging, { recursive: true, force: true }));
    }
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

    this.ready = false;
    this.downloaded = 0;
    await runFileSystemPromise(
      this.fs.remove(`${this.root}/ready`, { recursive: true, force: true })
    );
  }
}
