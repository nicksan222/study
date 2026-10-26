import { normalizeRpcError, rpc } from "./client";
import { useQuery } from "@tanstack/react-query";
import { stageFiles } from "./files";
import { catalogs } from "../generated/catalog";
import { invoke, isTauri } from "@tauri-apps/api/core";

export async function pickFiles(): Promise<string[]> {
  if (isTauri()) return invoke<string[]>("pick_files");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.oncancel = () => resolve([]);
    input.onchange = async () => {
      try {
        if (!input.files?.length) return resolve([]);
        resolve(await stageFiles(input.files));
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}
export async function saveFile(
  name: string,
  bytes: Uint8Array,
  mime = "application/octet-stream",
) {
  if (isTauri())
    return invoke("save_file", { defaultName: name, bytes: Array.from(bytes) });
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: mime }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url))
    throw new Error(
      catalogs[document.documentElement.lang === "it" ? "italian" : "english"]
        .ActionError,
    );
  if (isTauri()) {
    try {
      await invoke("open_external", { url });
    } catch (error) {
      throw normalizeRpcError(error);
    }
  } else window.open(url, "_blank", "noopener,noreferrer");
}
export type RecordingPhase =
  | "idle"
  | "starting"
  | "live"
  | "stopping"
  | "posting"
  | "sending"
  | "discarding";
export type RecordingOutcome =
  | "posted"
  | "empty"
  | "full"
  | "failed"
  | "save_failed"
  | "microphone_failed"
  | "discarded";
export type RecordingEvent = {
  id: string;
  kind: RecordingOutcome;
  recordingId: string | null;
  sessionId: string | null;
  projectId: string | null;
  diagnostic: string | null;
};
export type RecordingStatus = {
  revision: string;
  phase: RecordingPhase;
  recordingId: string | null;
  sessionId: string | null;
  projectId: string | null;
  seconds: number;
  level: number;
  ended: boolean;
  events: RecordingEvent[];
};
export type RecordingTarget = {
  sessionId: string;
  projectId?: string;
  recordingId?: string;
};
async function recordingCommand(
  command: string,
  args?: Record<string, unknown>,
) {
  if (!isTauri())
    throw new Error(
      catalogs[document.documentElement.lang === "it" ? "italian" : "english"]
        .RecordingDesktopOnly,
    );
  try {
    return await invoke<RecordingStatus>(command, args);
  } catch (error) {
    throw normalizeRpcError(error);
  }
}
export function startRecording(target: RecordingTarget) {
  return recordingCommand("recording_start", {
    sessionId: target.sessionId,
    recordingId: target.recordingId,
  });
}
export function stopRecording() {
  return recordingCommand("recording_stop");
}
export async function sendRecording(recordingId: string) {
  if (isTauri()) return recordingCommand("recording_send", { recordingId });
  const { value } = await rpc.recording({ value: BigInt(recordingId) });
  if (value)
    await rpc.postRecording({
      recording: value.id,
      session: value.sessionId,
      name: catalogs[
        document.documentElement.lang === "it" ? "italian" : "english"
      ].RecordingSessionTitle,
    });
}
export async function discardRecording(recordingId: string) {
  if (isTauri()) return recordingCommand("recording_discard", { recordingId });
  await rpc.deleteRecording({ value: BigInt(recordingId) });
}
export function acknowledgeRecording(through: string) {
  return recordingCommand("recording_ack", { through });
}
export function useRecordingStatus() {
  return useQuery({
    queryKey: ["native-recording"],
    queryFn: () => recordingCommand("recording_status"),
    enabled: isTauri(),
    refetchInterval: 250,
  });
}
