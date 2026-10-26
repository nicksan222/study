import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { ConnectError, Code } from "@connectrpc/connect";
import { createStudyClient, normalizeRpcError } from "./client";
import {
  ProjectSchema,
  CreateProjectRequestSchema,
  ErrorDetailsSchema,
  ErrorKind,
} from "../generated/study_pb";
import { describe, it, expect, vi } from "vitest";
describe("canonical protobuf consumer", () => {
  it("serializes request, preserves typed int64 IDs, decodes real protobuf response", async () => {
    const send = vi.fn(async (method: string, payload: Uint8Array) => {
      expect(method).toBe("study.v1.Study/CreateProject");
      expect(fromBinary(CreateProjectRequestSchema, payload).name).toBe(
        "Biology",
      );
      return toBinary(
        ProjectSchema,
        create(ProjectSchema, {
          id: { value: 9007199254740993n },
          name: "Biology",
        }),
      );
    });
    const client = createStudyClient(send);
    const project = await client.createProject({ name: "Biology" });
    expect(project.id?.value).toBe(9007199254740993n);
    expect(project.name).toBe("Biology");
  });
  it("rejects malformed protobuf rather than exposing parallel JSON data", async () => {
    const client = createStudyClient(async () => new Uint8Array([255]));
    await expect(client.projects({})).rejects.toThrow();
  });
  it("normalizes native structured status while retaining canonical error details", () => {
    const details = toBinary(
      ErrorDetailsSchema,
      create(ErrorDetailsSchema, {
        kind: ErrorKind.INVALID_INPUT,
        message: "Bad input",
      }),
    );
    const error = normalizeRpcError({
      code: Code.InvalidArgument,
      message: "Bad input",
      details: Array.from(details),
    });
    expect(error).toBeInstanceOf(ConnectError);
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.findDetails(ErrorDetailsSchema)[0].kind).toBe(
      ErrorKind.INVALID_INPUT,
    );
  });
});
