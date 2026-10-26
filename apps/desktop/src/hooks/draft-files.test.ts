import { expect, it, vi } from "vitest";
import { DraftFiles } from "./draft-files";
it("retains a failed send for retry, then releases exactly the successful snapshot", async () => {
  const release = vi.fn(async (_paths: string[]) => {});
  const draft = new DraftFiles(release);
  await draft.add(["/stage/a"]);
  const first = draft.retain();
  await draft.add(["/stage/b"]);
  await first.finish([]);
  expect(draft.paths).toEqual(["/stage/a", "/stage/b"]);
  expect(release).not.toHaveBeenCalled();
  const retry = draft.retain(["/stage/a"]);
  await retry.finish(retry.paths);
  expect(draft.paths).toEqual(["/stage/b"]);
  expect(release).toHaveBeenCalledWith(["/stage/a"]);
});
it("defers removal and unmount cleanup until an in-flight post finishes", async () => {
  const release = vi.fn(async (_paths: string[]) => {});
  const draft = new DraftFiles(release);
  await draft.add(["/stage/used", "/stage/unused"]);
  const sending = draft.retain(["/stage/used"]);
  await draft.remove("/stage/used");
  expect(release).not.toHaveBeenCalled();
  await draft.dispose();
  expect(release).toHaveBeenCalledWith(["/stage/unused"]);
  expect(release).not.toHaveBeenCalledWith(["/stage/used"]);
  await sending.finish([]);
  expect(release).toHaveBeenLastCalledWith(["/stage/used"]);
});
it("cleans paths returned by staging after their component unmounted", async () => {
  const release = vi.fn(async (_paths: string[]) => {});
  const draft = new DraftFiles(release);
  await draft.dispose();
  expect(await draft.add(["/late-stage"])).toBe(false);
  expect(release).toHaveBeenCalledWith(["/late-stage"]);
  expect(draft.paths).toEqual([]);
});
it("partial bulk import releases successes and retains failures for retry", async () => {
  const release = vi.fn(async (_paths: string[]) => {});
  const draft = new DraftFiles(release);
  await draft.add(["/stage/good", "/stage/bad"]);
  const importing = draft.retain();
  await importing.finish(["/stage/good"]);
  expect(draft.paths).toEqual(["/stage/bad"]);
  expect(release).toHaveBeenCalledWith(["/stage/good"]);
  await draft.remove("/stage/bad");
  expect(release).toHaveBeenLastCalledWith(["/stage/bad"]);
});
