import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, expect, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { rpc } from "../rpc/client";
import {
  SourceSchema,
  DocumentSchema,
  PreviewSchema,
  ChatMessageSchema,
  JobStatus,
  MessageStatus,
  MessageRole,
  SessionIdSchema,
} from "../generated/study_pb";
import { SourceDetail } from "./library";
import { Composer, MessageView } from "./sessions";
import { SessionDraftProvider } from "../hooks/session-drafts";
import { pickFiles } from "../rpc/native";
import { releaseFiles } from "../rpc/files";
import { renderPage } from "../test/helpers";
import { catalogs } from "../generated/catalog";
const en = catalogs.english;
vi.mock("../rpc/native", () => ({ pickFiles: vi.fn(), openExternal: vi.fn() }));
vi.mock("../rpc/files", () => ({
  releaseFiles: vi.fn(async () => {}),
  useNativeDrop: vi.fn(),
  stageFiles: vi.fn(),
}));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(releaseFiles).mockClear();
  vi.spyOn(rpc, "sourceDocument").mockResolvedValue({
    value: create(DocumentSchema, {
      blocks: [{ text: "Shared initial text" }],
    }),
  } as never);
  vi.spyOn(rpc, "preview").mockResolvedValue(
    create(PreviewSchema, { kind: { case: "unavailable", value: {} } }),
  );
});
it("F1 source changes cannot retarget a pending correction even when block text matches", async () => {
  const user = userEvent.setup();
  const correct = vi
    .spyOn(rpc, "correctBlock")
    .mockResolvedValue({ value: true } as never);
  const a = create(SourceSchema, { id: { value: 1n }, name: "A" });
  const b = create(SourceSchema, { id: { value: 2n }, name: "B" });
  const view = renderPage(<SourceDetail source={a} projects={[]} />);
  await user.click(await screen.findByRole("button", { name: en.CorrectText }));
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "Only A");
  view.rerender(<SourceDetail source={b} projects={[]} />);
  await screen.findByText("Shared initial text");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: en.Save }),
  ).not.toBeInTheDocument();
  expect(correct).not.toHaveBeenCalled();
});
it("F3 session and thread drafts retain text and owned attachments across route unmounts", async () => {
  const user = userEvent.setup();
  vi.mocked(pickFiles).mockResolvedValue(["/stage/A.png"]);
  const a = create(SessionIdSchema, { value: 1n }),
    b = create(SessionIdSchema, { value: 2n });
  const { useState } = await import("react");
  function Host() {
    const [where, setWhere] = useState("A");
    return (
      <SessionDraftProvider>
        <button onClick={() => setWhere("A")}>A</button>
        <button onClick={() => setWhere("B")}>B</button>
        <button onClick={() => setWhere("Settings")}>Settings</button>
        <button onClick={() => setWhere("Thread")}>Thread</button>
        {where === "Settings" ? (
          <div />
        ) : (
          <Composer
            key={where}
            session={where === "B" ? b : a}
            thread={
              where === "Thread"
                ? { value: 8n, $typeName: "study.v1.PartId" }
                : undefined
            }
          />
        )}
      </SessionDraftProvider>
    );
  }
  const view = renderPage(<Host />);
  await user.type(screen.getByRole("textbox"), "Draft A");
  await user.click(screen.getByRole("button", { name: en.AttachFiles }));
  await screen.findByText("A.png");
  await user.click(screen.getByRole("button", { name: "B" }));
  expect(screen.getByRole("textbox")).toHaveValue("");
  await user.type(screen.getByRole("textbox"), "Draft B");
  await user.click(screen.getByRole("button", { name: "Thread" }));
  await user.type(screen.getByRole("textbox"), "Thread draft");
  vi.mocked(pickFiles).mockResolvedValue(["/stage/T.png"]);
  await user.click(screen.getByRole("button", { name: en.AttachFiles }));
  await screen.findByText("T.png");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(releaseFiles).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "A" }));
  expect(screen.getByRole("textbox")).toHaveValue("Draft A");
  expect(screen.getByText("A.png")).toBeInTheDocument();
  expect(screen.queryByText("T.png")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Thread" }));
  expect(screen.getByRole("textbox")).toHaveValue("Thread draft");
  expect(screen.getByText("T.png")).toBeInTheDocument();
  view.unmount();
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/A.png"]),
  );
});
const message = (status: JobStatus) =>
  create(ChatMessageSchema, {
    id: { value: 1n },
    role: MessageRole.ASSISTANT,
    activeVersion: { value: 1n },
    versions: [
      {
        id: { value: 1n },
        text: "Active response [1]. Code `[1]`.",
        status: MessageStatus.COMPLETE,
      },
      { id: { value: 2n }, text: "", status: MessageStatus.PENDING },
    ],
    reply: { id: { value: 7n }, status },
    citations: [
      {
        marker: 1,
        sourceId: { value: 9n },
        sourceName: "Lecture",
        anchor: { kind: { case: "page", value: 4 } },
      },
    ],
  });
