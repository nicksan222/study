import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  createClient,
  ConnectError,
  Code,
  type Transport,
} from "@connectrpc/connect";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Study } from "../generated/study_pb";

export type EnvelopeTransport = (
  method: string,
  payload: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array>;
export const sendEnvelope: EnvelopeTransport = async (
  method,
  payload,
  signal,
) => {
  if (isTauri()) {
    try {
      return Uint8Array.from(
        await invoke<number[]>("rpc", { method, payload: Array.from(payload) }),
      );
    } catch (error) {
      throw normalizeRpcError(error);
    }
  }
  const response = await fetch(`/rpc/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/protobuf",
      ...(localStorage.getItem("study.fixture-session")
        ? { "x-study-session": localStorage.getItem("study.fixture-session")! }
        : {}),
    },
    body: new Uint8Array(payload),
    signal,
  });
  if (!response.ok) {
    throw normalizeRpcError(await response.json());
  }
  return new Uint8Array(await response.arrayBuffer());
};
export function createStudyClient(send: EnvelopeTransport = sendEnvelope) {
  const transport: Transport = {
    async unary(method, signal, _timeoutMs, _headers, input) {
      const payload = toBinary(method.input, create(method.input, input));
      const result = await send(
        `${method.parent.typeName}/${method.name}`,
        payload,
        signal,
      );
      return {
        stream: false,
        service: method.parent,
        method,
        header: new Headers(),
        trailer: new Headers(),
        message: fromBinary(method.output, result),
      };
    },
    async stream() {
      throw new ConnectError(
        "Streaming is delivered as refresh hints by the shell.",
        Code.Unimplemented,
      );
    },
  };
  return createClient(Study, transport);
}
export const rpc = createStudyClient();

export function normalizeRpcError(value: unknown): ConnectError {
  if (value instanceof ConnectError) return value;
  const raw =
    value && typeof value === "object"
      ? (value as { code?: number; message?: string; details?: number[] })
      : undefined;
  const error = new ConnectError(
    raw?.message ?? (value instanceof Error ? value.message : String(value)),
    raw?.code ?? Code.Unknown,
  );
  if (raw?.details?.length)
    error.details.push({
      type: "study.v1.ErrorDetails",
      value: Uint8Array.from(raw.details),
    });
  return error;
}
