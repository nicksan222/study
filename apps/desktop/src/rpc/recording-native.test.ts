import { beforeEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { rpc } from "./client";
import {
  startRecording,
  stopRecording,
  sendRecording,
  discardRecording,
  acknowledgeRecording,
} from "./native";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(), invoke: vi.fn() }));
vi.mock("./client", () => ({
  rpc: { recording: vi.fn(), postRecording: vi.fn(), deleteRecording: vi.fn() },
  normalizeRpcError: (error: Error) => error,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(false);
});
it("unfinished browser consumers post to the saved owner rather than a route and discard through typed RPC", async () => {
  vi.mocked(rpc.recording).mockResolvedValue({
    value: { id: { value: 30n }, sessionId: { value: 10n }, samples: 16_000n },
  } as never);
  await sendRecording("30");
  expect(rpc.postRecording).toHaveBeenCalledWith(
    expect.objectContaining({
      session: { value: 10n },
      recording: { value: 30n },
    }),
  );
  expect(invoke).not.toHaveBeenCalled();
  await discardRecording("30");
  expect(rpc.deleteRecording).toHaveBeenCalledWith({ value: 30n });
});
it("native consumers use the complete owned lifecycle commands", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  await startRecording({ sessionId: "10", projectId: "1" });
  await stopRecording();
  await sendRecording("30");
  await discardRecording("31");
  await acknowledgeRecording("9");
  expect(vi.mocked(invoke).mock.calls).toEqual([
    ["recording_start", { sessionId: "10", recordingId: undefined }],
    ["recording_stop", undefined],
    ["recording_send", { recordingId: "30" }],
    ["recording_discard", { recordingId: "31" }],
    ["recording_ack", { through: "9" }],
  ]);
  expect(rpc.postRecording).not.toHaveBeenCalled();
  expect(rpc.deleteRecording).not.toHaveBeenCalled();
});