it.each([JobStatus.FAILED, JobStatus.CANCELLED])(
  "F4 stopped version status %s restores editing, rewriting and local retry",
  async (status) => {
    const user = userEvent.setup();
    const retry = vi
      .spyOn(rpc, "retryJob")
      .mockResolvedValue({ value: true } as never);
    renderPage(
      <MessageView
        message={message(status)}
        onThread={vi.fn()}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: en.EditMessage })).toBeEnabled();
    expect(screen.getByRole("button", { name: en.AiEdit })).toBeEnabled();
    expect(screen.queryByText(en.VersionWriting)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: en.StopVersion }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.RetryJob }));
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ value: 7n }));
  },
);
it("F9 canonical inline citations open the cited anchor while code markers stay literal", async () => {
  const user = userEvent.setup(),
    navigate = vi.fn();
  renderPage(
    <MessageView
      message={message(JobStatus.SUCCEEDED)}
      onThread={vi.fn()}
      navigate={navigate}
    />,
  );
  const link = screen.getByRole("link", { name: "[1]" });
  link.focus();
  await user.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledWith(
    "MediaList",
    "9",
    undefined,
    expect.objectContaining({ kind: { case: "page", value: 4 } }),
  );
  expect(screen.getAllByRole("link", { name: "[1]" })).toHaveLength(1);
});
it("F10 recorded note markers open a one millisecond transcript anchor", async () => {
  const user = userEvent.setup(),
    navigate = vi.fn();
  const m = message(JobStatus.SUCCEEDED);
  m.recordingMs = 125000n;
  m.recordedIn = { value: 12n, $typeName: "study.v1.SourceId" };
  renderPage(
    <MessageView message={m} onThread={vi.fn()} navigate={navigate} />,
  );
  await user.click(
    screen.getByRole("button", { name: new RegExp(en.OpenInLibrary) }),
  );
  expect(navigate).toHaveBeenCalledWith(
    "MediaList",
    "12",
    undefined,
    expect.objectContaining({
      kind: {
        case: "time",
        value: expect.objectContaining({ startMs: 125000n, endMs: 125001n }),
      },
    }),
  );
});
it("F12 copies the active readable message while a new version is running", async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  renderPage(
    <MessageView
      message={message(JobStatus.RUNNING)}
      onThread={vi.fn()}
      navigate={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: en.CopyText }));
  expect(copy).toHaveBeenCalledWith("Active response [1]. Code `[1]`.");
});
it("F4 waiting versions provide their own setup and cancel actions while editing stays protected", async () => {
  const user = userEvent.setup(),
    navigate = vi.fn();
  const m = message(JobStatus.WAITING);
  m.reply!.waitingFor = 3;
  const cancel = vi
    .spyOn(rpc, "cancelJob")
    .mockResolvedValue({ value: true } as never);
  renderPage(
    <MessageView message={m} onThread={vi.fn()} navigate={navigate} />,
  );
  expect(screen.getByRole("button", { name: en.EditMessage })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: en.GoToSettings }));
  expect(navigate).toHaveBeenCalledWith("Settings");
  await user.click(screen.getByRole("button", { name: en.StopVersion }));
  expect(cancel).toHaveBeenCalledWith(m.reply!.id);
});
it("F3 Strict Mode cleanup probes do not dispose live draft ownership", async () => {
  const { StrictMode } = await import("react");
  const user = userEvent.setup();
  vi.mocked(pickFiles).mockResolvedValue(["/stage/strict.png"]);
  const view = renderPage(
    <StrictMode>
      <SessionDraftProvider>
        <Composer session={create(SessionIdSchema, { value: 3n })} />
      </SessionDraftProvider>
    </StrictMode>,
  );
  await user.type(screen.getByRole("textbox"), "Kept");
  await user.click(screen.getByRole("button", { name: en.AttachFiles }));
  await screen.findByText("strict.png");
  expect(releaseFiles).not.toHaveBeenCalled();
  view.unmount();
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/strict.png"]),
  );
});
it("F3 deleting a session releases its drafts but preserves another session and in-flight readers", async () => {
  const { SessionDraftStore } = await import("../hooks/session-drafts");
  const store = new SessionDraftStore();
  const a = store.get("1"),
    thread = store.get("1", "7"),
    b = store.get("2");
  await a.files.add(["/stage/A"]);
  await thread.files.add(["/stage/thread"]);
  await b.files.add(["/stage/B"]);
  const sending = a.files.retain();
  await store.discardSession("1");
  expect(releaseFiles).toHaveBeenCalledWith(["/stage/thread"]);
  expect(releaseFiles).not.toHaveBeenCalledWith(["/stage/A"]);
  expect(b.files.paths).toEqual(["/stage/B"]);
  await sending.finish([]);
  expect(releaseFiles).toHaveBeenCalledWith(["/stage/A"]);
  await store.dispose();
  expect(releaseFiles).toHaveBeenCalledWith(["/stage/B"]);
});
