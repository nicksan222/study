import { useEffect, useState } from "react";
import { releaseFiles } from "../rpc/files";

// A draft owns its staged paths until they are consumed or discarded. Leases keep
// native path reads alive if navigation/unmount happens while an RPC is running.
export class DraftFiles {
  private attached = new Set<string>();
  private retired = new Set<string>();
  private leases = new Map<string, number>();
  private mounted = true;
  constructor(
    private release: (paths: string[]) => Promise<void>,
    private changed: () => void = () => {},
  ) {}
  get paths(): string[] {
    return [...this.attached];
  }
  activate() {
    this.mounted = true;
  }
  async add(paths: string[]): Promise<boolean> {
    if (!this.mounted) {
      for (const path of paths) this.retired.add(path);
      await this.drain();
      return false;
    }
    for (const path of paths) {
      this.attached.add(path);
      this.retired.delete(path);
    }
    this.changed();
    return true;
  }
  async remove(path: string) {
    await this.discard([path]);
  }
  async discard(paths = this.paths) {
    for (const path of paths) {
      this.attached.delete(path);
      this.retired.add(path);
    }
    if (this.mounted) this.changed();
    await this.drain();
  }
  retain(paths = this.paths) {
    const snapshot = [...new Set(paths)];
    let finished = false;
    for (const path of snapshot)
      this.leases.set(path, (this.leases.get(path) ?? 0) + 1);
    return {
      paths: snapshot,
      finish: async (consumed: string[]) => {
        if (finished) return;
        finished = true;
        const committed = new Set(consumed);
        for (const path of snapshot) {
          if (committed.has(path) || !this.mounted) {
            this.attached.delete(path);
            this.retired.add(path);
          }
          const count = (this.leases.get(path) ?? 1) - 1;
          if (count) this.leases.set(path, count);
          else this.leases.delete(path);
        }
        if (this.mounted) this.changed();
        await this.drain();
      },
    };
  }
  async dispose() {
    this.mounted = false;
    for (const path of this.attached) this.retired.add(path);
    this.attached.clear();
    await this.drain();
  }
  private async drain() {
    const ready = [...this.retired].filter((path) => !this.leases.has(path));
    if (!ready.length) return;
    for (const path of ready) this.retired.delete(path);
    try {
      await this.release(ready);
    } catch (error) {
      for (const path of ready) this.retired.add(path);
      throw error;
    }
  }
}
export function useDraftFiles() {
  const [, refresh] = useState(0);
  const [draft] = useState(
    () => new DraftFiles(releaseFiles, () => refresh((value) => value + 1)),
  );
  useEffect(() => {
    draft.activate();
    return () => {
      // Native's owned TempDir is the final cleanup fallback if teardown release fails.
      void draft.dispose().catch(() => {});
    };
  }, [draft]);
  return draft;
}
