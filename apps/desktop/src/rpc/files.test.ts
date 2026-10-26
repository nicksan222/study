import { beforeEach, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { releaseFiles, stageFiles } from "./files";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});
const file = (name: string) =>
  ({ name, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }) as File;
it("releases completed stages after a later staging failure and preserves the structured error", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "stage_file") {
      if ((args as { name: string }).name === "second.png")
        throw { code: Code.ResourceExhausted, message: "Budget exceeded" };
      return "/private/stage-first";
    }
    return undefined;
  });
  await expect(
    stageFiles([file("first.png"), file("second.png")]),
  ).rejects.toMatchObject({ code: Code.ResourceExhausted });
  expect(invoke).toHaveBeenLastCalledWith("release_files", {
    paths: ["/private/stage-first"],
  });
});
it("normalizes release errors and deduplicates paths without classifying external paths itself", async () => {
  vi.mocked(invoke).mockRejectedValue({
    code: Code.PermissionDenied,
    message: "Cannot release",
  });
  await expect(
    releaseFiles(["/private/a", "/external/lecture.pdf", "/private/a"]),
  ).rejects.toBeInstanceOf(ConnectError);
  expect(invoke).toHaveBeenCalledWith("release_files", {
    paths: ["/private/a", "/external/lecture.pdf"],
  });
});
it("releases browser uploads through the real bounded endpoint with fixture identity", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  localStorage.setItem("study.fixture-session", "fixture-123");
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 204 }));
  await releaseFiles(["/fixture/upload", "/fixture/upload"]);
  expect(request).toHaveBeenCalledWith(
    "/rpc/__study/files",
    expect.objectContaining({
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-study-session": "fixture-123",
      },
      body: JSON.stringify({ paths: ["/fixture/upload"] }),
    }),
  );
  expect(invoke).not.toHaveBeenCalled();
  request.mockRestore();
  localStorage.removeItem("study.fixture-session");
});
it("normalizes classified browser cleanup rejection instead of pretending it succeeded", async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        code: Code.PermissionDenied,
        message: "Wrong session",
      }),
      { status: 403 },
    ),
  );
  await expect(releaseFiles(["/fixture/upload"])).rejects.toMatchObject({
    code: Code.PermissionDenied,
  });
  request.mockRestore();
});
