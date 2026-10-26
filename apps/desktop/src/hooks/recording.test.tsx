import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { create } from "@bufbuild/protobuf";
import { beforeEach, expect, it, vi } from "vitest";
import {
  RecordingController,
  RecordingProvider,
  useRecording,
} from "./recording";
import { type RecordingStatus, type RecordingEvent } from "../rpc/native";
import { renderPage } from "../test/helpers";
import { ProjectsPage } from "../pages/projects";
import { SessionsPage } from "../pages/sessions";
import { rpc } from "../rpc/client";
import { ProjectSchema, ChatSessionSchema } from "../generated/study_pb";
import { catalogs } from "../generated/catalog";
const en = catalogs.english;
vi.mock("../rpc/native", () => ({
  useRecordingStatus: () => ({ data: undefined }),
  pickFiles: vi.fn(),
  openExternal: vi.fn(),
}));
vi.mock("../rpc/files", () => ({
  useNativeDrop: vi.fn(),
  stageFiles: vi.fn(),
  releaseFiles: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));
const status = (
  phase: RecordingStatus["phase"] = "idle",
  revision = 1,
  events: RecordingEvent[] = [],
): RecordingStatus => ({
  revision: String(revision),
  phase,
  recordingId: phase === "idle" ? null : "30",
  sessionId: phase === "idle" ? null : "10",
  projectId: phase === "idle" ? null : "1",
  seconds: 3,
  level: 0.2,
  ended: phase === "idle",
  events,
});
const outcome = (kind: RecordingEvent["kind"], id = "1"): RecordingEvent => ({
  id,
  kind,
  recordingId: "30",
  sessionId: "10",
  projectId: "1",
  diagnostic: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function commands() {
  return {
    start: vi.fn(async () => status("live", 2)),
    stop: vi.fn(async () => status("idle", 3)),
    send: vi.fn(async () => status("idle", 3)),
    discard: vi.fn(async () => status("idle", 3)),
    ack: vi.fn(async () => status("idle", 5)),
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
it("holds session/project ownership from intent until each native operation resolves", async () => {
  for (const action of ["start", "send", "discard"] as const) {
    const api = commands();
    const gate = deferred<RecordingStatus>();
    api[action].mockImplementation(() => gate.promise);
    const controller = new RecordingController(api);
    const operation = controller[action]({
      sessionId: "10",
      projectId: "1",
      recordingId: "30",
    });
    expect(controller.protectsSession("10")).toBe(true);
    expect(controller.protectsProject("1")).toBe(true);
    expect(controller.protectsSession("20")).toBe(false);
    gate.resolve(status("idle", 3));
    await operation;
    expect(controller.busy).toBe(false);
  }
  const api = commands();
  const gate = deferred<RecordingStatus>();
  api.stop.mockImplementation(() => gate.promise);
  const controller = new RecordingController(api);
  controller.observe(status("live", 2));
  const stopped = controller.stop();
  expect(controller.phase).toBe("stopping");
  expect(controller.protectsProject("1")).toBe(true);
  gate.resolve(status("idle", 4));
  await stopped;
  expect(controller.busy).toBe(false);
});
it("ignores out-of-order native snapshots and retains terminal events across another start", async () => {
  const api = commands();
  const controller = new RecordingController(api);
  controller.observe(status("live", 3));
  controller.observe(status("idle", 2));
  expect(controller.phase).toBe("live");
  controller.observe(status("idle", 4, [outcome("failed")]));
  api.start.mockResolvedValue(status("live", 5));
  await controller.start({ sessionId: "20", projectId: "2" });
  expect([...controller.events.values()]).toHaveLength(1);
  expect(api.ack).not.toHaveBeenCalled();
});
it("renders localized global full/failure notices before acknowledgement and keeps them after route changes", async () => {
  const api = commands();
  const controller = new RecordingController(api);
  controller.observe(
    status("idle", 3, [outcome("full"), outcome("failed", "2")]),
  );
  api.ack.mockImplementation(async () => {
    expect(screen.getByText(catalogs.italian.RecordingFull)).toBeVisible();
    expect(screen.getByText(catalogs.italian.RecordingFailed)).toBeVisible();
    return status("idle", 4);
  });
  const view = renderPage(
    <RecordingProvider controller={controller}>
      <div>route A</div>
    </RecordingProvider>,
    "italian",
  );
  await waitFor(() => expect(api.ack).toHaveBeenCalledWith("2"));
  view.rerender(
    <RecordingProvider controller={controller}>
      <div>route B</div>
    </RecordingProvider>,
  );
  expect(screen.getByText(catalogs.italian.RecordingFull)).toBeVisible();
  expect(screen.getByText(catalogs.italian.RecordingFailed)).toBeVisible();
});
it("continues stop/post coordination after the recording page unmounts", async () => {
  const api = commands();
  const gate = deferred<RecordingStatus>();
  api.stop.mockImplementation(() => gate.promise);
  const controller = new RecordingController(api);
  controller.observe(status("live", 2));
  function Route() {
    const recording = useRecording();
    return <button onClick={() => void recording.stop()}>stop in route</button>;
  }
  const view = renderPage(
    <RecordingProvider controller={controller}>
      <Route />
    </RecordingProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "stop in route" }));
  view.rerender(
    <RecordingProvider controller={controller}>
      <div>Settings route</div>
    </RecordingProvider>,
  );
  expect(controller.protectsSession("10")).toBe(true);
  await act(async () => {
    gate.resolve(status("idle", 3, [outcome("posted")]));
    await gate.promise;
  });
  await waitFor(() => expect(controller.busy).toBe(false));
  expect(api.stop).toHaveBeenCalledTimes(1);
});
function fixtures() {
  vi.spyOn(rpc, "projects").mockResolvedValue({
    items: [
      create(ProjectSchema, { id: { value: 1n }, name: "Biology" }),
      create(ProjectSchema, { id: { value: 2n }, name: "Physics" }),
    ],
  } as never);
  vi.spyOn(rpc, "allSessions").mockResolvedValue({
    items: [
      create(ChatSessionSchema, {
        id: { value: 10n },
        projectId: { value: 1n },
        title: "Lecture",
      }),
    ],
  } as never);
  vi.spyOn(rpc, "messages").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rpc, "recordings").mockResolvedValue({ items: [] } as never);
  return {
    deleteProject: vi
      .spyOn(rpc, "deleteProject")
      .mockResolvedValue({ value: true } as never),
    deleteSession: vi
      .spyOn(rpc, "deleteSession")
      .mockResolvedValue({ value: true } as never),
  };
}
it("disables owning session/project deletion in every phase and removes an earlier confirmation", async () => {
  const calls = fixtures();
  const controller = new RecordingController(commands());
  const user = userEvent.setup();
  const view = renderPage(
    <RecordingProvider controller={controller}>
      <ProjectsPage navigate={vi.fn()} />
    </RecordingProvider>,
  );
  await user.click(
    (await screen.findAllByRole("button", { name: en.DeleteProject }))[0],
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () => controller.observe(status("starting", 2)));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const biology = screen.getByText("Biology").closest("section")!;
  const physics = screen.getByText("Physics").closest("section")!;
  expect(
    within(biology).getByRole("button", { name: en.DeleteProject }),
  ).toBeDisabled();
  expect(
    within(physics).getByRole("button", { name: en.DeleteProject }),
  ).toBeEnabled();
  expect(calls.deleteProject).not.toHaveBeenCalled();
  view.rerender(
    <RecordingProvider controller={controller}>
      <SessionsPage selected="10" navigate={vi.fn()} />
    </RecordingProvider>,
  );
  await screen.findByRole("heading", { name: "Lecture" });
  let revision = 3;
  for (const phase of [
    "live",
    "stopping",
    "posting",
    "sending",
    "discarding",
  ] as const) {
    await act(async () => controller.observe(status(phase, revision++)));
    expect(
      screen.getByRole("button", { name: en.DeleteSession }),
    ).toBeDisabled();
  }
  expect(calls.deleteSession).not.toHaveBeenCalled();
});
it("a session confirmation opened before a start cannot delete after ownership changes", async () => {
  const calls = fixtures();
  const controller = new RecordingController(commands());
  const user = userEvent.setup();
  renderPage(
    <RecordingProvider controller={controller}>
      <SessionsPage selected="10" navigate={vi.fn()} />
    </RecordingProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: en.DeleteSession }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  await act(async () => controller.observe(status("starting", 2)));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(calls.deleteSession).not.toHaveBeenCalled();
});
