import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionIdSchema } from "../generated/study_pb";
import { Composer } from "./sessions";
import { rpc } from "../rpc/client";
import { pickFiles } from "../rpc/native";
import { releaseFiles } from "../rpc/files";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({ rpc: { postMessage: vi.fn() } }));
vi.mock("../rpc/native", () => ({ pickFiles: vi.fn() }));
vi.mock("../rpc/files", () => ({
  releaseFiles: vi.fn(),
  stageFiles: vi.fn(),
  useNativeDrop: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(releaseFiles).mockReset().mockResolvedValue();
  vi.mocked(pickFiles).mockReset();
  vi.mocked(rpc.postMessage).mockReset();
});
const session = create(SessionIdSchema, { value: 1n });
it("keeps failed-send attachments for retry and cleans them only after successful posting", async () => {
  const user = userEvent.setup();
  vi.mocked(pickFiles).mockResolvedValue(["/stage/image.png"]);
  vi.mocked(rpc.postMessage)
    .mockRejectedValueOnce(new Error("Post rejected"))
    .mockResolvedValueOnce({} as never);
  renderPage(<Composer session={session} />);
  await user.click(screen.getByRole("button", { name: "Attach files" }));
  expect(await screen.findByText("image.png")).toBeInTheDocument();
  await user.type(screen.getByRole("textbox"), "Question");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Post rejected");
  expect(screen.getByText("image.png")).toBeInTheDocument();
  expect(releaseFiles).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/image.png"]),
  );
  expect(screen.queryByText("image.png")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("");
});
it("releases removed files and unmount releases remaining files", async () => {
  const user = userEvent.setup();
  vi.mocked(pickFiles).mockResolvedValue(["/stage/a.png", "/stage/b.png"]);
  const { unmount } = renderPage(<Composer session={session} />);
  await user.click(screen.getByRole("button", { name: "Attach files" }));
  await screen.findByText("b.png");
  await user.click(
    screen.getAllByRole("button", { name: "Remove attachment" })[0],
  );
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/a.png"]),
  );
  expect(screen.queryByText("a.png")).not.toBeInTheDocument();
  unmount();
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/b.png"]),
  );
});
it("releases files returned by a picker after the composer unmounted", async () => {
  let finish!: (paths: string[]) => void;
  vi.mocked(pickFiles).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  const { unmount } = renderPage(<Composer session={session} />);
  await user.click(screen.getByRole("button", { name: "Attach files" }));
  unmount();
  finish(["/late/image.png"]);
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/late/image.png"]),
  );
  expect(rpc.postMessage).not.toHaveBeenCalled();
});

it("keeps an in-flight native file alive across unmount, then releases it on completion", async () => {
  let finish!: (value: never) => void;
  vi.mocked(pickFiles).mockResolvedValue(["/stage/sending.png"]);
  vi.mocked(rpc.postMessage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  const { unmount } = renderPage(<Composer session={session} />);
  await user.click(screen.getByRole("button", { name: "Attach files" }));
  await screen.findByText("sending.png");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(rpc.postMessage).toHaveBeenCalled());
  unmount();
  expect(releaseFiles).not.toHaveBeenCalled();
  finish({} as never);
  await waitFor(() =>
    expect(releaseFiles).toHaveBeenCalledWith(["/stage/sending.png"]),
  );
});
it("clears only the posted text snapshot when a newer draft is typed during posting", async () => {
  let finish!: (value: never) => void;
  vi.mocked(rpc.postMessage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  renderPage(<Composer session={session} />);
  const input = screen.getByRole("textbox");
  await user.type(input, "Initial");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(rpc.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Initial" }),
    ),
  );
  await user.clear(input);
  await user.type(input, "Next draft");
  finish({} as never);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled(),
  );
  expect(input).toHaveValue("Next draft");
});
